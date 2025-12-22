/**
 * Facebook Messenger Bot - Theo dõi nợ cá nhân
 * Sử dụng Google Sheets làm database
 * 
 * Tác giả: Senior Backend Developer
 * Tính năng:
 *   - Ghi nợ: "no [số tiền] [nội dung]" hoặc "nợ [số tiền] [nội dung]"
 *   - Trả nợ: "tra [số tiền] [nội dung]" hoặc "trả [số tiền] [nội dung]"
 *   - Xem nợ: "check", "tong", "tổng", "show no"
 */

require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

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
// GOOGLE SHEETS REPOSITORY
// ============================================

/**
 * Khởi tạo kết nối Google Sheets với Service Account
 * @returns {Promise<GoogleSpreadsheet>}
 */
async function getGoogleSheet() {
  try {
    const serviceAccountAuth = new JWT({
      email: config.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      key: config.GOOGLE_PRIVATE_KEY,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const doc = new GoogleSpreadsheet(config.GOOGLE_SHEET_ID, serviceAccountAuth);
    await doc.loadInfo();
    return doc;
  } catch (error) {
    console.error('❌ Lỗi kết nối Google Sheets:', error.message);
    throw new Error('Không thể kết nối Google Sheets');
  }
}

/**
 * Đảm bảo header có cột Debtor (migrate schema)
 * @param {GoogleSpreadsheetWorksheet} sheet
 */
async function ensureDebtorColumn(sheet) {
  await sheet.loadHeaderRow();
  const headers = sheet.headerValues;
  if (!headers.includes('Debtor')) {
    const newHeaders = [...headers];
    const contentIndex = newHeaders.indexOf('Content');
    if (contentIndex !== -1) {
      newHeaders.splice(contentIndex, 0, 'Debtor');
    } else {
      newHeaders.push('Debtor');
    }
    await sheet.setHeaderRow(newHeaders);
    console.log('✅ Đã thêm cột Debtor vào Sheet');
  }
}

/**
 * Thêm một dòng mới vào Google Sheet
 * @param {Object} rowData - Dữ liệu dòng: { Date, UserID, Debtor, Type, Amount, Content }
 */
async function appendRow(rowData) {
  try {
    const doc = await getGoogleSheet();
    const sheet = doc.sheetsByIndex[0];
    
    await ensureDebtorColumn(sheet);
    
    await sheet.addRow({
      Date: rowData.Date,
      UserID: rowData.UserID,
      Debtor: rowData.Debtor || 'Chung',
      Type: rowData.Type,
      Amount: rowData.Amount,
      Content: rowData.Content || '',
    });
    
    console.log(`✅ Đã thêm dòng: ${rowData.Type} - ${rowData.Amount} - @${rowData.Debtor || 'Chung'}`);
  } catch (error) {
    console.error('❌ Lỗi thêm dòng vào Sheet:', error.message);
    throw new Error('Không thể ghi dữ liệu vào Google Sheets');
  }
}

/**
 * Lấy tất cả các dòng của một User
 * @param {string} userId - Facebook User ID (PSID)
 * @returns {Promise<Array>} - Danh sách các giao dịch
 */
async function getRowsByUser(userId) {
  try {
    const doc = await getGoogleSheet();
    const sheet = doc.sheetsByIndex[0];
    const rows = await sheet.getRows();
    
    // Lọc các dòng theo UserID
    const userRows = rows.filter(row => row.get('UserID') === userId);
    
    return userRows.map(row => ({
      Date: row.get('Date'),
      UserID: row.get('UserID'),
      Debtor: row.get('Debtor') || 'Chung',
      Type: row.get('Type'),
      Amount: parseInt(row.get('Amount')) || 0,
      Content: row.get('Content') || '',
    }));
  } catch (error) {
    console.error('❌ Lỗi đọc dữ liệu từ Sheet:', error.message);
    throw new Error('Không thể đọc dữ liệu từ Google Sheets');
  }
}

// ============================================
// MESSENGER CLIENT - GỬI TIN NHẮN
// ============================================

/**
 * Gửi tin nhắn text đến người dùng qua Facebook Send API
 * @param {string} recipientId - Facebook User ID (PSID)
 * @param {string} messageText - Nội dung tin nhắn
 */
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
    throw new Error('Không thể gửi tin nhắn');
  }
}

// ============================================
// COMMAND PARSER - PHÂN TÍCH LỆNH
// ============================================

/**
 * Chuyển đổi số tiền từ string sang number
 * Hỗ trợ: 50k -> 50000, 1m -> 1000000, 1.5m -> 1500000
 * @param {string} amountStr - Chuỗi số tiền
 * @returns {number|null} - Số tiền đã chuyển đổi hoặc null nếu không hợp lệ
 */
function parseAmount(amountStr) {
  if (!amountStr) return null;
  
  // Loại bỏ dấu phân cách
  let cleaned = amountStr.toLowerCase().replace(/,/g, '').trim();
  
  let multiplier = 1;
  
  // Xử lý hậu tố k, m
  if (cleaned.endsWith('k')) {
    multiplier = 1000;
    cleaned = cleaned.slice(0, -1);
  } else if (cleaned.endsWith('m')) {
    multiplier = 1000000;
    cleaned = cleaned.slice(0, -1);
  }
  
  // Parse số
  const number = parseFloat(cleaned);
  
  if (isNaN(number) || number <= 0) {
    return null;
  }
  
  // Giới hạn tối đa để tránh dữ liệu bẩn (1 tỷ)
  const result = Math.round(number * multiplier);
  if (result > 1000000000000) {
    return null;
  }
  
  return result;
}

/**
 * Format số tiền để hiển thị (thêm dấu phân cách hàng nghìn)
 * @param {number} amount - Số tiền
 * @returns {string} - Chuỗi đã format
 */
function formatAmount(amount) {
  return amount.toLocaleString('vi-VN');
}

/**
 * Phân tích lệnh từ tin nhắn
 * @param {string} text - Nội dung tin nhắn
 * @returns {Object|null} - { intent, amount, debtor, content } hoặc null
 */
function parseCommand(text) {
  if (!text) return null;
  
  const normalizedText = text.trim().toLowerCase();
  
  // Regex cho lệnh GHI NỢ: "no", "nợ"
  // Format: no 50k @TenNguoi noi dung
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
  
  // Regex cho lệnh XEM NỢ: "check", "tong", "tổng", "show no"
  // Có thể kèm @TenNguoi để xem riêng
  const checkRegex = /^(check|tong|tổng|show\s*no|xem\s*no|xem\s*nợ)\s*(@\S+)?$/i;
  const checkMatch = normalizedText.match(checkRegex);
  if (checkMatch) {
    let debtor = null;
    if (checkMatch[2]) {
      debtor = checkMatch[2].replace('@', '').replace(/_/g, ' ').trim();
    }
    return { intent: 'CHECK', debtor: debtor };
  }
  
  // Regex cho lệnh HELP
  const helpRegex = /^(help|huong\s*dan|hướng\s*dẫn|menu|\?)$/i;
  if (helpRegex.test(normalizedText)) {
    return { intent: 'HELP' };
  }
  
  return null;
}

/**
 * Parse debtor và content từ phần còn lại của lệnh
 * @param {string} remainder - Phần text sau số tiền
 * @returns {Object} - { debtor, content }
 */
function parseDebtorAndContent(remainder) {
  if (!remainder) {
    return { debtor: null, content: '' };
  }
  
  const trimmed = remainder.trim();
  
  // Kiểm tra xem có bắt đầu bằng @TenNguoi không
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

/**
 * Xử lý lệnh ghi nợ
 * @param {string} userId - Facebook User ID
 * @param {number} amount - Số tiền
 * @param {string} debtor - Tên người nợ
 * @param {string} content - Nội dung
 * @returns {Promise<string>} - Tin nhắn phản hồi
 */
async function handleAddDebt(userId, amount, debtor, content) {
  const rowData = {
    Date: new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }),
    UserID: userId,
    Debtor: debtor || 'Chung',
    Type: 'DEBT',
    Amount: amount,
    Content: content,
  };
  
  await appendRow(rowData);
  
  const debtorLabel = debtor ? `@${debtor}` : 'Chung';
  return `✅ Đã ghi nợ: ${formatAmount(amount)}đ\n👤 Người nợ: ${debtorLabel}\n📝 Nội dung: ${content}`;
}

/**
 * Xử lý lệnh trả nợ
 * @param {string} userId - Facebook User ID
 * @param {number} amount - Số tiền
 * @param {string} debtor - Tên người trả
 * @param {string} content - Nội dung
 * @returns {Promise<string>} - Tin nhắn phản hồi
 */
async function handleRepayDebt(userId, amount, debtor, content) {
  const rowData = {
    Date: new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }),
    UserID: userId,
    Debtor: debtor || 'Chung',
    Type: 'PAID',
    Amount: amount,
    Content: content,
  };
  
  await appendRow(rowData);
  
  const debtorLabel = debtor ? `@${debtor}` : 'Chung';
  return `✅ Đã ghi trả: ${formatAmount(amount)}đ\n👤 Người trả: ${debtorLabel}\n📝 Nội dung: ${content}`;
}

/**
 * Xử lý lệnh xem nợ
 * @param {string} userId - Facebook User ID
 * @param {string|null} filterDebtor - Lọc theo người nợ (null = tất cả)
 * @returns {Promise<string>} - Tin nhắn phản hồi
 */
async function handleCheckDebt(userId, filterDebtor) {
  const rows = await getRowsByUser(userId);
  
  if (rows.length === 0) {
    return '📋 Bạn chưa có giao dịch nào.';
  }
  
  // Lọc theo debtor nếu có
  const filteredRows = filterDebtor 
    ? rows.filter(r => r.Debtor.toLowerCase() === filterDebtor.toLowerCase())
    : rows;
  
  if (filterDebtor && filteredRows.length === 0) {
    return `📋 Không tìm thấy giao dịch của @${filterDebtor}`;
  }
  
  // Tính tổng theo từng debtor
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
  
  // Tính tổng toàn bộ
  let totalDebt = 0;
  let totalPaid = 0;
  for (const stats of Object.values(debtorStats)) {
    totalDebt += stats.debt;
    totalPaid += stats.paid;
  }
  const totalBalance = totalDebt - totalPaid;
  
  let responseText = '';
  
  // Nếu xem riêng 1 người
  if (filterDebtor) {
    const stats = debtorStats[filterDebtor] || { debt: 0, paid: 0 };
    const balance = stats.debt - stats.paid;
    
    responseText = `📊 CHI TIẾT @${filterDebtor}\n`;
    responseText += `━━━━━━━━━━━━━━━━━━━━\n`;
    responseText += `🔴 Tổng nợ: ${formatAmount(stats.debt)}đ\n`;
    responseText += `🟢 Đã trả: ${formatAmount(stats.paid)}đ\n`;
    responseText += `💰 CÒN NỢ: ${formatAmount(balance)}đ\n`;
    
    // 5 giao dịch gần nhất của người này
    const last5 = filteredRows.slice(-5).reverse();
    if (last5.length > 0) {
      responseText += `\n📋 Giao dịch gần nhất:\n`;
      last5.forEach((row, i) => {
        const typeLabel = row.Type === 'DEBT' ? '🔴' : '🟢';
        responseText += `${i+1}. ${typeLabel} ${formatAmount(row.Amount)}đ\n`;
      });
    }
  } else {
    // Xem tất cả - breakdown theo từng người
    responseText = `📊 TỔNG HỢP NỢ\n`;
    responseText += `━━━━━━━━━━━━━━━━━━━━\n`;
    
    // Sắp xếp theo số dư giảm dần
    const sortedDebtors = Object.entries(debtorStats)
      .map(([name, stats]) => ({ name, balance: stats.debt - stats.paid, ...stats }))
      .sort((a, b) => b.balance - a.balance);
    
    for (const d of sortedDebtors) {
      if (d.balance !== 0) {
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

/**
 * Xử lý lệnh help/hướng dẫn
 * @returns {string} - Tin nhắn hướng dẫn
 */
function handleHelp() {
  return `📚 HƯỚNG DẪN SỬ DỤNG BOT GHI NỢ

━━━━━━━━━━━━━━━━━━━━
📝 GHI NỢ:
• no [số tiền] @[tên] [nội dung]
• Ví dụ: no 50k @A tiền cơm
• Ví dụ: nợ 100k @B mua đồ
• Không có @tên = ghi chung

━━━━━━━━━━━━━━━━━━━━
💵 TRẢ NỢ:
• tra [số tiền] @[tên] [nội dung]
• Ví dụ: tra 20k @A
• Ví dụ: trả 500k @B lương về

━━━━━━━━━━━━━━━━━━━━
📊 XEM NỢ:
• check - xem tất cả
• check @A - xem riêng A
• tong / show no

━━━━━━━━━━━━━━━━━━━━
💡 GHI CHÚ:
• 50k = 50,000đ
• 1m = 1,000,000đ
• @Tên_Dài dùng dấu _`;
}

// ============================================
// WEBHOOK CONTROLLER
// ============================================

/**
 * Xử lý tin nhắn từ người dùng
 * @param {string} userId - Facebook User ID (PSID)
 * @param {string} messageText - Nội dung tin nhắn
 */
async function handleMessage(userId, messageText) {
  console.log(`📩 Nhận tin nhắn từ ${userId}: ${messageText}`);
  
  try {
    const command = parseCommand(messageText);
    
    if (!command) {
      // Không nhận ra lệnh -> gửi hướng dẫn
      await sendMessage(userId, '❓ Không hiểu lệnh. Gõ "help" để xem hướng dẫn.');
      return;
    }
    
    let response;
    
    switch (command.intent) {
      case 'DEBT':
        response = await handleAddDebt(userId, command.amount, command.debtor, command.content);
        break;
        
      case 'PAID':
        response = await handleRepayDebt(userId, command.amount, command.debtor, command.content);
        break;
        
      case 'CHECK':
        response = await handleCheckDebt(userId, command.debtor);
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

// Health check endpoint
app.get('/', (req, res) => {
  res.send('🤖 Facebook Debt Tracker Bot đang hoạt động!');
});

/**
 * GET /webhook - Xác thực webhook từ Facebook
 * Facebook sẽ gửi request này khi bạn đăng ký webhook
 */
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

/**
 * POST /webhook - Nhận và xử lý tin nhắn từ Facebook
 */
app.post('/webhook', async (req, res) => {
  const body = req.body;
  
  // Kiểm tra đây có phải là event từ Page không
  if (body.object !== 'page') {
    res.sendStatus(404);
    return;
  }
  
  // Phản hồi ngay lập tức để Facebook không gửi lại
  res.status(200).send('EVENT_RECEIVED');
  
  // Xử lý từng entry
  for (const entry of body.entry || []) {
    // Lấy các messaging events
    const messagingEvents = entry.messaging || [];
    
    for (const event of messagingEvents) {
      // Chỉ xử lý tin nhắn text (bỏ qua attachments, postbacks, etc.)
      if (event.message && event.message.text) {
        const senderId = event.sender.id;
        const messageText = event.message.text;
        
        // Bỏ qua tin nhắn echo (tin nhắn của chính bot)
        if (event.message.is_echo) {
          continue;
        }
        
        // Xử lý tin nhắn không đồng bộ
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
  console.log('🚀 Facebook Debt Tracker Bot');
  console.log(`📡 Server đang chạy tại port ${config.PORT}`);
  console.log(`📊 Google Sheet ID: ${config.GOOGLE_SHEET_ID.substring(0, 10)}...`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
});
