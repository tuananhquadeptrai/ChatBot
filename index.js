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
 * Thêm một dòng mới vào Google Sheet
 * @param {Object} rowData - Dữ liệu dòng: { Date, UserID, Type, Amount, Content }
 */
async function appendRow(rowData) {
  try {
    const doc = await getGoogleSheet();
    const sheet = doc.sheetsByIndex[0]; // Sheet đầu tiên
    
    await sheet.addRow({
      Date: rowData.Date,
      UserID: rowData.UserID,
      Type: rowData.Type,
      Amount: rowData.Amount,
      Content: rowData.Content || '',
    });
    
    console.log(`✅ Đã thêm dòng: ${rowData.Type} - ${rowData.Amount}`);
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
 * @returns {Object|null} - { intent, amount, content } hoặc null
 */
function parseCommand(text) {
  if (!text) return null;
  
  const normalizedText = text.trim().toLowerCase();
  
  // Regex cho lệnh GHI NỢ: "no", "nợ"
  const debtRegex = /^(no|nợ)\s+(\S+)\s*(.*)$/i;
  const debtMatch = text.match(debtRegex);
  
  if (debtMatch) {
    const amount = parseAmount(debtMatch[2]);
    if (amount) {
      return {
        intent: 'DEBT',
        amount: amount,
        content: debtMatch[3].trim() || 'Không có nội dung',
      };
    }
  }
  
  // Regex cho lệnh TRẢ NỢ: "tra", "trả"
  const paidRegex = /^(tra|trả)\s+(\S+)\s*(.*)$/i;
  const paidMatch = text.match(paidRegex);
  
  if (paidMatch) {
    const amount = parseAmount(paidMatch[2]);
    if (amount) {
      return {
        intent: 'PAID',
        amount: amount,
        content: paidMatch[3].trim() || 'Không có nội dung',
      };
    }
  }
  
  // Regex cho lệnh XEM NỢ: "check", "tong", "tổng", "show no"
  const checkRegex = /^(check|tong|tổng|show\s*no|xem\s*no|xem\s*nợ)$/i;
  if (checkRegex.test(normalizedText)) {
    return { intent: 'CHECK' };
  }
  
  // Regex cho lệnh HELP
  const helpRegex = /^(help|huong\s*dan|hướng\s*dẫn|menu|\?)$/i;
  if (helpRegex.test(normalizedText)) {
    return { intent: 'HELP' };
  }
  
  return null;
}

// ============================================
// DEBT SERVICE - XỬ LÝ NGHIỆP VỤ
// ============================================

/**
 * Xử lý lệnh ghi nợ
 * @param {string} userId - Facebook User ID
 * @param {number} amount - Số tiền
 * @param {string} content - Nội dung
 * @returns {Promise<string>} - Tin nhắn phản hồi
 */
async function handleAddDebt(userId, amount, content) {
  const rowData = {
    Date: new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }),
    UserID: userId,
    Type: 'DEBT',
    Amount: amount,
    Content: content,
  };
  
  await appendRow(rowData);
  
  return `✅ Đã ghi nợ: ${formatAmount(amount)}đ\n📝 Nội dung: ${content}`;
}

/**
 * Xử lý lệnh trả nợ
 * @param {string} userId - Facebook User ID
 * @param {number} amount - Số tiền
 * @param {string} content - Nội dung
 * @returns {Promise<string>} - Tin nhắn phản hồi
 */
async function handleRepayDebt(userId, amount, content) {
  const rowData = {
    Date: new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }),
    UserID: userId,
    Type: 'PAID',
    Amount: amount,
    Content: content,
  };
  
  await appendRow(rowData);
  
  return `✅ Đã ghi trả: ${formatAmount(amount)}đ\n📝 Nội dung: ${content}`;
}

/**
 * Xử lý lệnh xem nợ
 * @param {string} userId - Facebook User ID
 * @returns {Promise<string>} - Tin nhắn phản hồi
 */
async function handleCheckDebt(userId) {
  const rows = await getRowsByUser(userId);
  
  if (rows.length === 0) {
    return '📋 Bạn chưa có giao dịch nào.';
  }
  
  // Tính tổng
  let totalDebt = 0;
  let totalPaid = 0;
  
  for (const row of rows) {
    if (row.Type === 'DEBT') {
      totalDebt += row.Amount;
    } else if (row.Type === 'PAID') {
      totalPaid += row.Amount;
    }
  }
  
  const balance = totalDebt - totalPaid;
  
  // Lấy 5 giao dịch gần nhất (cuối mảng)
  const last5 = rows.slice(-5).reverse();
  
  let historyText = '📋 Lịch sử 5 giao dịch gần nhất:\n';
  last5.forEach((row, index) => {
    const typeLabel = row.Type === 'DEBT' ? '🔴 Nợ' : '🟢 Trả';
    historyText += `${index + 1}. ${typeLabel} ${formatAmount(row.Amount)}đ - ${row.Date}\n`;
    if (row.Content) {
      historyText += `   📝 ${row.Content}\n`;
    }
  });
  
  historyText += `\n━━━━━━━━━━━━━━━━━━━━\n`;
  historyText += `📊 TỔNG KẾT:\n`;
  historyText += `🔴 Tổng nợ: ${formatAmount(totalDebt)}đ\n`;
  historyText += `🟢 Đã trả: ${formatAmount(totalPaid)}đ\n`;
  historyText += `💰 CÒN NỢ: ${formatAmount(balance)}đ`;
  
  return historyText;
}

/**
 * Xử lý lệnh help/hướng dẫn
 * @returns {string} - Tin nhắn hướng dẫn
 */
function handleHelp() {
  return `📚 HƯỚNG DẪN SỬ DỤNG BOT GHI NỢ

━━━━━━━━━━━━━━━━━━━━
📝 GHI NỢ:
• no [số tiền] [nội dung]
• Ví dụ: no 50k tiền cơm
• Ví dụ: nợ 100k mua đồ

━━━━━━━━━━━━━━━━━━━━
💵 TRẢ NỢ:
• tra [số tiền] [nội dung]
• Ví dụ: tra 20k
• Ví dụ: trả 500k lương về

━━━━━━━━━━━━━━━━━━━━
📊 XEM NỢ:
• check
• tong
• show no

━━━━━━━━━━━━━━━━━━━━
💡 GHI CHÚ:
• Hỗ trợ: 50k = 50,000đ
• Hỗ trợ: 1m = 1,000,000đ`;
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
        response = await handleAddDebt(userId, command.amount, command.content);
        break;
        
      case 'PAID':
        response = await handleRepayDebt(userId, command.amount, command.content);
        break;
        
      case 'CHECK':
        response = await handleCheckDebt(userId);
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
