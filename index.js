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

// ============================================
// KHỞI TẠO EXPRESS APP
// ============================================
const path = require('path');
const app = express();
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// ============================================
// UTILITY FUNCTIONS
// ============================================

function generateCode(length = 6) {
  return crypto.randomBytes(4).toString('hex').toUpperCase().substring(0, length);
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
    
    // Kiểm tra alias đã tồn tại chưa
    const existingAlias = rows.find(r => r.get('Alias')?.toLowerCase() === alias.toLowerCase());
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
    
    const row = rows.find(r => r.get('Alias')?.toLowerCase() === alias.toLowerCase());
    return row ? row.get('UserID') : null;
  } catch (error) {
    console.error('❌ Lỗi getUserIdByAlias:', error.message);
    return null;
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
    
    // Tìm trong FriendLinks trước
    for (const row of rows) {
      if (row.get('Status') !== 'ACTIVE') continue;
      
      if (row.get('UserID_A') === userId && 
          row.get('AliasOfBForA')?.toLowerCase() === friendAlias.toLowerCase()) {
        return row.get('UserID_B');
      }
      if (row.get('UserID_B') === userId && 
          row.get('AliasOfAForB')?.toLowerCase() === friendAlias.toLowerCase()) {
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

async function sendMessage(recipientId, messageText) {
  const url = `https://graph.facebook.com/v18.0/me/messages?access_token=${config.PAGE_ACCESS_TOKEN}`;
  
  try {
    await axios.post(url, {
      recipient: { id: recipientId },
      message: { text: messageText },
    });
    console.log(`📤 Đã gửi tin nhắn đến ${recipientId}`);
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

function parseCommand(text) {
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
  
  // ============ EXISTING COMMANDS ============
  
  // Regex cho lệnh GHI NỢ: "no", "nợ"
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
  
  // Regex cho lệnh TRẢ NỢ: "tra", "trả"
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
  const checkRegex = /^(check|tong|tổng|show\s*no|xem\s*no|xem\s*nợ)\s*(conno|còn\s*nợ|@\S+)?$/i;
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
  
  // Nếu có @mention, thử tìm userId của người đó
  if (debtor) {
    debtorUserId = await getFriendUserId(userId, debtor);
    
    // Nếu tìm thấy userId của debtor -> tạo PENDING debt
    if (debtorUserId) {
      status = 'PENDING';
      debtCode = generateCode(6);
    }
  }
  
  const rowData = {
    Date: new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }),
    UserID: userId,
    Debtor: debtor || 'Chung',
    Type: 'DEBT',
    Amount: amount,
    Content: content,
    DebtorUserID: debtorUserId,
    Status: status,
    DebtCode: debtCode,
  };
  
  await appendRow(rowData);
  
  const debtorLabel = debtor ? `@${debtor}` : 'Chung';
  
  // Nếu có PENDING debt, thông báo cho người nợ
  if (status === 'PENDING' && debtorUserId) {
    const myAlias = await getAliasByUserId(userId);
    await sendMessage(debtorUserId, 
      `📥 NỢ MỚI TỪ @${myAlias || 'Ai đó'}\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `💰 Số tiền: ${formatAmount(amount)}đ\n` +
      `📝 Nội dung: ${content}\n` +
      `🔑 Mã: ${debtCode}\n\n` +
      `Trả lời:\n` +
      `• ok ${debtCode} - Xác nhận\n` +
      `• huy ${debtCode} - Từ chối`
    );
    
    return `⏳ Đã gửi yêu cầu xác nhận đến @${debtor}\n` +
           `💰 Số tiền: ${formatAmount(amount)}đ\n` +
           `🔑 Mã: ${debtCode}`;
  }
  
  return `✅ Đã ghi nợ: ${formatAmount(amount)}đ\n👤 Người nợ: ${debtorLabel}\n📝 Nội dung: ${content}`;
}

async function handleRepayDebt(userId, amount, debtor, content) {
  let debtorUserId = '';
  let status = 'CONFIRMED';
  let debtCode = '';
  
  if (debtor) {
    debtorUserId = await getFriendUserId(userId, debtor);
    
    if (debtorUserId) {
      status = 'PENDING';
      debtCode = generateCode(6);
    }
  }
  
  const rowData = {
    Date: new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }),
    UserID: userId,
    Debtor: debtor || 'Chung',
    Type: 'PAID',
    Amount: amount,
    Content: content,
    DebtorUserID: debtorUserId,
    Status: status,
    DebtCode: debtCode,
  };
  
  await appendRow(rowData);
  
  const debtorLabel = debtor ? `@${debtor}` : 'Chung';
  
  if (status === 'PENDING' && debtorUserId) {
    const myAlias = await getAliasByUserId(userId);
    await sendMessage(debtorUserId, 
      `📤 TRẢ NỢ TỪ @${myAlias || 'Ai đó'}\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `💰 Số tiền: ${formatAmount(amount)}đ\n` +
      `📝 Nội dung: ${content}\n` +
      `🔑 Mã: ${debtCode}\n\n` +
      `Trả lời:\n` +
      `• ok ${debtCode} - Xác nhận\n` +
      `• huy ${debtCode} - Từ chối`
    );
    
    return `⏳ Đã gửi yêu cầu xác nhận đến @${debtor}\n` +
           `💰 Số tiền: ${formatAmount(amount)}đ\n` +
           `🔑 Mã: ${debtCode}`;
  }
  
  return `✅ Đã ghi trả: ${formatAmount(amount)}đ\n👤 Người nhận: ${debtorLabel}\n📝 Nội dung: ${content}`;
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
    for (const friend of friends) {
      response += `• @${friend.alias || 'Không tên'}\n`;
    }
    response += `\n💡 Gõ "sharecode" để thêm bạn mới`;
  }
  
  return response;
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
  
  // Lọc rows thuộc về user này (là người tạo)
  const myRows = confirmedRows.filter(r => r.UserID === userId);
  
  if (myRows.length === 0) {
    return '📋 Bạn chưa có giao dịch nào.';
  }
  
  const filteredRows = filterDebtor 
    ? myRows.filter(r => r.Debtor.toLowerCase() === filterDebtor.toLowerCase())
    : myRows;
  
  if (filterDebtor && filteredRows.length === 0) {
    return `📋 Không tìm thấy giao dịch của @${filterDebtor}`;
  }
  
  const debtorStats = {};
  
  for (const row of filteredRows) {
    const debtor = row.Debtor || 'Chung';
    if (!debtorStats[debtor]) {
      debtorStats[debtor] = { debt: 0, paid: 0 };
    }
    if (row.Type === 'DEBT') {
      debtorStats[debtor].debt += row.Amount;
    } else if (row.Type === 'PAID') {
      debtorStats[debtor].paid += row.Amount;
    }
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
    const stats = debtorStats[filterDebtor] || { debt: 0, paid: 0 };
    const balance = stats.debt - stats.paid;
    
    responseText = `📊 CHI TIẾT @${filterDebtor}\n`;
    responseText += `━━━━━━━━━━━━━━━━━━━━\n`;
    responseText += `🔴 Tổng nợ: ${formatAmount(stats.debt)}đ\n`;
    responseText += `🟢 Đã trả: ${formatAmount(stats.paid)}đ\n`;
    responseText += `💰 CÒN NỢ: ${formatAmount(balance)}đ\n`;
    
    const last5 = filteredRows.slice(-5).reverse();
    if (last5.length > 0) {
      responseText += `\n📋 Giao dịch gần nhất:\n`;
      last5.forEach((row, i) => {
        const typeLabel = row.Type === 'DEBT' ? '🔴' : '🟢';
        responseText += `${i+1}. ${typeLabel} ${formatAmount(row.Amount)}đ\n`;
      });
    }
  } else {
    responseText = onlyOwing ? `📊 NGƯỜI CÒN NỢ\n` : `📊 TỔNG HỢP NỢ\n`;
    responseText += `━━━━━━━━━━━━━━━━━━━━\n`;
    
    let sortedDebtors = Object.entries(debtorStats)
      .map(([name, stats]) => ({ name, balance: stats.debt - stats.paid, ...stats }))
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
        responseText += `${icon} @${d.name}: ${formatAmount(d.balance)}đ\n`;
      }
    }
    
    responseText += `\n━━━━━━━━━━━━━━━━━━━━\n`;
    responseText += `💰 TỔNG CÒN NỢ: ${formatAmount(totalBalance)}đ\n`;
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
  const myRows = rows.filter(r => r.UserID === userId && r.Status === 'CONFIRMED');
  
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
  
  const filteredRows = myRows.filter(row => {
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
  
  let totalDebt = 0;
  let totalPaid = 0;
  
  for (const row of filteredRows) {
    if (row.Type === 'DEBT') {
      totalDebt += row.Amount;
    } else {
      totalPaid += row.Amount;
    }
  }
  
  let responseText = `📊 THỐNG KÊ ${periodLabel.toUpperCase()}\n`;
  responseText += `━━━━━━━━━━━━━━━━━━━━\n`;
  responseText += `📈 Số giao dịch: ${filteredRows.length}\n`;
  responseText += `🔴 Nợ mới: ${formatAmount(totalDebt)}đ\n`;
  responseText += `🟢 Đã trả: ${formatAmount(totalPaid)}đ\n`;
  responseText += `💰 Chênh lệch: ${formatAmount(totalDebt - totalPaid)}đ\n`;
  
  return responseText;
}

function handleHelp() {
  return `📚 HƯỚNG DẪN SỬ DỤNG

━━━━━━━━━━━━━━━━━━━━
📝 GHI NỢ:
• no 50k @A tiền cơm
• nợ 1tr @B mua đồ

━━━━━━━━━━━━━━━━━━━━
💵 TRẢ NỢ:
• tra 20k @A
• trả 500k @B

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
🔧 KHÁC:
• xoa - xóa giao dịch cuối
• tim [từ] - tìm kiếm
• thang nay - thống kê`;
}

// ============================================
// WEBHOOK CONTROLLER
// ============================================

async function handleMessage(userId, messageText) {
  console.log(`📩 Nhận tin nhắn từ ${userId}: ${messageText}`);
  
  try {
    const command = parseCommand(messageText);
    
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
        break;
        
      case 'PAID':
        response = await handleRepayDebt(userId, command.amount, command.debtor, command.content);
        break;
        
      case 'CHECK':
        response = await handleCheckDebt(userId, command.debtor, command.onlyOwing);
        break;
        
      case 'UNDO':
        response = await handleUndo(userId);
        break;
        
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
  console.log('🚀 Facebook Debt Tracker Bot v2.0');
  console.log('✨ Tính năng mới: Đồng bộ 2 chiều');
  console.log(`📡 Server đang chạy tại port ${config.PORT}`);
  console.log(`📊 Google Sheet ID: ${config.GOOGLE_SHEET_ID.substring(0, 10)}...`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
});
