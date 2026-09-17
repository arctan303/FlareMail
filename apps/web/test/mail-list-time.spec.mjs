import test from 'node:test';
import assert from 'node:assert/strict';
import { formatMailListTime } from '../src/utils/mail-list-time.js';

const now = new Date(2026, 8, 15, 12, 30);
const utc = (...parts) => new Date(...parts).toISOString();

test('today always shows HH:mm, including just-received mail', () => {
  assert.equal(formatMailListTime(utc(2026, 8, 15, 12, 29, 59), now), '12:29');
  assert.equal(formatMailListTime(utc(2026, 8, 15, 9, 5), now), '09:05');
});
test('other dates use month/day and cross-year mail includes the year', () => {
  assert.equal(formatMailListTime(utc(2026, 8, 14, 23, 59), now), '9月14日');
  assert.equal(formatMailListTime(utc(2026, 8, 13), now), '9月13日');
  assert.equal(formatMailListTime(utc(2025, 11, 31, 23, 59), now), '2025年12月31日');
});
test('SQLite UTC timestamps use local calendar boundaries; invalid dates are empty', () => {
  const midnight = new Date(2026, 0, 1, 0, 5);
  const stored = utc(2026, 0, 1, 0, 1).slice(0, 19).replace('T', ' ');
  assert.equal(formatMailListTime(stored, midnight), '00:01');
  assert.equal(formatMailListTime(utc(2025, 11, 31, 23, 59), midnight), '2025年12月31日');
  assert.equal(formatMailListTime(null, now), '');
  assert.equal(formatMailListTime('invalid', now), '');
});
