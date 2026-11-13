import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayNumber, dailyAnswerIndex, msUntilNextDay, parseSeed } from '../js/daily.js';

test('dayNumber starts at 1 on the epoch and ticks at local midnight', () => {
  assert.equal(dayNumber(new Date(2026, 10, 1, 0, 0, 1)), 1);
  assert.equal(dayNumber(new Date(2026, 10, 1, 23, 59, 59)), 1);
  assert.equal(dayNumber(new Date(2026, 10, 2, 0, 0, 0)), 2);
  assert.equal(dayNumber(new Date(2027, 10, 1, 12)), 366);
});

test('dayNumber is stable across a DST change (March)', () => {
  const before = dayNumber(new Date(2027, 2, 13, 12));
  const after = dayNumber(new Date(2027, 2, 15, 12));
  assert.equal(after - before, 2);
});

test('dailyAnswerIndex is in range and does not repeat within a full cycle', () => {
  const len = 2309;
  const seen = new Set();
  for (let d = 1; d <= len; d++) {
    const i = dailyAnswerIndex(d, len);
    assert.ok(i >= 0 && i < len);
    seen.add(i);
  }
  assert.equal(seen.size, len);
});

test('msUntilNextDay', () => {
  assert.equal(msUntilNextDay(new Date(2026, 10, 13, 23, 59, 0)), 60_000);
});

test('parseSeed accepts whole numbers in range only', () => {
  assert.equal(parseSeed('1795', 2309), 1795);
  assert.equal(parseSeed(' 0 ', 2309), 0);
  assert.equal(parseSeed('2309', 2309), null);
  assert.equal(parseSeed('-1', 2309), null);
  assert.equal(parseSeed('1.5', 2309), null);
  assert.equal(parseSeed('abc', 2309), null);
  assert.equal(parseSeed('', 2309), null);
});
