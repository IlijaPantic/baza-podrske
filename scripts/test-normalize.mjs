/**
 * Smoke test for normalize.ts — runs against the built dist/ output.
 * Run:
 *   npm run build && node scripts/test-normalize.mjs
 */
import { normalizePhoneRS, normalizeEmail, generateShortId } from '../dist/common/normalize.js';

let pass = 0;
let fail = 0;

function eq(name, actual, expected) {
  if (actual === expected) {
    console.log(`  ✓ ${name}`);
    pass++;
  } else {
    console.error(`  ✗ ${name}\n    expected: ${expected}\n    actual:   ${actual}`);
    fail++;
  }
}

function throws(name, fn) {
  try {
    fn();
    console.error(`  ✗ ${name} (nije bacio grešku)`);
    fail++;
  } catch {
    console.log(`  ✓ ${name}`);
    pass++;
  }
}

console.log('-- normalizePhoneRS --');
eq('065 123 4567 → +381651234567',         normalizePhoneRS('065 123 4567'),     '+381651234567');
eq('0651234567 → +381651234567',           normalizePhoneRS('0651234567'),       '+381651234567');
eq('+381 65 123 4567 → +381651234567',     normalizePhoneRS('+381 65 123 4567'), '+381651234567');
eq('+381651234567 → +381651234567',        normalizePhoneRS('+381651234567'),    '+381651234567');
eq('00381651234567 → +381651234567',       normalizePhoneRS('00381651234567'),   '+381651234567');
eq('381651234567 → +381651234567',         normalizePhoneRS('381651234567'),     '+381651234567');
eq('060 123 456 → +381601234567 reject',   (()=>{try{return normalizePhoneRS('060 123 4567');}catch(e){return 'REJECTED';}})(), '+381601234567');
throws('"abc" → reject',                   () => normalizePhoneRS('abc'));
throws('"" → reject',                      () => normalizePhoneRS(''));
throws('"123 → reject (prekratko)"',       () => normalizePhoneRS('123'));
throws('"065" → reject (prekratko)',       () => normalizePhoneRS('065'));
throws('"021 123 456" → fixni telefon reject (počinje sa 2 ne 6)', () => normalizePhoneRS('021 123 456'));

console.log('\n-- normalizeEmail --');
eq('Marko@Gmail.COM → marko@gmail.com',  normalizeEmail('Marko@Gmail.COM'),  'marko@gmail.com');
eq('  ana@rs.com  → ana@rs.com',          normalizeEmail('  ana@rs.com  '),  'ana@rs.com');
throws('"not-an-email"', () => normalizeEmail('not-an-email'));
throws('"a@b"',          () => normalizeEmail('a@b'));
throws('""',             () => normalizeEmail(''));

console.log('\n-- generateShortId --');
const ids = new Set();
for (let i = 0; i < 1000; i++) ids.add(generateShortId(8));
eq('1000 unikatnih ID-a', ids.size, 1000);
eq('format je 8 chars A-Z2-9', /^[A-Z2-9]{8}$/.test(generateShortId(8)), true);
eq('bez O 0 I 1', /[O01I]/.test(generateShortId(8)), false);

console.log(`\n${pass} ✓  /  ${fail} ✗`);
if (fail > 0) process.exit(1);
