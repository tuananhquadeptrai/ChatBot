/**
 * Script test kết nối Google Sheets
 * Chạy: node test-sheets.js
 */

require('dotenv').config();
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

const config = {
  GOOGLE_SHEET_ID: process.env.GOOGLE_SHEET_ID,
  GOOGLE_SERVICE_ACCOUNT_EMAIL: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  GOOGLE_PRIVATE_KEY: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
};

async function testConnection() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🧪 TEST KẾT NỐI GOOGLE SHEETS');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  
  console.log('\n📋 Thông tin cấu hình:');
  console.log(`  Sheet ID: ${config.GOOGLE_SHEET_ID}`);
  console.log(`  Service Account: ${config.GOOGLE_SERVICE_ACCOUNT_EMAIL}`);
  console.log(`  Private Key: ${config.GOOGLE_PRIVATE_KEY ? '✅ Có' : '❌ Thiếu'}`);
  
  try {
    // Bước 1: Khởi tạo auth
    console.log('\n🔐 Bước 1: Khởi tạo JWT auth...');
    const serviceAccountAuth = new JWT({
      email: config.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      key: config.GOOGLE_PRIVATE_KEY,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    console.log('  ✅ JWT auth khởi tạo thành công');
    
    // Bước 2: Kết nối Sheet
    console.log('\n📊 Bước 2: Kết nối Google Sheet (loadInfo)...');
    const doc = new GoogleSpreadsheet(config.GOOGLE_SHEET_ID, serviceAccountAuth);
    await doc.loadInfo();
    console.log(`  ✅ Kết nối thành công!`);
    console.log(`  📄 Tên Sheet: ${doc.title}`);
    console.log(`  📑 Số tab: ${doc.sheetCount}`);
    
    // Bước 3: Đọc dữ liệu
    console.log('\n📖 Bước 3: Đọc dữ liệu từ Sheet...');
    const sheet = doc.sheetsByIndex[0];
    console.log(`  📑 Tab đầu tiên: ${sheet.title}`);
    console.log(`  📏 Số hàng: ${sheet.rowCount}`);
    
    const rows = await sheet.getRows();
    console.log(`  📊 Số dòng dữ liệu: ${rows.length}`);
    
    if (rows.length > 0) {
      console.log('\n  📋 5 dòng gần nhất:');
      const last5 = rows.slice(-5);
      last5.forEach((row, i) => {
        console.log(`    ${i+1}. ${row.get('Type')} - ${row.get('Amount')} - ${row.get('Content')}`);
      });
    }
    
    // Bước 4: Thử ghi dữ liệu test
    console.log('\n✍️  Bước 4: Thử ghi dữ liệu test...');
    const testRow = {
      Date: new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }),
      UserID: 'TEST_USER',
      Type: 'TEST',
      Amount: 1,
      Content: 'Test từ script - có thể xóa',
    };
    
    await sheet.addRow(testRow);
    console.log('  ✅ Ghi dữ liệu thành công!');
    
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🎉 TẤT CẢ TESTS PASSED!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('💡 Bot đã sẵn sàng ghi/đọc Google Sheets.');
    console.log('   Nhớ xóa dòng TEST trong Sheet nếu không cần.');
    
  } catch (error) {
    console.error('\n❌ LỖI:', error.message);
    
    if (error.message.includes('permission') || error.message.includes('403')) {
      console.log('\n🔧 CÁCH SỬA LỖI 403:');
      console.log('  1. Mở Google Sheet');
      console.log('  2. Click "Share" (Chia sẻ)');
      console.log(`  3. Thêm email: ${config.GOOGLE_SERVICE_ACCOUNT_EMAIL}`);
      console.log('  4. Cấp quyền "Editor"');
      console.log('  5. Chạy lại script này');
    }
    
    if (error.message.includes('not found') || error.message.includes('404')) {
      console.log('\n🔧 CÁCH SỬA LỖI 404:');
      console.log('  - Kiểm tra GOOGLE_SHEET_ID trong .env');
      console.log('  - Lấy ID từ URL: https://docs.google.com/spreadsheets/d/{ID}/edit');
    }
    
    console.log('\n📝 Chi tiết lỗi:');
    console.log(error);
  }
}

testConnection();
