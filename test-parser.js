/**
 * Test parseCommand với debtor
 */
require('dotenv').config();

// Copy parseAmount function
function parseAmount(amountStr) {
  if (!amountStr) return null;
  let cleaned = amountStr.toLowerCase().replace(/,/g, '').trim();
  let multiplier = 1;
  if (cleaned.endsWith('k')) {
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

// Copy parseCommand function
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
  
  const checkRegex = /^(check|tong|tổng|show\s*no|xem\s*no|xem\s*nợ)\s*(@\S+)?$/i;
  const checkMatch = normalizedText.match(checkRegex);
  if (checkMatch) {
    let debtor = null;
    if (checkMatch[2]) {
      debtor = checkMatch[2].replace('@', '').replace(/_/g, ' ').trim();
    }
    return { intent: 'CHECK', debtor };
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
  { input: 'check', expected: { intent: 'CHECK', debtor: null } },
  { input: 'check @A', expected: { intent: 'CHECK', debtor: 'a' } },
  { input: 'tong @B', expected: { intent: 'CHECK', debtor: 'b' } },
  
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
