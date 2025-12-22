/**
 * Test parseCommand với debtor
 */
require('dotenv').config();

// Copy parseAmount function (updated with tr, k5 support)
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
      return parseInt(match[1]) * 1000 + parseInt(match[2]) * 100;
    }
  } else if (cleaned.endsWith('k')) {
    multiplier = 1000;
    cleaned = cleaned.slice(0, -1);
  } else if (cleaned.endsWith('m')) {
    multiplier = 1000000;
    cleaned = cleaned.slice(0, -1);
  }
  
  const number = parseFloat(cleaned);
  if (isNaN(number) || number <= 0) return null;
  const result = Math.round(number * multiplier);
  if (result > 1000000000000) return null;
  return result;
}

// Copy parseDebtorAndContent function
function parseDebtorAndContent(remainder) {
  if (!remainder) return { debtor: null, content: '' };
  const trimmed = remainder.trim();
  const debtorMatch = trimmed.match(/^@(\S+)\s*(.*)$/);
  if (debtorMatch) {
    const debtor = debtorMatch[1].replace(/_/g, ' ').trim();
    const content = debtorMatch[2].trim();
    return { debtor, content };
  }
  return { debtor: null, content: trimmed };
}

// Copy parseCommand function (updated)
function parseCommand(text) {
  if (!text) return null;
  const normalizedText = text.trim().toLowerCase();
  
  const debtRegex = /^(no|nợ)\s+(\S+)\s*(.*)$/i;
  const debtMatch = text.match(debtRegex);
  if (debtMatch) {
    const amount = parseAmount(debtMatch[2]);
    if (amount) {
      const { debtor, content } = parseDebtorAndContent(debtMatch[3]);
      return { intent: 'DEBT', amount, debtor, content: content || 'Không có nội dung' };
    }
  }
  
  const paidRegex = /^(tra|trả)\s+(\S+)\s*(.*)$/i;
  const paidMatch = text.match(paidRegex);
  if (paidMatch) {
    const amount = parseAmount(paidMatch[2]);
    if (amount) {
      const { debtor, content } = parseDebtorAndContent(paidMatch[3]);
      return { intent: 'PAID', amount, debtor, content: content || 'Không có nội dung' };
    }
  }
  
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
    return { intent: 'CHECK', debtor, onlyOwing };
  }
  
  const undoRegex = /^(xoa|xóa|undo|huy|huỷ|hủy)$/i;
  if (undoRegex.test(normalizedText)) {
    return { intent: 'UNDO' };
  }
  
  const searchRegex = /^(tim|tìm|find|search)\s+(.+)$/i;
  const searchMatch = text.match(searchRegex);
  if (searchMatch) {
    return { intent: 'SEARCH', keyword: searchMatch[2].trim() };
  }
  
  const statsRegex = /^(thang\s*nay|tháng\s*này|thang\s*truoc|tháng\s*trước|tuan\s*nay|tuần\s*này|tuan\s*truoc|tuần\s*trước|hom\s*nay|hôm\s*nay)$/i;
  if (statsRegex.test(normalizedText)) {
    return { intent: 'STATS', period: normalizedText };
  }
  
  const helpRegex = /^(help|huong\s*dan|hướng\s*dẫn|menu|\?)$/i;
  if (helpRegex.test(normalizedText)) return { intent: 'HELP' };
  
  return null;
}

// Tests
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('🧪 TEST PARSE COMMAND VỚI DEBTOR');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

const testCases = [
  // Ghi nợ với @tên
  { input: 'no 50k @A tiền cơm', expected: { intent: 'DEBT', amount: 50000, debtor: 'A', content: 'tiền cơm' } },
  { input: 'nợ 100k @B mua đồ', expected: { intent: 'DEBT', amount: 100000, debtor: 'B', content: 'mua đồ' } },
  { input: 'no 1m @Anh_Hai tiền thuê nhà', expected: { intent: 'DEBT', amount: 1000000, debtor: 'Anh Hai', content: 'tiền thuê nhà' } },
  
  // Ghi nợ không có @tên (backward compatible)
  { input: 'no 50k tiền cơm', expected: { intent: 'DEBT', amount: 50000, debtor: null, content: 'tiền cơm' } },
  
  // Trả nợ với @tên
  { input: 'tra 20k @A', expected: { intent: 'PAID', amount: 20000, debtor: 'A', content: 'Không có nội dung' } },
  { input: 'trả 500k @B lương về', expected: { intent: 'PAID', amount: 500000, debtor: 'B', content: 'lương về' } },
  
  // Check với @tên
  { input: 'check', expected: { intent: 'CHECK', debtor: null, onlyOwing: false } },
  { input: 'check @A', expected: { intent: 'CHECK', debtor: 'a', onlyOwing: false } },
  { input: 'check conno', expected: { intent: 'CHECK', debtor: null, onlyOwing: true } },
  
  // Lệnh mới: xoa/undo
  { input: 'xoa', expected: { intent: 'UNDO' } },
  { input: 'undo', expected: { intent: 'UNDO' } },
  { input: 'huy', expected: { intent: 'UNDO' } },
  
  // Lệnh mới: tim/search
  { input: 'tim cafe', expected: { intent: 'SEARCH', keyword: 'cafe' } },
  { input: 'tìm tiền cơm', expected: { intent: 'SEARCH', keyword: 'tiền cơm' } },
  
  // Lệnh mới: thống kê
  { input: 'thang nay', expected: { intent: 'STATS', period: 'thang nay' } },
  { input: 'tuan nay', expected: { intent: 'STATS', period: 'tuan nay' } },
  { input: 'hom nay', expected: { intent: 'STATS', period: 'hom nay' } },
  
  // Format tiền mới
  { input: 'no 1tr @A test', expected: { intent: 'DEBT', amount: 1000000, debtor: 'A', content: 'test' } },
  { input: 'no 50k5 @B test', expected: { intent: 'DEBT', amount: 50500, debtor: 'B', content: 'test' } },
  
  // Help
  { input: 'help', expected: { intent: 'HELP' } },
];

let passed = 0;
let failed = 0;

for (const tc of testCases) {
  const result = parseCommand(tc.input);
  const success = JSON.stringify(result) === JSON.stringify(tc.expected);
  
  if (success) {
    console.log(`✅ "${tc.input}"`);
    passed++;
  } else {
    console.log(`❌ "${tc.input}"`);
    console.log(`   Expected: ${JSON.stringify(tc.expected)}`);
    console.log(`   Got:      ${JSON.stringify(result)}`);
    failed++;
  }
}

console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`📊 KẾT QUẢ: ${passed}/${testCases.length} passed`);
if (failed === 0) {
  console.log('🎉 TẤT CẢ TESTS PASSED!');
} else {
  console.log(`❌ ${failed} tests failed`);
}
