/**
 * Facebook Messenger Bot - Theo dõi nợ cá nhân
 * Sử dụng Google Sheets làm database
 * 
 * Tác giả: Senior Backend Developer
 * Tính năng:
 *   - Ghi nợ: "no [số tiền] [nội dung]" hoặc "nợ [số tiền] [nội dung]"
 *   - Trả nợ: "tra [số tiền] [nội dung]" hoặc "trả [số tiền] [nội dung]"
 *   - Xem nợ: "check", "tong", "tổng", "show no"
 *   - Đồng bộ 2 chiều: alias, sharecode, link, xác nhận nợ
 */

require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const crypto = require('crypto');

// ============================================
// CẤU HÌNH VÀ BIẾN MÔI TRƯỜNG
// ============================================
const config = {
  PORT: process.env.PORT || 3000,
  PAGE_ACCESS_TOKEN: process.env.PAGE_ACCESS_TOKEN,
  VERIFY_TOKEN: process.env.VERIFY_TOKEN,
  APP_SECRET: process.env.APP_SECRET,
  GOOGLE_SHEET_ID: process.env.GOOGLE_SHEET_ID,
  GOOGLE_SERVICE_ACCOUNT_EMAIL: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  GOOGLE_PRIVATE_KEY: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
};

// Kiểm tra biến môi trường bắt buộc
const requiredEnvVars = [
  'PAGE_ACCESS_TOKEN',
  'VERIFY_TOKEN', 
  'GOOGLE_SHEET_ID',
  'GOOGLE_SERVICE_ACCOUNT_EMAIL',
  'GOOGLE_PRIVATE_KEY'
];

for (const envVar of requiredEnvVars) {
  if (!config[envVar]) {
    console.error(`❌ Thiếu biến môi trường: ${envVar}`);
    process.exit(1);
  }
}

// Cảnh báo nếu thiếu APP_SECRET (security)
if (!config.APP_SECRET) {
  console.warn('⚠️ ================================================');
  console.warn('⚠️ CẢNH BÁO: APP_SECRET chưa được cấu hình!');
  console.warn('⚠️ Webhook KHÔNG được bảo vệ khỏi fake requests.');
  console.warn('⚠️ Thêm APP_SECRET vào .env để bảo mật.');
  console.warn('⚠️ ================================================');
}

// ============================================
// KHỞI TẠO EXPRESS APP
// ============================================
const path = require('path');
const app = express();
// Capture raw body để verify webhook signature
app.use(bodyParser.json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));
app.use(express.static(path.join(__dirname, 'public')));

// ============================================
// WEBHOOK SIGNATURE VERIFICATION
// ============================================

/**
 * Verify Facebook Webhook signature
 * @param {Request} req - Express request
 * @returns {boolean} true if signature is valid
 */
function verifyWebhookSignature(req) {
  const signature = req.headers['x-hub-signature-256'];
  
  if (!signature) {
    console.warn('⚠️ Missing X-Hub-Signature-256 header');
    return false;
  }
  
  const [algo, receivedHash] = signature.split('=');
  
  if (algo !== 'sha256' || !receivedHash) {
    console.warn('⚠️ Invalid signature format');
    return false;
  }
  
  try {
    const rawBody = req.rawBody || Buffer.from(JSON.stringify(req.body), 'utf8');
    const expectedHash = crypto
      .createHmac('sha256', config.APP_SECRET)
      .update(rawBody)
      .digest('hex');
    
    const isValid = crypto.timingSafeEqual(
      Buffer.from(receivedHash, 'hex'),
      Buffer.from(expectedHash, 'hex')
    );
    
    if (!isValid) {
      console.warn('⚠️ Webhook signature mismatch');
    }
    
    return isValid;
  } catch (error) {
    console.error('❌ Lỗi verify signature:', error.message);
    return false;
  }
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

function generateCode(length = 6) {
  return crypto.randomBytes(4).toString('hex').toUpperCase().substring(0, length);
}

/**
 * Random emoji để làm sinh động responses
 */
const EMOJIS = {
  success: ['✅', '🎉', '👍', '💪', '🙌'],
  money: ['💰', '💵', '💸', '🤑'],
  thinking: ['🤔', '💭', '🧐'],
  greeting: ['👋', '😊', '🙂', '✨'],
  warning: ['⚠️', '🔔', '📢'],
};

function randomEmoji(type = 'success') {
  const list = EMOJIS[type] || EMOJIS.success;
  return list[Math.floor(Math.random() * list.length)];
}

/**
 * Chuẩn hóa chuỗi tiếng Việt - bỏ dấu, lowercase
 * Cho phép matching: "Tuấn" = "Tuan" = "tuan"
 */
function normalizeVietnamese(str = '') {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'd')
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Lấy thông tin profile Facebook của user
 * @param {string} userId - Facebook User ID (PSID)
 * @returns {Promise<{firstName: string, lastName: string, name: string}|null>}
 */
async function getFacebookProfile(userId) {
  try {
    const response = await axios.get(
      `https://graph.facebook.com/${userId}`,
      {
        params: {
          fields: 'first_name,last_name,name',
          access_token: config.PAGE_ACCESS_TOKEN
        }
      }
    );
    return {
      firstName: response.data.first_name || '',
      lastName: response.data.last_name || '',
      name: response.data.name || ''
    };
  } catch (error) {
    console.error('❌ Lỗi lấy profile Facebook:', error.message);
    return null;
  }
}

/**
 * Tạo alias duy nhất từ tên
 * Nếu "Tuan" đã tồn tại → thử "Tuan2", "Tuan3"...
 */
async function generateUniqueAlias(baseName) {
  const doc = await getGoogleSheet();
  const sheet = await getAliasesSheet(doc);
  const rows = await sheet.getRows();
  
  // Chuẩn hóa tên: chỉ lấy chữ cái đầu tiên, bỏ dấu, capitalize
  let cleanName = baseName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .replace(/[^a-zA-Z0-9]/g, '');
  
  // Capitalize first letter
  cleanName = cleanName.charAt(0).toUpperCase() + cleanName.slice(1).toLowerCase();
  
  if (!cleanName) cleanName = 'User';
  
  // Kiểm tra xem alias đã tồn tại chưa
  const existingAliases = rows.map(r => normalizeVietnamese(r.get('Alias') || ''));
  
  let candidate = cleanName;
  let counter = 2;
  
  while (existingAliases.includes(normalizeVietnamese(candidate))) {
    candidate = `${cleanName}${counter}`;
    counter++;
  }
  
  return candidate;
}

/**
 * Tự động tạo alias cho user mới từ tên Facebook
 * Gọi khi user chưa có alias
 */
async function autoSetAliasFromFacebook(userId) {
  try {
    // Kiểm tra đã có alias chưa
    const existingAlias = await getAliasByUserId(userId);
    if (existingAlias) {
      return null; // Đã có alias rồi
    }
    
    // Lấy tên từ Facebook
    const profile = await getFacebookProfile(userId);
    if (!profile || !profile.firstName) {
      return null;
    }
    
    // Tạo alias unique
    const alias = await generateUniqueAlias(profile.firstName);
    
    // Lưu alias
    const result = await setAlias(userId, alias);
    if (result.success) {
      console.log(`✅ Auto-alias: ${userId} → @${alias}`);
      return alias;
    }
    
    return null;
  } catch (error) {
    console.error('❌ Lỗi autoSetAliasFromFacebook:', error.message);
    return null;
  }
}

// ============================================
// GOOGLE SHEETS REPOSITORY
// ============================================

let cachedDoc = null;

async function getGoogleSheet() {
  try {
    if (cachedDoc) {
      return cachedDoc;
    }
    
    const serviceAccountAuth = new JWT({
      email: config.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      key: config.GOOGLE_PRIVATE_KEY,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const doc = new GoogleSpreadsheet(config.GOOGLE_SHEET_ID, serviceAccountAuth);
    await doc.loadInfo();
    cachedDoc = doc;
    return doc;
  } catch (error) {
    console.error('❌ Lỗi kết nối Google Sheets:', error.message);
    throw new Error('Không thể kết nối Google Sheets');
  }
}

// ============================================
// SHEET MANAGEMENT - Tạo/lấy các sheet cần thiết
// ============================================

async function getTransactionsSheet(doc) {
  let sheet = doc.sheetsByIndex[0];
  await ensureTransactionColumns(sheet);
  return sheet;
}

async function getAliasesSheet(doc) {
  let sheet = doc.sheetsByTitle['Aliases'];
  if (!sheet) {
    sheet = await doc.addSheet({ 
      title: 'Aliases', 
      headerValues: ['UserID', 'Alias', 'CreatedAt'] 
    });
    console.log('✅ Đã tạo sheet Aliases');
  }
  return sheet;
}

async function getFriendLinksSheet(doc) {
  let sheet = doc.sheetsByTitle['FriendLinks'];
  if (!sheet) {
    sheet = await doc.addSheet({ 
      title: 'FriendLinks', 
      headerValues: ['UserID_A', 'UserID_B', 'AliasOfBForA', 'AliasOfAForB', 'Code', 'Status', 'CreatedAt', 'ExpiresAt'] 
    });
    console.log('✅ Đã tạo sheet FriendLinks');
  }
  return sheet;
}

async function ensureTransactionColumns(sheet) {
  await sheet.loadHeaderRow();
  const headers = sheet.headerValues;
  const requiredColumns = ['Date', 'UserID', 'Debtor', 'Type', 'Amount', 'Content', 'DebtorUserID', 'Status', 'DebtCode'];
  
  let needsUpdate = false;
  const newHeaders = [...headers];
  
  for (const col of requiredColumns) {
    if (!headers.includes(col)) {
      newHeaders.push(col);
      needsUpdate = true;
    }
  }
  
  if (needsUpdate) {
    await sheet.setHeaderRow(newHeaders);
    console.log('✅ Đã cập nhật schema Transactions');
  }
}

// ============================================
// ALIAS MANAGEMENT
// ============================================

async function setAlias(userId, alias) {
  try {
    const doc = await getGoogleSheet();
    const sheet = await getAliasesSheet(doc);
    const rows = await sheet.getRows();
    
    // Kiểm tra alias đã tồn tại chưa (accent-insensitive)
    const inputNorm = normalizeVietnamese(alias);
    const existingAlias = rows.find(r => {
      const existing = r.get('Alias');
      return existing && normalizeVietnamese(existing) === inputNorm;
    });
    if (existingAlias && existingAlias.get('UserID') !== userId) {
      return { success: false, message: `Alias @${alias} đã được sử dụng bởi người khác.` };
    }
    
    // Tìm và cập nhật hoặc tạo mới
    const existingRow = rows.find(r => r.get('UserID') === userId);
    if (existingRow) {
      existingRow.set('Alias', alias);
      existingRow.set('CreatedAt', new Date().toISOString());
      await existingRow.save();
    } else {
      await sheet.addRow({
        UserID: userId,
        Alias: alias,
        CreatedAt: new Date().toISOString()
      });
    }
    
    return { success: true, message: `✅ Đã đặt alias: @${alias}` };
  } catch (error) {
    console.error('❌ Lỗi setAlias:', error.message);
    return { success: false, message: 'Lỗi khi đặt alias.' };
  }
}

async function getAliasByUserId(userId) {
  try {
    const doc = await getGoogleSheet();
    const sheet = await getAliasesSheet(doc);
    const rows = await sheet.getRows();
    
    const row = rows.find(r => r.get('UserID') === userId);
    return row ? row.get('Alias') : null;
  } catch (error) {
    console.error('❌ Lỗi getAliasByUserId:', error.message);
    return null;
  }
}

async function getUserIdByAlias(alias) {
  try {
    const doc = await getGoogleSheet();
    const sheet = await getAliasesSheet(doc);
    const rows = await sheet.getRows();
    
    // Accent-insensitive matching
    const inputNorm = normalizeVietnamese(alias);
    const row = rows.find(r => {
      const existing = r.get('Alias');
      return existing && normalizeVietnamese(existing) === inputNorm;
    });
    return row ? row.get('UserID') : null;
  } catch (error) {
    console.error('❌ Lỗi getUserIdByAlias:', error.message);
    return null;
  }
}

/**
 * Build alias cache từ Aliases sheet - load 1 lần thay vì N lần
 * @returns {Promise<{[userId: string]: string}>} Map userId -> alias
 */
async function buildAliasCache() {
  try {
    const doc = await getGoogleSheet();
    const sheet = await getAliasesSheet(doc);
    const rows = await sheet.getRows();
    
    const aliasMap = {};
    for (const row of rows) {
      const userId = row.get('UserID');
      const alias = row.get('Alias');
      if (userId && alias) {
        aliasMap[userId] = alias;
      }
    }
    return aliasMap;
  } catch (error) {
    console.error('❌ Lỗi buildAliasCache:', error.message);
    return {};
  }
}

/**
 * Tìm kiếm aliases tương tự trong hệ thống (fuzzy search)
 * Trả về danh sách các user có alias match hoặc gần giống
 * @param {string} searchAlias - Alias cần tìm
 * @param {string} excludeUserId - UserId cần loại trừ (chính mình)
 * @returns {Promise<Array<{userId: string, alias: string, fullName: string}>>}
 */
async function searchGlobalAliases(searchAlias, excludeUserId = '') {
  try {
    const doc = await getGoogleSheet();
    const sheet = await getAliasesSheet(doc);
    const rows = await sheet.getRows();
    
    const inputNorm = normalizeVietnamese(searchAlias);
    const results = [];
    
    for (const row of rows) {
      const userId = row.get('UserID');
      const alias = row.get('Alias');
      
      if (!alias || userId === excludeUserId) continue;
      
      const aliasNorm = normalizeVietnamese(alias);
      
      // Exact match hoặc starts with
      if (aliasNorm === inputNorm || aliasNorm.startsWith(inputNorm) || inputNorm.startsWith(aliasNorm)) {
        // Lấy tên đầy đủ từ Facebook nếu có thể
        const profile = await getFacebookProfile(userId);
        results.push({
          userId,
          alias,
          fullName: profile?.name || alias
        });
      }
    }
    
    return results;
  } catch (error) {
    console.error('❌ Lỗi searchGlobalAliases:', error.message);
    return [];
  }
}

/**
 * Tạo FriendLink trực tiếp giữa 2 user (không cần sharecode)
 */
async function createDirectFriendLink(userIdA, userIdB, aliasOfBForA) {
  try {
    const doc = await getGoogleSheet();
    const sheet = await getFriendLinksSheet(doc);
    const rows = await sheet.getRows();
    
    // Kiểm tra đã liên kết chưa
    const existingLink = rows.find(r => 
      r.get('Status') === 'ACTIVE' &&
      ((r.get('UserID_A') === userIdA && r.get('UserID_B') === userIdB) ||
       (r.get('UserID_A') === userIdB && r.get('UserID_B') === userIdA))
    );
    
    if (existingLink) {
      return { success: true, alreadyLinked: true };
    }
    
    // Lấy alias của A để B biết gọi A là gì
    const aliasOfAForB = await getAliasByUserId(userIdA);
    
    await sheet.addRow({
      UserID_A: userIdA,
      UserID_B: userIdB,
      AliasOfBForA: aliasOfBForA,
      AliasOfAForB: aliasOfAForB || '',
      Code: 'AUTO',
      Status: 'ACTIVE',
      CreatedAt: new Date().toISOString(),
      ExpiresAt: ''
    });
    
    console.log(`✅ Auto-link: ${userIdA} ↔ ${userIdB} (@${aliasOfBForA})`);
    return { success: true, alreadyLinked: false };
  } catch (error) {
    console.error('❌ Lỗi createDirectFriendLink:', error.message);
    return { success: false };
  }
}

// ============================================
// FRIEND LINK MANAGEMENT
// ============================================

async function createShareCode(userId) {
  try {
    const doc = await getGoogleSheet();
    const sheet = await getFriendLinksSheet(doc);
    
    const code = generateCode(6);
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24h
    
    await sheet.addRow({
      UserID_A: '',
      UserID_B: userId,
      AliasOfBForA: '',
      AliasOfAForB: '',
      Code: code,
      Status: 'PENDING',
      CreatedAt: new Date().toISOString(),
      ExpiresAt: expiresAt
    });
    
    return { success: true, code };
  } catch (error) {
    console.error('❌ Lỗi createShareCode:', error.message);
    return { success: false, message: 'Lỗi khi tạo mã.' };
  }
}

async function activateFriendLink(code, userId, aliasForFriend) {
  try {
    const doc = await getGoogleSheet();
    const sheet = await getFriendLinksSheet(doc);
    const rows = await sheet.getRows();
    
    const row = rows.find(r => 
      r.get('Code') === code && 
      r.get('Status') === 'PENDING'
    );
    
    if (!row) {
      return { success: false, message: 'Mã không hợp lệ hoặc đã hết hạn.' };
    }
    
    const expiresAt = new Date(row.get('ExpiresAt'));
    if (new Date() > expiresAt) {
      row.set('Status', 'EXPIRED');
      await row.save();
      return { success: false, message: 'Mã đã hết hạn.' };
    }
    
    const friendUserId = row.get('UserID_B');
    if (friendUserId === userId) {
      return { success: false, message: 'Bạn không thể liên kết với chính mình.' };
    }
    
    // Kiểm tra đã liên kết chưa
    const existingLink = rows.find(r => 
      r.get('Status') === 'ACTIVE' &&
      ((r.get('UserID_A') === userId && r.get('UserID_B') === friendUserId) ||
       (r.get('UserID_A') === friendUserId && r.get('UserID_B') === userId))
    );
    
    if (existingLink) {
      return { success: false, message: 'Hai bạn đã liên kết rồi.' };
    }
    
    // Cập nhật link
    row.set('UserID_A', userId);
    row.set('AliasOfBForA', aliasForFriend);
    row.set('Status', 'ACTIVE');
    await row.save();
    
    // Lấy alias của người kia
    const friendAlias = await getAliasByUserId(friendUserId);
    
    return { 
      success: true, 
      friendUserId,
      friendAlias: friendAlias || aliasForFriend,
      message: `✅ Đã liên kết với @${aliasForFriend}!`
    };
  } catch (error) {
    console.error('❌ Lỗi activateFriendLink:', error.message);
    return { success: false, message: 'Lỗi khi liên kết.' };
  }
}

async function getFriendUserId(userId, friendAlias) {
  try {
    const doc = await getGoogleSheet();
    const sheet = await getFriendLinksSheet(doc);
    const rows = await sheet.getRows();
    
    // Accent-insensitive matching
    const inputNorm = normalizeVietnamese(friendAlias);
    
    // Tìm trong FriendLinks trước
    for (const row of rows) {
      if (row.get('Status') !== 'ACTIVE') continue;
      
      const aliasOfBForA = row.get('AliasOfBForA');
      const aliasOfAForB = row.get('AliasOfAForB');
      
      if (row.get('UserID_A') === userId && 
          aliasOfBForA && normalizeVietnamese(aliasOfBForA) === inputNorm) {
        return row.get('UserID_B');
      }
      if (row.get('UserID_B') === userId && 
          aliasOfAForB && normalizeVietnamese(aliasOfAForB) === inputNorm) {
        return row.get('UserID_A');
      }
    }
    
    // Fallback: tìm trong Aliases
    return await getUserIdByAlias(friendAlias);
  } catch (error) {
    console.error('❌ Lỗi getFriendUserId:', error.message);
    return null;
  }
}

async function getLinkedFriends(userId) {
  try {
    const doc = await getGoogleSheet();
    const sheet = await getFriendLinksSheet(doc);
    const rows = await sheet.getRows();
    
    const friends = [];
    for (const row of rows) {
      if (row.get('Status') !== 'ACTIVE') continue;
      
      if (row.get('UserID_A') === userId) {
        friends.push({
          userId: row.get('UserID_B'),
          alias: row.get('AliasOfBForA')
        });
      } else if (row.get('UserID_B') === userId) {
        friends.push({
          userId: row.get('UserID_A'),
          alias: row.get('AliasOfAForB') || await getAliasByUserId(row.get('UserID_A'))
        });
      }
    }
    
    return friends;
  } catch (error) {
    console.error('❌ Lỗi getLinkedFriends:', error.message);
    return [];
  }
}

// ============================================
// TRANSACTION MANAGEMENT
// ============================================

async function appendRow(rowData) {
  try {
    const doc = await getGoogleSheet();
    const sheet = await getTransactionsSheet(doc);
    
    await sheet.addRow({
      Date: rowData.Date,
      UserID: rowData.UserID,
      Debtor: rowData.Debtor || 'Chung',
      Type: rowData.Type,
      Amount: rowData.Amount,
      Content: rowData.Content || '',
      DebtorUserID: rowData.DebtorUserID || '',
      Status: rowData.Status || 'CONFIRMED',
      DebtCode: rowData.DebtCode || '',
    });
    
    console.log(`✅ Đã thêm dòng: ${rowData.Type} - ${rowData.Amount} - @${rowData.Debtor || 'Chung'} [${rowData.Status}]`);
  } catch (error) {
    console.error('❌ Lỗi thêm dòng vào Sheet:', error.message);
    throw new Error('Không thể ghi dữ liệu vào Google Sheets');
  }
}

async function getRowsByUser(userId, includeRowRef = false) {
  try {
    const doc = await getGoogleSheet();
    const sheet = await getTransactionsSheet(doc);
    const rows = await sheet.getRows();
    
    const userRows = rows.filter(row => 
      row.get('UserID') === userId || row.get('DebtorUserID') === userId
    );
    
    return userRows.map(row => {
      const data = {
        Date: row.get('Date'),
        UserID: row.get('UserID'),
        Debtor: row.get('Debtor') || 'Chung',
        Type: row.get('Type'),
        Amount: parseInt(row.get('Amount')) || 0,
        Content: row.get('Content') || '',
        DebtorUserID: row.get('DebtorUserID') || '',
        Status: row.get('Status') || 'CONFIRMED',
        DebtCode: row.get('DebtCode') || '',
      };
      if (includeRowRef) {
        data._row = row;
      }
      return data;
    });
  } catch (error) {
    console.error('❌ Lỗi đọc dữ liệu từ Sheet:', error.message);
    throw new Error('Không thể đọc dữ liệu từ Google Sheets');
  }
}

async function findDebtByCode(code) {
  try {
    const doc = await getGoogleSheet();
    const sheet = await getTransactionsSheet(doc);
    const rows = await sheet.getRows();
    
    const row = rows.find(r => r.get('DebtCode') === code);
    if (!row) return null;
    
    return {
      Date: row.get('Date'),
      UserID: row.get('UserID'),
      Debtor: row.get('Debtor'),
      Type: row.get('Type'),
      Amount: parseInt(row.get('Amount')) || 0,
      Content: row.get('Content'),
      DebtorUserID: row.get('DebtorUserID'),
      Status: row.get('Status'),
      DebtCode: row.get('DebtCode'),
      _row: row
    };
  } catch (error) {
    console.error('❌ Lỗi findDebtByCode:', error.message);
    return null;
  }
}

async function updateDebtStatus(row, newStatus) {
  try {
    row._row.set('Status', newStatus);
    await row._row.save();
    return true;
  } catch (error) {
    console.error('❌ Lỗi updateDebtStatus:', error.message);
    return false;
  }
}

async function getPendingDebtsForUser(userId) {
  try {
    const doc = await getGoogleSheet();
    const sheet = await getTransactionsSheet(doc);
    const rows = await sheet.getRows();
    
    const pending = rows.filter(r => 
      r.get('DebtorUserID') === userId && 
      r.get('Status') === 'PENDING'
    );
    
    return pending.map(row => ({
      Date: row.get('Date'),
      UserID: row.get('UserID'),
      Debtor: row.get('Debtor'),
      Type: row.get('Type'),
      Amount: parseInt(row.get('Amount')) || 0,
      Content: row.get('Content'),
      DebtCode: row.get('DebtCode'),
    }));
  } catch (error) {
    console.error('❌ Lỗi getPendingDebtsForUser:', error.message);
    return [];
  }
}

async function deleteLastTransaction(userId) {
  try {
    const rows = await getRowsByUser(userId, true);
    const userOwnRows = rows.filter(r => r.UserID === userId);
    if (userOwnRows.length === 0) return null;
    
    const lastRow = userOwnRows[userOwnRows.length - 1];
    await lastRow._row.delete();
    
    console.log(`🗑️ Đã xóa giao dịch: ${lastRow.Type} - ${lastRow.Amount}`);
    return lastRow;
  } catch (error) {
    console.error('❌ Lỗi xóa giao dịch:', error.message);
    throw new Error('Không thể xóa giao dịch');
  }
}

// ============================================
// MESSENGER CLIENT - GỬI TIN NHẮN
// ============================================

/**
 * Gửi typing indicator (hiệu ứng "đang nhập...")
 * @param {string} recipientId 
 * @param {string} action - 'typing_on' | 'typing_off' | 'mark_seen'
 */
async function sendTypingIndicator(recipientId, action = 'typing_on') {
  const url = `https://graph.facebook.com/v18.0/me/messages?access_token=${config.PAGE_ACCESS_TOKEN}`;
  
  try {
    await axios.post(url, {
      recipient: { id: recipientId },
      sender_action: action,
    });
  } catch (error) {
    // Không log lỗi typing indicator vì không quan trọng
  }
}

/**
 * Delay helper
 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function sendMessage(recipientId, messageText) {
  const url = `https://graph.facebook.com/v18.0/me/messages?access_token=${config.PAGE_ACCESS_TOKEN}`;
  
  try {
    // Hiệu ứng typing trước khi gửi
    await sendTypingIndicator(recipientId, 'typing_on');
    await delay(300 + Math.random() * 400); // 300-700ms delay tự nhiên
    
    await axios.post(url, {
      recipient: { id: recipientId },
      message: { text: messageText },
    });
    console.log(`📤 Đã gửi tin nhắn đến ${recipientId}`);
  } catch (error) {
    console.error('❌ Lỗi gửi tin nhắn:', error.response?.data || error.message);
  }
}

async function sendMessageWithQuickReplies(recipientId, messageText, quickReplies) {
  const url = `https://graph.facebook.com/v18.0/me/messages?access_token=${config.PAGE_ACCESS_TOKEN}`;
  
  try {
    // Hiệu ứng typing trước khi gửi
    await sendTypingIndicator(recipientId, 'typing_on');
    await delay(300 + Math.random() * 400);
    
    await axios.post(url, {
      recipient: { id: recipientId },
      message: { 
        text: messageText,
        quick_replies: quickReplies
      },
    });
    console.log(`📤 Đã gửi tin nhắn với quick replies đến ${recipientId}`);
  } catch (error) {
    console.error('❌ Lỗi gửi tin nhắn:', error.response?.data || error.message);
  }
}

// ============================================
// COMMAND PARSER - PHÂN TÍCH LỆNH
// ============================================

function parseAmount(amountStr) {
  if (!amountStr) return null;
  
  let cleaned = amountStr.toLowerCase().replace(/,/g, '').replace(/\./g, '').replace(/đ/g, '').trim();
  
  let multiplier = 1;
  
  if (cleaned.match(/tr(ieu)?$/)) {
    multiplier = 1000000;
    cleaned = cleaned.replace(/tr(ieu)?$/, '');
  } else if (cleaned.match(/k\d+$/)) {
    const match = cleaned.match(/^(\d+)k(\d+)$/);
    if (match) {
      const mainPart = parseInt(match[1]);
      const decimalPart = parseInt(match[2]);
      return mainPart * 1000 + decimalPart * 100;
    }
  } else if (cleaned.endsWith('k')) {
    multiplier = 1000;
    cleaned = cleaned.slice(0, -1);
  } else if (cleaned.endsWith('m')) {
    multiplier = 1000000;
    cleaned = cleaned.slice(0, -1);
  }
  
  const number = parseFloat(cleaned);
  
  if (isNaN(number) || number <= 0) {
    return null;
  }
  
  const result = Math.round(number * multiplier);
  if (result > 1000000000000) {
    return null;
  }
  
  return result;
}

function formatAmount(amount) {
  return amount.toLocaleString('vi-VN');
}

function parseCommandSync(text) {
  if (!text) return null;
  
  const normalizedText = text.trim().toLowerCase();
  
  // ============ ĐỒNG BỘ 2 CHIỀU COMMANDS ============
  
  // Lệnh đặt alias: "alias @tuan" hoặc "ten @tuan"
  const aliasRegex = /^(alias|ten|tên)\s+@?(\S+)$/i;
  const aliasMatch = text.match(aliasRegex);
  if (aliasMatch) {
    return { intent: 'SET_ALIAS', alias: aliasMatch[2].replace('@', '') };
  }
  
  // Lệnh tạo mã kết nối: "sharecode" hoặc "taoma"
  const shareCodeRegex = /^(sharecode|taoma|tạo\s*mã|ma\s*ket\s*noi|mã\s*kết\s*nối)$/i;
  if (shareCodeRegex.test(normalizedText)) {
    return { intent: 'CREATE_SHARE_CODE' };
  }
  
  // Lệnh liên kết: "link ABC123 @Bao"
  const linkRegex = /^(link|lienket|liên\s*kết)\s+([A-Z0-9]+)\s+@?(\S+)$/i;
  const linkMatch = text.match(linkRegex);
  if (linkMatch) {
    return { 
      intent: 'LINK_FRIEND', 
      code: linkMatch[2].toUpperCase(), 
      alias: linkMatch[3].replace('@', '') 
    };
  }
  
  // Lệnh xác nhận nợ: "ok ABC123" hoặc "xn ABC123"
  const confirmRegex = /^(ok|xn|xacnhan|xác\s*nhận|dong\s*y|đồng\s*ý)\s+([A-Z0-9]+)$/i;
  const confirmMatch = text.match(confirmRegex);
  if (confirmMatch) {
    return { intent: 'CONFIRM_DEBT', code: confirmMatch[2].toUpperCase() };
  }
  
  // Lệnh từ chối nợ: "huy ABC123" hoặc "khong ABC123"
  const rejectRegex = /^(huy|huỷ|hủy|reject|khong|không|tuchoi|từ\s*chối)\s+([A-Z0-9]+)$/i;
  const rejectMatch = text.match(rejectRegex);
  if (rejectMatch) {
    return { intent: 'REJECT_DEBT', code: rejectMatch[2].toUpperCase() };
  }
  
  // Lệnh xem nợ chờ xác nhận: "pending" hoặc "cho"
  const pendingRegex = /^(pending|cho|chờ|cho\s*xac\s*nhan|chờ\s*xác\s*nhận)$/i;
  if (pendingRegex.test(normalizedText)) {
    return { intent: 'PENDING_LIST' };
  }
  
  // Lệnh xem bạn bè: "friends" hoặc "banbe"
  const friendsRegex = /^(friends|banbe|bạn\s*bè|ds\s*ban|danh\s*sách\s*bạn)$/i;
  if (friendsRegex.test(normalizedText)) {
    return { intent: 'LIST_FRIENDS' };
  }
  
  // Lệnh xem ID của mình: "id" hoặc "myid"
  const idRegex = /^(id|myid|ma\s*id)$/i;
  if (idRegex.test(normalizedText)) {
    return { intent: 'MY_ID' };
  }
  
  // ============ EXISTING COMMANDS (Legacy format với @) ============
  
  // Regex cho lệnh GHI NỢ: "no 50k @Bao tiền cơm" (format cũ)
  const debtRegex = /^(no|nợ)\s+(\S+)\s*(.*)$/i;
  const debtMatch = text.match(debtRegex);
  
  if (debtMatch) {
    const amount = parseAmount(debtMatch[2]);
    if (amount) {
      const { debtor, content } = parseDebtorAndContent(debtMatch[3]);
      return {
        intent: 'DEBT',
        amount: amount,
        debtor: debtor,
        content: content || 'Không có nội dung',
      };
    }
  }
  
  // Regex cho lệnh TRẢ NỢ: "tra 50k @Bao tiền cơm" (format cũ)
  const paidRegex = /^(tra|trả)\s+(\S+)\s*(.*)$/i;
  const paidMatch = text.match(paidRegex);
  
  if (paidMatch) {
    const amount = parseAmount(paidMatch[2]);
    if (amount) {
      const { debtor, content } = parseDebtorAndContent(paidMatch[3]);
      return {
        intent: 'PAID',
        amount: amount,
        debtor: debtor,
        content: content || 'Không có nội dung',
      };
    }
  }
  
  // Regex cho lệnh XEM NỢ
  const checkRegex = /^(check|tong|tổng|show\s*no|xem\s*no|xem\s*nợ)\s*(conno|còn\s*nợ|@?\S+)?$/i;
  const checkMatch = normalizedText.match(checkRegex);
  if (checkMatch) {
    let debtor = null;
    let onlyOwing = false;
    if (checkMatch[2]) {
      const param = checkMatch[2].toLowerCase();
      if (param === 'conno' || param === 'còn nợ') {
        onlyOwing = true;
      } else {
        debtor = checkMatch[2].replace('@', '').replace(/_/g, ' ').trim();
      }
    }
    return { intent: 'CHECK', debtor: debtor, onlyOwing: onlyOwing };
  }
  
  // Regex cho lệnh XÓA
  const undoRegex = /^(xoa|xóa|undo|huy|huỷ|hủy)$/i;
  if (undoRegex.test(normalizedText)) {
    return { intent: 'UNDO' };
  }
  
  // Regex cho lệnh TÌM KIẾM
  const searchRegex = /^(tim|tìm|find|search)\s+(.+)$/i;
  const searchMatch = text.match(searchRegex);
  if (searchMatch) {
    return { intent: 'SEARCH', keyword: searchMatch[2].trim() };
  }
  
  // Regex cho lệnh THỐNG KÊ
  const statsRegex = /^(thang\s*nay|tháng\s*này|thang\s*truoc|tháng\s*trước|tuan\s*nay|tuần\s*này|tuan\s*truoc|tuần\s*trước|hom\s*nay|hôm\s*nay)$/i;
  if (statsRegex.test(normalizedText)) {
    return { intent: 'STATS', period: normalizedText };
  }
  
  // Regex cho lệnh HELP
  const helpRegex = /^(help|huong\s*dan|hướng\s*dẫn|menu|\?)$/i;
  if (helpRegex.test(normalizedText)) {
    return { intent: 'HELP' };
  }
  
  return null;
}

async function parseCommand(userId, text) {
  const syncResult = parseCommandSync(text);
  if (syncResult) {
    return syncResult;
  }
  
  const flexibleResult = await parseFlexibleDebtOrPaid(userId, text);
  if (flexibleResult) {
    return flexibleResult;
  }
  
  return null;
}

function parseDebtorAndContent(remainder) {
  if (!remainder) {
    return { debtor: null, content: '' };
  }
  
  const trimmed = remainder.trim();
  const debtorMatch = trimmed.match(/^@(\S+)\s*(.*)$/);
  
  if (debtorMatch) {
    const debtor = debtorMatch[1].replace(/_/g, ' ').trim();
    const content = debtorMatch[2].trim();
    return { debtor, content };
  }
  
  return { debtor: null, content: trimmed };
}

// ============================================
// FLEXIBLE COMMAND PARSING - PHÂN TÍCH LINH HOẠT
// ============================================

function isDebtWord(token) {
  const n = normalizeVietnamese(token);
  return n === 'no';
}

function isPaidWord(token) {
  const n = normalizeVietnamese(token);
  return n === 'tra';
}

function findFirstAmountIndex(tokens, startIndex = 0) {
  for (let i = startIndex; i < tokens.length; i++) {
    if (parseAmount(tokens[i])) return i;
  }
  return -1;
}

function detectFriendInSpan(tokens, start, end, friendNameEntries) {
  if (start > end || start < 0 || end >= tokens.length) return null;
  
  const spanText = tokens.slice(start, end + 1).join(' ');
  const spanNormalized = normalizeVietnamese(spanText);
  
  const matches = friendNameEntries.filter(
    entry => entry.normalizedName === spanNormalized
  );
  
  if (matches.length === 1) {
    return {
      friendUserId: matches[0].friendUserId,
      alias: matches[0].rawName
    };
  }
  
  if (matches.length > 1) {
    return {
      ambiguous: true,
      candidates: matches
    };
  }
  
  return null;
}

function buildFriendNameEntries(friends) {
  const entries = [];
  for (const friend of friends) {
    if (friend.alias) {
      entries.push({
        friendUserId: friend.userId,
        rawName: friend.alias,
        normalizedName: normalizeVietnamese(friend.alias),
        tokenCount: friend.alias.trim().split(/\s+/).length
      });
    }
  }
  entries.sort((a, b) => b.tokenCount - a.tokenCount);
  return entries;
}

function tryMatchFriendInTokens(tokens, start, end, friendNameEntries) {
  for (let len = end - start + 1; len >= 1; len--) {
    for (let i = start; i <= end - len + 1; i++) {
      const match = detectFriendInSpan(tokens, i, i + len - 1, friendNameEntries);
      if (match && !match.ambiguous) {
        return {
          match,
          startIdx: i,
          endIdx: i + len - 1
        };
      }
    }
  }
  return null;
}

async function parseFlexibleDebtOrPaid(userId, text) {
  const trimmedText = text.trim();
  const tokens = trimmedText.split(/\s+/);
  
  if (tokens.length < 2) return null;
  
  const friends = await getLinkedFriends(userId);
  const friendNameEntries = buildFriendNameEntries(friends);
  
  let commandIndex = -1;
  let commandType = null;
  
  for (let i = 0; i < tokens.length; i++) {
    if (isDebtWord(tokens[i])) {
      commandIndex = i;
      commandType = 'DEBT';
      break;
    }
    if (isPaidWord(tokens[i])) {
      commandIndex = i;
      commandType = 'PAID';
      break;
    }
  }
  
  if (commandIndex === -1) return null;
  
  const amountIndex = findFirstAmountIndex(tokens, commandIndex + 1);
  if (amountIndex === -1) return null;
  
  const amount = parseAmount(tokens[amountIndex]);
  if (!amount) return null;
  
  let debtor = null;
  let contentStart = amountIndex + 1;
  
  if (commandIndex === 0 && amountIndex > 1) {
    const friendMatch = tryMatchFriendInTokens(tokens, 1, amountIndex - 1, friendNameEntries);
    if (friendMatch) {
      debtor = friendMatch.match.alias;
    } else {
      const possibleName = tokens.slice(1, amountIndex).join(' ');
      debtor = possibleName;
    }
  } else if (commandIndex > 0) {
    const friendMatch = tryMatchFriendInTokens(tokens, 0, commandIndex - 1, friendNameEntries);
    if (friendMatch) {
      debtor = friendMatch.match.alias;
    } else {
      const possibleName = tokens.slice(0, commandIndex).join(' ');
      debtor = possibleName;
    }
  }
  
  const contentTokens = tokens.slice(contentStart);
  const content = contentTokens.join(' ').trim();
  
  return {
    intent: commandType,
    amount,
    debtor: debtor,
    content: content || 'Không có nội dung'
  };
}

// ============================================
// DEBT SERVICE - XỬ LÝ NGHIỆP VỤ
// ============================================

async function handleSetAlias(userId, alias) {
  const result = await setAlias(userId, alias);
  return result.message;
}

async function handleCreateShareCode(userId) {
  const myAlias = await getAliasByUserId(userId);
  if (!myAlias) {
    return '⚠️ Bạn cần đặt alias trước!\nGõ: alias @TenCuaBan';
  }
  
  const result = await createShareCode(userId);
  if (result.success) {
    return `🔗 MÃ KẾT NỐI: ${result.code}\n\n` +
           `Gửi mã này cho bạn bè.\n` +
           `Họ sẽ gõ: link ${result.code} @${myAlias}\n\n` +
           `⏰ Mã hết hạn sau 24h.`;
  }
  return result.message;
}

async function handleLinkFriend(userId, code, alias) {
  const result = await activateFriendLink(code, userId, alias);
  
  if (result.success) {
    // Thông báo cho người kia
    const myAlias = await getAliasByUserId(userId);
    if (result.friendUserId) {
      await sendMessage(result.friendUserId, 
        `🔗 @${myAlias || 'Người dùng'} đã liên kết với bạn!\n` +
        `Giờ các bạn có thể xác nhận nợ cho nhau.`
      );
    }
  }
  
  return result.message;
}

async function handleAddDebt(userId, amount, debtor, content) {
  let debtorUserId = '';
  let status = 'CONFIRMED';
  let debtCode = '';
  let resolvedDebtor = debtor;
  
  // Nếu có @mention, thử tìm userId của người đó
  if (debtor) {
    // Kiểm tra nếu là số (@1, @2...) thì resolve từ friend list
    if (/^\d+$/.test(debtor)) {
      const aliasFromIndex = await getFriendAliasByIndex(userId, parseInt(debtor));
      if (aliasFromIndex) {
        resolvedDebtor = aliasFromIndex;
      } else {
        return { 
          ok: false, 
          reason: 'INVALID_INDEX',
          message: `❌ Không có bạn số @${debtor}. Gõ "friends" để xem danh sách.`
        };
      }
    }
    
    // Tìm trong friends trước
    debtorUserId = await getFriendUserId(userId, resolvedDebtor);
    
    // Nếu tìm thấy userId của debtor (đã liên kết) -> tạo PENDING debt để xác nhận
    if (debtorUserId) {
      status = 'PENDING';
      debtCode = generateCode(6);
    }
    // Nếu không tìm thấy -> vẫn ghi nợ bình thường với tên đó (CONFIRMED, không cần xác nhận)
  }
  
  const rowData = {
    Date: new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }),
    UserID: userId,
    Debtor: resolvedDebtor || 'Chung',
    Type: 'DEBT',
    Amount: amount,
    Content: content,
    DebtorUserID: debtorUserId,
    Status: status,
    DebtCode: debtCode,
  };
  
  await appendRow(rowData);
  
  const debtorLabel = resolvedDebtor ? `@${resolvedDebtor}` : 'Chung';
  
  // Nếu có PENDING debt, thông báo cho người nợ với quick reply buttons
  if (status === 'PENDING' && debtorUserId) {
    const myAlias = await getAliasByUserId(userId);
    const quickReplies = [
      {
        content_type: 'text',
        title: '✅ Xác nhận',
        payload: JSON.stringify({ type: 'CONFIRM_DEBT', code: debtCode })
      },
      {
        content_type: 'text',
        title: '❌ Từ chối',
        payload: JSON.stringify({ type: 'REJECT_DEBT', code: debtCode })
      }
    ];
    
    await sendMessageWithQuickReplies(
      debtorUserId, 
      `📥 NỢ MỚI TỪ @${myAlias || 'Ai đó'}\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `💰 Số tiền: ${formatAmount(amount)}đ\n` +
      `📝 Nội dung: ${content}\n\n` +
      `👇 Chọn để xác nhận hoặc từ chối:`,
      quickReplies
    );
    
    return { 
      ok: true,
      debtorAlias: resolvedDebtor || 'Chung',
      message: `⏳ Đã gửi yêu cầu xác nhận đến ${debtorLabel}\n💰 Số tiền: ${formatAmount(amount)}đ\n🔑 Mã: ${debtCode}`
    };
  }
  
  return { 
    ok: true,
    debtorAlias: resolvedDebtor || 'Chung',
    message: `${randomEmoji('success')} Đã ghi nợ: ${formatAmount(amount)}đ\n👤 Người nợ: ${debtorLabel}\n📝 Nội dung: ${content}`
  };
}

async function handleRepayDebt(userId, amount, debtor, content) {
  let debtorUserId = '';
  let status = 'CONFIRMED';
  let debtCode = '';
  let resolvedDebtor = debtor;
  
  if (debtor) {
    // Kiểm tra nếu là số (@1, @2...) thì resolve từ friend list
    if (/^\d+$/.test(debtor)) {
      const aliasFromIndex = await getFriendAliasByIndex(userId, parseInt(debtor));
      if (aliasFromIndex) {
        resolvedDebtor = aliasFromIndex;
      } else {
        return { 
          ok: false, 
          reason: 'INVALID_INDEX',
          message: `❌ Không có bạn số @${debtor}. Gõ "friends" để xem danh sách.`
        };
      }
    }
    
    // Tìm trong friends trước
    debtorUserId = await getFriendUserId(userId, resolvedDebtor);
    
    // Nếu tìm thấy userId của debtor (đã liên kết) -> tạo PENDING để xác nhận
    if (debtorUserId) {
      status = 'PENDING';
      debtCode = generateCode(6);
    }
    // Nếu không tìm thấy -> vẫn ghi trả nợ bình thường với tên đó (CONFIRMED)
  }
  
  const rowData = {
    Date: new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }),
    UserID: userId,
    Debtor: resolvedDebtor || 'Chung',
    Type: 'PAID',
    Amount: amount,
    Content: content,
    DebtorUserID: debtorUserId,
    Status: status,
    DebtCode: debtCode,
  };
  
  await appendRow(rowData);
  
  const debtorLabel = resolvedDebtor ? `@${resolvedDebtor}` : 'Chung';
  
  if (status === 'PENDING' && debtorUserId) {
    const myAlias = await getAliasByUserId(userId);
    const quickReplies = [
      {
        content_type: 'text',
        title: '✅ Xác nhận',
        payload: JSON.stringify({ type: 'CONFIRM_DEBT', code: debtCode })
      },
      {
        content_type: 'text',
        title: '❌ Từ chối',
        payload: JSON.stringify({ type: 'REJECT_DEBT', code: debtCode })
      }
    ];
    
    await sendMessageWithQuickReplies(
      debtorUserId, 
      `📤 TRẢ NỢ TỪ @${myAlias || 'Ai đó'}\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `💰 Số tiền: ${formatAmount(amount)}đ\n` +
      `📝 Nội dung: ${content}\n\n` +
      `👇 Chọn để xác nhận hoặc từ chối:`,
      quickReplies
    );
    
    return { 
      ok: true,
      debtorAlias: resolvedDebtor || 'Chung',
      message: `⏳ Đã gửi yêu cầu xác nhận đến ${debtorLabel}\n💰 Số tiền: ${formatAmount(amount)}đ\n🔑 Mã: ${debtCode}`
    };
  }
  
  return { 
    ok: true,
    debtorAlias: resolvedDebtor || 'Chung',
    message: `${randomEmoji('success')} Đã ghi trả: ${formatAmount(amount)}đ\n👤 Người nhận: ${debtorLabel}\n📝 Nội dung: ${content}`
  };
}

async function handleConfirmDebt(userId, code) {
  const debt = await findDebtByCode(code);
  
  if (!debt) {
    return '❌ Không tìm thấy giao dịch với mã này.';
  }
  
  if (debt.Status !== 'PENDING') {
    return '⚠️ Giao dịch này đã được xử lý.';
  }
  
  if (debt.DebtorUserID !== userId) {
    return '❌ Bạn không có quyền xác nhận giao dịch này.';
  }
  
  const success = await updateDebtStatus(debt, 'CONFIRMED');
  if (!success) {
    return '❌ Lỗi khi xác nhận. Vui lòng thử lại.';
  }
  
  // Thông báo cho người tạo
  const creatorAlias = await getAliasByUserId(debt.UserID);
  await sendMessage(debt.UserID, 
    `✅ @${debt.Debtor} đã XÁC NHẬN!\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `💰 ${formatAmount(debt.Amount)}đ\n` +
    `📝 ${debt.Content}\n` +
    `🔑 Mã: ${code}`
  );
  
  return `✅ Đã xác nhận ${debt.Type === 'DEBT' ? 'nợ' : 'trả'} ${formatAmount(debt.Amount)}đ với @${creatorAlias || 'người gửi'}.`;
}

async function handleRejectDebt(userId, code) {
  const debt = await findDebtByCode(code);
  
  if (!debt) {
    return '❌ Không tìm thấy giao dịch với mã này.';
  }
  
  if (debt.Status !== 'PENDING') {
    return '⚠️ Giao dịch này đã được xử lý.';
  }
  
  if (debt.DebtorUserID !== userId) {
    return '❌ Bạn không có quyền từ chối giao dịch này.';
  }
  
  const success = await updateDebtStatus(debt, 'REJECTED');
  if (!success) {
    return '❌ Lỗi khi từ chối. Vui lòng thử lại.';
  }
  
  // Thông báo cho người tạo
  await sendMessage(debt.UserID, 
    `❌ @${debt.Debtor} đã TỪ CHỐI!\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `💰 ${formatAmount(debt.Amount)}đ\n` +
    `📝 ${debt.Content}\n` +
    `🔑 Mã: ${code}`
  );
  
  return `❌ Đã từ chối giao dịch ${formatAmount(debt.Amount)}đ.`;
}

async function handlePendingList(userId) {
  const pending = await getPendingDebtsForUser(userId);
  
  if (pending.length === 0) {
    return '📋 Không có giao dịch nào chờ xác nhận.';
  }
  
  let response = `📋 GIAO DỊCH CHỜ XÁC NHẬN (${pending.length})\n`;
  response += `━━━━━━━━━━━━━━━━━━━━\n`;
  
  for (const debt of pending) {
    const creatorAlias = await getAliasByUserId(debt.UserID);
    const typeLabel = debt.Type === 'DEBT' ? '🔴 Nợ' : '🟢 Trả';
    response += `${typeLabel} ${formatAmount(debt.Amount)}đ\n`;
    response += `👤 Từ: @${creatorAlias || 'Ai đó'}\n`;
    response += `📝 ${debt.Content}\n`;
    response += `🔑 Mã: ${debt.DebtCode}\n`;
    response += `→ ok ${debt.DebtCode} | huy ${debt.DebtCode}\n\n`;
  }
  
  return response.trim();
}

async function handleListFriends(userId) {
  const friends = await getLinkedFriends(userId);
  const myAlias = await getAliasByUserId(userId);
  
  let response = `👥 DANH SÁCH BẠN BÈ\n`;
  response += `━━━━━━━━━━━━━━━━━━━━\n`;
  response += `📛 Alias của bạn: @${myAlias || '(chưa đặt)'}\n\n`;
  
  if (friends.length === 0) {
    response += `Chưa có bạn bè nào.\n\n`;
    response += `💡 Để liên kết:\n`;
    response += `1. Gõ: alias @TenBan\n`;
    response += `2. Gõ: sharecode\n`;
    response += `3. Gửi mã cho bạn bè`;
  } else {
    friends.forEach((friend, index) => {
      response += `${index + 1}) @${friend.alias || 'Không tên'}\n`;
    });
    response += `\n💡 Mẹo: Dùng @1, @2... thay cho tên khi ghi nợ`;
  }
  
  return response;
}

async function getFriendAliasByIndex(userId, index1Based) {
  const friends = await getLinkedFriends(userId);
  const idx = index1Based - 1;
  if (idx < 0 || idx >= friends.length) return null;
  return friends[idx].alias || null;
}

async function handleMyId(userId) {
  const myAlias = await getAliasByUserId(userId);
  return `🆔 ID của bạn: ${userId}\n` +
         `📛 Alias: @${myAlias || '(chưa đặt)'}\n\n` +
         `💡 Gõ "alias @TenBan" để đặt alias`;
}

async function handleCheckDebt(userId, filterDebtor, onlyOwing = false) {
  const rows = await getRowsByUser(userId);
  
  // Chỉ lấy CONFIRMED rows cho tính toán
  const confirmedRows = rows.filter(r => r.Status === 'CONFIRMED');
  
  if (confirmedRows.length === 0) {
    return '📋 Bạn chưa có giao dịch nào.';
  }
  
  // Load alias cache 1 lần thay vì N lần trong loop (Performance optimization)
  const [friends, aliasCache] = await Promise.all([
    getLinkedFriends(userId),
    buildAliasCache()
  ]);
  
  // Map friend userId -> alias
  const friendAliasMap = {};
  for (const f of friends) {
    friendAliasMap[f.userId] = f.alias;
  }
  
  const debtorStats = {};
  
  for (const row of confirmedRows) {
    let displayName;
    let debtAmount = 0;
    let paidAmount = 0;
    
    if (row.UserID === userId) {
      // Giao dịch MÌNH tạo
      // DEBT: người khác nợ mình -> họ nợ mình
      // PAID: mình trả cho họ -> mình giảm nợ với họ
      displayName = row.Debtor || 'Chung';
      
      if (row.Type === 'DEBT') {
        debtAmount = row.Amount; // Họ nợ mình
      } else if (row.Type === 'PAID') {
        paidAmount = row.Amount; // Mình trả cho họ
      }
    } else if (row.DebtorUserID === userId) {
      // Giao dịch NGƯỜI KHÁC tạo, mình là DebtorUserID
      // Từ góc nhìn người tạo: DEBT = mình nợ họ, PAID = họ trả cho mình
      // Từ góc nhìn MÌNH: DEBT = mình nợ họ (balance âm), PAID = họ trả cho mình (balance dương)
      
      // Lấy tên người tạo (người kia) - dùng cache thay vì gọi getAliasByUserId
      displayName = friendAliasMap[row.UserID] || aliasCache[row.UserID] || 'Ai đó';
      
      if (row.Type === 'DEBT') {
        // Họ ghi "mình nợ họ" -> từ góc nhìn mình: mình nợ họ -> PAID (giảm balance)
        paidAmount = row.Amount;
      } else if (row.Type === 'PAID') {
        // Họ ghi "họ trả cho mình" -> từ góc nhìn mình: họ trả nợ -> DEBT (tăng balance)
        debtAmount = row.Amount;
      }
    } else {
      continue; // Không liên quan đến user này
    }
    
    // Filter theo debtor nếu có
    if (filterDebtor && normalizeVietnamese(displayName) !== normalizeVietnamese(filterDebtor)) {
      continue;
    }
    
    // Dùng normalized key để lookup chính xác (bao = Bao = Bảo)
    const debtorKey = normalizeVietnamese(displayName) || '__unknown__';
    if (!debtorStats[debtorKey]) {
      debtorStats[debtorKey] = { debt: 0, paid: 0, displayName: displayName };
    }
    debtorStats[debtorKey].debt += debtAmount;
    debtorStats[debtorKey].paid += paidAmount;
  }
  
  // Kiểm tra có dữ liệu không
  if (Object.keys(debtorStats).length === 0) {
    if (filterDebtor) {
      return `📋 Không tìm thấy giao dịch của @${filterDebtor}`;
    }
    return '📋 Bạn chưa có giao dịch nào.';
  }
  
  let totalDebt = 0;
  let totalPaid = 0;
  for (const stats of Object.values(debtorStats)) {
    totalDebt += stats.debt;
    totalPaid += stats.paid;
  }
  const totalBalance = totalDebt - totalPaid;
  
  let responseText = '';
  
  if (filterDebtor) {
    // Dùng normalized key để lookup
    const filterKey = normalizeVietnamese(filterDebtor);
    const stats = debtorStats[filterKey] || { debt: 0, paid: 0, displayName: filterDebtor };
    const balance = stats.debt - stats.paid;
    const displayName = stats.displayName || filterDebtor;
    
    responseText = `📊 CHI TIẾT @${displayName}\n`;
    responseText += `━━━━━━━━━━━━━━━━━━━━\n`;
    responseText += `🔴 Tổng nợ: ${formatAmount(stats.debt)}đ\n`;
    responseText += `🟢 Đã trả: ${formatAmount(stats.paid)}đ\n`;
    responseText += `💰 CÒN NỢ: ${formatAmount(balance)}đ\n`;
    
    if (balance > 0) {
      responseText += `\n→ @${displayName} nợ bạn ${formatAmount(balance)}đ`;
    } else if (balance < 0) {
      responseText += `\n→ Bạn nợ @${displayName} ${formatAmount(Math.abs(balance))}đ`;
    } else {
      responseText += `\n→ Hết nợ! 🎉`;
    }
  } else {
    responseText = onlyOwing ? `📊 NGƯỜI CÒN NỢ\n` : `📊 TỔNG HỢP NỢ\n`;
    responseText += `━━━━━━━━━━━━━━━━━━━━\n`;
    
    let sortedDebtors = Object.entries(debtorStats)
      .map(([key, stats]) => ({ name: stats.displayName || key, balance: stats.debt - stats.paid, ...stats }))
      .sort((a, b) => b.balance - a.balance);
    
    if (onlyOwing) {
      sortedDebtors = sortedDebtors.filter(d => d.balance > 0);
    }
    
    if (sortedDebtors.length === 0) {
      return '🎉 Không ai còn nợ bạn!';
    }
    
    for (const d of sortedDebtors) {
      if (d.balance !== 0 || !onlyOwing) {
        const icon = d.balance > 0 ? '🔴' : '🟢';
        const label = d.balance > 0 ? 'nợ bạn' : 'bạn nợ';
        responseText += `${icon} @${d.name}: ${formatAmount(Math.abs(d.balance))}đ (${label})\n`;
      }
    }
    
    responseText += `\n━━━━━━━━━━━━━━━━━━━━\n`;
    if (totalBalance > 0) {
      responseText += `💰 TỔNG: Người khác nợ bạn ${formatAmount(totalBalance)}đ\n`;
    } else if (totalBalance < 0) {
      responseText += `💰 TỔNG: Bạn nợ người khác ${formatAmount(Math.abs(totalBalance))}đ\n`;
    } else {
      responseText += `💰 TỔNG: Hết nợ! 🎉\n`;
    }
    responseText += `\n💡 Gõ "check @Tên" để xem chi tiết`;
  }
  
  return responseText;
}

async function handleUndo(userId) {
  const deleted = await deleteLastTransaction(userId);
  
  if (!deleted) {
    return '📋 Không có giao dịch nào để xóa.';
  }
  
  const typeLabel = deleted.Type === 'DEBT' ? 'Nợ' : 'Trả';
  return `🗑️ Đã xóa giao dịch:\n${typeLabel} ${formatAmount(deleted.Amount)}đ - @${deleted.Debtor}\n📝 ${deleted.Content}`;
}

async function handleSearch(userId, keyword) {
  const rows = await getRowsByUser(userId);
  const myRows = rows.filter(r => r.UserID === userId);
  
  const keywordLower = keyword.toLowerCase();
  const results = myRows.filter(r => 
    r.Content.toLowerCase().includes(keywordLower) ||
    r.Debtor.toLowerCase().includes(keywordLower)
  );
  
  if (results.length === 0) {
    return `🔍 Không tìm thấy giao dịch với "${keyword}"`;
  }
  
  let responseText = `🔍 Tìm thấy ${results.length} giao dịch:\n━━━━━━━━━━━━━━━━━━━━\n`;
  
  const last10 = results.slice(-10).reverse();
  last10.forEach((row, i) => {
    const typeLabel = row.Type === 'DEBT' ? '🔴' : '🟢';
    const statusLabel = row.Status === 'PENDING' ? ' ⏳' : '';
    responseText += `${i+1}. ${typeLabel} ${formatAmount(row.Amount)}đ @${row.Debtor}${statusLabel}\n`;
    if (row.Content) {
      responseText += `   📝 ${row.Content}\n`;
    }
  });
  
  if (results.length > 10) {
    responseText += `\n... và ${results.length - 10} giao dịch khác`;
  }
  
  return responseText;
}

async function handleStats(userId, period) {
  const rows = await getRowsByUser(userId);
  // Include cả rows mình tạo và rows người khác tạo có mình là DebtorUserID (2-way sync)
  const confirmedRows = rows.filter(r => r.Status === 'CONFIRMED');
  
  const now = new Date();
  let startDate;
  let periodLabel;
  
  const periodLower = period.toLowerCase().replace(/\s+/g, '');
  
  if (periodLower.includes('homnay') || periodLower.includes('hômnay')) {
    startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    periodLabel = 'Hôm nay';
  } else if (periodLower.includes('tuannay') || periodLower.includes('tuầnnày')) {
    const dayOfWeek = now.getDay();
    const diff = now.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
    startDate = new Date(now.getFullYear(), now.getMonth(), diff);
    periodLabel = 'Tuần này';
  } else if (periodLower.includes('tuantruoc') || periodLower.includes('tuầntrước')) {
    const dayOfWeek = now.getDay();
    const diff = now.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1) - 7;
    startDate = new Date(now.getFullYear(), now.getMonth(), diff);
    periodLabel = 'Tuần trước';
  } else if (periodLower.includes('thangnay') || periodLower.includes('thángnày')) {
    startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    periodLabel = 'Tháng này';
  } else if (periodLower.includes('thangtruoc') || periodLower.includes('thángtrước')) {
    startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    periodLabel = 'Tháng trước';
  } else {
    startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    periodLabel = 'Tháng này';
  }
  
  const filteredRows = confirmedRows.filter(row => {
    try {
      const parts = row.Date.split(/[,\s]+/);
      const datePart = parts.find(p => p.includes('/'));
      if (!datePart) return false;
      const [day, month, year] = datePart.split('/').map(Number);
      const rowDate = new Date(year, month - 1, day);
      return rowDate >= startDate;
    } catch {
      return false;
    }
  });
  
  if (filteredRows.length === 0) {
    return `📊 ${periodLabel}: Không có giao dịch nào.`;
  }
  
  // Áp dụng logic 2-way như handleCheckDebt
  let totalOthersOweMe = 0;  // Người khác nợ mình
  let totalIOweOthers = 0;   // Mình nợ người khác
  
  for (const row of filteredRows) {
    if (row.UserID === userId) {
      // Giao dịch MÌNH tạo
      if (row.Type === 'DEBT') {
        totalOthersOweMe += row.Amount; // Họ nợ mình
      } else if (row.Type === 'PAID') {
        totalIOweOthers += row.Amount;  // Mình trả cho họ (giảm nợ)
      }
    } else if (row.DebtorUserID === userId) {
      // Giao dịch NGƯỜI KHÁC tạo, mình là debtor
      if (row.Type === 'DEBT') {
        totalIOweOthers += row.Amount;  // Mình nợ họ
      } else if (row.Type === 'PAID') {
        totalOthersOweMe += row.Amount; // Họ trả cho mình
      }
    }
  }
  
  const netBalance = totalOthersOweMe - totalIOweOthers;
  
  let responseText = `📊 THỐNG KÊ ${periodLabel.toUpperCase()}\n`;
  responseText += `━━━━━━━━━━━━━━━━━━━━\n`;
  responseText += `📈 Số giao dịch: ${filteredRows.length}\n`;
  responseText += `🔴 Người khác nợ bạn: ${formatAmount(totalOthersOweMe)}đ\n`;
  responseText += `🟢 Bạn nợ người khác: ${formatAmount(totalIOweOthers)}đ\n`;
  if (netBalance > 0) {
    responseText += `💰 Tổng cộng: Người khác nợ bạn ${formatAmount(netBalance)}đ\n`;
  } else if (netBalance < 0) {
    responseText += `💰 Tổng cộng: Bạn nợ người khác ${formatAmount(Math.abs(netBalance))}đ\n`;
  } else {
    responseText += `💰 Tổng cộng: Hết nợ! 🎉\n`;
  }
  
  return responseText;
}

function handleHelp() {
  return `📚 HƯỚNG DẪN SỬ DỤNG

━━━━━━━━━━━━━━━━━━━━
📝 GHI NỢ:
• no 50k @A tiền cơm
• no tuan 50k tiền cơm
• tuan no 50k tiền cơm
• nợ 1tr @1 mua đồ (dùng số)

━━━━━━━━━━━━━━━━━━━━
💵 TRẢ NỢ:
• tra 20k @A
• tra bao 50k lương về
• bao tra 50k

━━━━━━━━━━━━━━━━━━━━
📊 XEM NỢ:
• check - tất cả
• check @A - riêng A
• check conno - còn nợ
• pending - chờ xác nhận

━━━━━━━━━━━━━━━━━━━━
🔗 LIÊN KẾT BẠN BÈ:
• alias @TenBan - đặt tên
• sharecode - tạo mã
• link ABC123 @Ban - liên kết
• friends - danh sách bạn

━━━━━━━━━━━━━━━━━━━━
✅ XÁC NHẬN NỢ:
• ok MACODE - xác nhận
• huy MACODE - từ chối

━━━━━━━━━━━━━━━━━━━━
💡 MẸO:
• Gõ tự nhiên: tuan no 50k cơm
• Không cần @: no bao 50k
• Dùng @1, @2... thay cho tên`;
}

// ============================================
// WEBHOOK CONTROLLER
// ============================================

async function handleMessage(userId, messageText) {
  console.log(`📩 Nhận tin nhắn từ ${userId}: ${messageText}`);
  
  try {
    // Auto-set alias từ tên Facebook nếu user mới
    const autoAlias = await autoSetAliasFromFacebook(userId);
    if (autoAlias) {
      await sendMessage(userId, 
        `${randomEmoji('greeting')} Chào bạn! Mình đặt tên cho bạn là @${autoAlias}\n` +
        `💡 Gõ "alias @TenKhac" nếu muốn đổi.`
      );
    }
    
    const command = await parseCommand(userId, messageText);
    
    if (!command) {
      await sendMessage(userId, '❓ Không hiểu lệnh. Gõ "help" để xem hướng dẫn.');
      return;
    }
    
    let response;
    
    switch (command.intent) {
      case 'SET_ALIAS':
        response = await handleSetAlias(userId, command.alias);
        break;
        
      case 'CREATE_SHARE_CODE':
        response = await handleCreateShareCode(userId);
        break;
        
      case 'LINK_FRIEND':
        response = await handleLinkFriend(userId, command.code, command.alias);
        break;
        
      case 'CONFIRM_DEBT':
        response = await handleConfirmDebt(userId, command.code);
        break;
        
      case 'REJECT_DEBT':
        response = await handleRejectDebt(userId, command.code);
        break;
        
      case 'PENDING_LIST':
        response = await handlePendingList(userId);
        break;
        
      case 'LIST_FRIENDS':
        response = await handleListFriends(userId);
        break;
        
      case 'MY_ID':
        response = await handleMyId(userId);
        break;
        
      case 'DEBT':
        response = await handleAddDebt(userId, command.amount, command.debtor, command.content);
        // Xử lý lỗi INVALID_INDEX
        if (typeof response === 'object' && !response.ok) {
          if (response.reason === 'INVALID_INDEX') {
            await sendMessage(userId, response.message);
            return;
          }
        }
        // ✅ Ghi nợ thành công -> Quick replies gợi ý
        {
          // Dùng resolved alias từ response, không dùng command.debtor (có thể là "1")
          const debtorAlias = (typeof response === 'object' && response.debtorAlias) || command.debtor || 'Chung';
          const successQuickReplies = [
            {
              content_type: 'text',
              title: '📝 Ghi nợ tiếp',
              payload: JSON.stringify({ type: 'SUGGEST_ACTION', action: 'DEBT' })
            },
            {
              content_type: 'text',
              title: `📊 Xem @${debtorAlias}`,
              payload: JSON.stringify({ type: 'SUGGEST_ACTION', action: 'CHECK', debtor: debtorAlias })
            },
            {
              content_type: 'text',
              title: '↩️ Undo',
              payload: JSON.stringify({ type: 'SUGGEST_ACTION', action: 'UNDO' })
            }
          ];
          const responseText = typeof response === 'string' ? response : response.message;
          await sendMessageWithQuickReplies(userId, responseText, successQuickReplies);
          return;
        }
        
      case 'PAID':
        response = await handleRepayDebt(userId, command.amount, command.debtor, command.content);
        // Xử lý lỗi INVALID_INDEX
        if (typeof response === 'object' && !response.ok) {
          if (response.reason === 'INVALID_INDEX') {
            await sendMessage(userId, response.message);
            return;
          }
        }
        // ✅ Trả nợ thành công -> Quick replies gợi ý
        {
          // Dùng resolved alias từ response, không dùng command.debtor (có thể là "1")
          const debtorAlias = (typeof response === 'object' && response.debtorAlias) || command.debtor || 'Chung';
          const successQuickReplies = [
            {
              content_type: 'text',
              title: '💵 Trả nợ tiếp',
              payload: JSON.stringify({ type: 'SUGGEST_ACTION', action: 'PAID' })
            },
            {
              content_type: 'text',
              title: `📊 Xem @${debtorAlias}`,
              payload: JSON.stringify({ type: 'SUGGEST_ACTION', action: 'CHECK', debtor: debtorAlias })
            },
            {
              content_type: 'text',
              title: '↩️ Undo',
              payload: JSON.stringify({ type: 'SUGGEST_ACTION', action: 'UNDO' })
            }
          ];
          const responseText = typeof response === 'string' ? response : response.message;
          await sendMessageWithQuickReplies(userId, responseText, successQuickReplies);
          return;
        }
        
      case 'CHECK':
        response = await handleCheckDebt(userId, command.debtor, command.onlyOwing);
        // ✅ Xem nợ xong -> Quick replies gợi ý
        {
          const checkQuickReplies = [
            {
              content_type: 'text',
              title: '📝 Ghi nợ',
              payload: JSON.stringify({ type: 'SUGGEST_ACTION', action: 'DEBT' })
            },
            {
              content_type: 'text',
              title: '💵 Trả nợ',
              payload: JSON.stringify({ type: 'SUGGEST_ACTION', action: 'PAID' })
            },
            {
              content_type: 'text',
              title: '⏳ Pending',
              payload: JSON.stringify({ type: 'SUGGEST_ACTION', action: 'PENDING' })
            }
          ];
          await sendMessageWithQuickReplies(userId, response, checkQuickReplies);
          return;
        }
        
      case 'UNDO':
        response = await handleUndo(userId);
        // ✅ Undo xong -> Quick replies gợi ý
        {
          const undoQuickReplies = [
            {
              content_type: 'text',
              title: '📝 Ghi nợ',
              payload: JSON.stringify({ type: 'SUGGEST_ACTION', action: 'DEBT' })
            },
            {
              content_type: 'text',
              title: '💵 Trả nợ',
              payload: JSON.stringify({ type: 'SUGGEST_ACTION', action: 'PAID' })
            },
            {
              content_type: 'text',
              title: '📊 Xem nợ',
              payload: JSON.stringify({ type: 'SUGGEST_ACTION', action: 'CHECK' })
            }
          ];
          await sendMessageWithQuickReplies(userId, response, undoQuickReplies);
          return;
        }
        
      case 'SEARCH':
        response = await handleSearch(userId, command.keyword);
        break;
        
      case 'STATS':
        response = await handleStats(userId, command.period);
        break;
        
      case 'HELP':
        response = handleHelp();
        break;
        
      default:
        response = '❓ Không hiểu lệnh. Gõ "help" để xem hướng dẫn.';
    }
    
    await sendMessage(userId, response);
    
  } catch (error) {
    console.error('❌ Lỗi xử lý tin nhắn:', error.message);
    await sendMessage(userId, '❌ Đã xảy ra lỗi. Vui lòng thử lại sau.');
  }
}

// ============================================
// ROUTES
// ============================================

app.get('/', (req, res) => {
  res.send('🤖 Facebook Debt Tracker Bot đang hoạt động!');
});

app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  
  console.log('🔐 Xác thực webhook:', { mode, token, challenge: challenge?.substring(0, 20) });
  
  if (mode === 'subscribe' && token === config.VERIFY_TOKEN) {
    console.log('✅ Webhook xác thực thành công');
    res.status(200).send(challenge);
  } else {
    console.error('❌ Webhook xác thực thất bại');
    res.sendStatus(403);
  }
});

app.post('/webhook', async (req, res) => {
  const body = req.body;
  
  // Verify webhook signature nếu APP_SECRET được cấu hình
  if (config.APP_SECRET) {
    if (!verifyWebhookSignature(req)) {
      console.error('❌ Webhook signature verification failed');
      return res.sendStatus(403);
    }
  } else {
    console.warn('⚠️ APP_SECRET chưa được cấu hình - webhook không được bảo vệ!');
  }
  
  if (body.object !== 'page') {
    res.sendStatus(404);
    return;
  }
  
  res.status(200).send('EVENT_RECEIVED');
  
  for (const entry of body.entry || []) {
    const messagingEvents = entry.messaging || [];
    
    for (const event of messagingEvents) {
      if (event.message && event.message.text) {
        const senderId = event.sender.id;
        const messageText = event.message.text;
        
        if (event.message.is_echo) {
          continue;
        }
        
        // Xử lý Quick Reply payload
        if (event.message.quick_reply && event.message.quick_reply.payload) {
          try {
            const payload = JSON.parse(event.message.quick_reply.payload);
            
            // Xử lý xác nhận/từ chối nợ bằng button
            if (payload.type === 'CONFIRM_DEBT') {
              const result = await handleConfirmDebt(senderId, payload.code);
              await sendMessage(senderId, result);
              continue;
            }
            
            if (payload.type === 'REJECT_DEBT') {
              const result = await handleRejectDebt(senderId, payload.code);
              await sendMessage(senderId, result);
              continue;
            }
            
            // Xử lý xác nhận link và ghi nợ
            if (payload.type === 'CONFIRM_LINK_AND_DEBT') {
              const { targetUserId, targetAlias, amount, content, commandType } = payload;
              
              // Tạo FriendLink
              const linkResult = await createDirectFriendLink(senderId, targetUserId, targetAlias);
              
              if (!linkResult.success) {
                await sendMessage(senderId, '❌ Lỗi khi liên kết. Vui lòng thử lại.');
                continue;
              }
              
              // Thông báo liên kết thành công (nếu mới)
              if (!linkResult.alreadyLinked) {
                await sendMessage(senderId, `✅ Đã liên kết với @${targetAlias}!`);
              }
              
              // Ghi nợ/trả nợ
              let result;
              if (commandType === 'DEBT') {
                result = await handleAddDebt(senderId, amount, targetAlias, content);
              } else {
                result = await handleRepayDebt(senderId, amount, targetAlias, content);
              }
              const text = typeof result === 'string' ? result : result.message;
              await sendMessage(senderId, text);
              continue;
            }
            
            // Xử lý hủy action
            if (payload.type === 'CANCEL_ACTION') {
              await sendMessage(senderId, '👌 Đã hủy.');
              continue;
            }
            
            // Xử lý chọn người nợ từ quick reply
            if (payload.type === 'QUICK_REPLY_DEBT') {
              const { amount, content, chosenAlias, commandType } = payload;
              let result;
              if (commandType === 'DEBT') {
                result = await handleAddDebt(senderId, amount, chosenAlias, content);
              } else {
                result = await handleRepayDebt(senderId, amount, chosenAlias, content);
              }
              const text = typeof result === 'string' ? result : result.message;
              await sendMessage(senderId, text);
              continue;
            }
            
            // Xử lý gợi ý action từ quick reply
            if (payload.type === 'SUGGEST_ACTION') {
              const { action, debtor } = payload;
              
              if (action === 'DEBT') {
                await sendMessage(senderId, '📝 Nhập lệnh ghi nợ:\nVD: no bao 50k tiền cơm');
                continue;
              }
              
              if (action === 'PAID') {
                await sendMessage(senderId, '💵 Nhập lệnh trả nợ:\nVD: tra bao 50k');
                continue;
              }
              
              if (action === 'CHECK') {
                let result;
                if (debtor && debtor !== 'Chung') {
                  result = await handleCheckDebt(senderId, debtor, false);
                } else {
                  result = await handleCheckDebt(senderId, null, false);
                }
                await sendMessage(senderId, result);
                continue;
              }
              
              if (action === 'UNDO') {
                const result = await handleUndo(senderId);
                await sendMessage(senderId, result);
                continue;
              }
              
              if (action === 'PENDING') {
                const result = await handlePendingList(senderId);
                await sendMessage(senderId, result);
                continue;
              }
            }
          } catch (err) {
            console.error('❌ Lỗi xử lý quick reply:', err);
          }
        }
        
        handleMessage(senderId, messageText).catch(err => {
          console.error('❌ Lỗi xử lý message:', err);
        });
      }
    }
  }
});

// ============================================
// KHỞI ĐỘNG SERVER
// ============================================
app.listen(config.PORT, () => {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🚀 Facebook Debt Tracker Bot v2.4');
  console.log('🐛 Bug fixes + 🔒 Webhook security + ⚡ Performance');
  console.log(`📡 Server đang chạy tại port ${config.PORT}`);
  console.log(`📊 Google Sheet ID: ${config.GOOGLE_SHEET_ID.substring(0, 10)}...`);
  console.log(`🔒 Webhook security: ${config.APP_SECRET ? 'ENABLED' : 'DISABLED'}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
});
