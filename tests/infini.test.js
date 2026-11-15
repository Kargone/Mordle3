import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newClock, startClock, stopClock, clockMs, formatTime } from '../js/clock.js';
import { emptyStats, recordGame, infiniRecords, averageGuesses } from '../js/stats.js';
import { mergeStats, applyResults } from '../js/sync.js';

test('clock: counts running stretches only', () => {
  let c = newClock();
  assert.equal(clockMs(c, 5000), 0);
  c = startClock(c, 1000);
  assert.equal(startClock(c, 3000), c, 'already running');
  assert.equal(clockMs(c, 4000), 3000);
  c = stopClock(c, 4000); // page hidden
  assert.equal(clockMs(c, 99_000), 3000, 'no time while stopped');
  c = startClock(c, 100_000);
  c = stopClock(c, 102_500);
  assert.equal(c.ms, 5500);
  assert.equal(clockMs(null, 1), 0);
});

test('formatTime', () => {
  assert.equal(formatTime(7_400), '0:07');
  assert.equal(formatTime(134_000), '2:14');
  assert.equal(formatTime(3_729_000), '1:02:09');
});

test('InfiniMode stats: solved, average, fewest, fastest, records, merge', () => {
  let s = emptyStats();
  const first = { mode: 'infini', guesses: 9, ms: 134_000 };
  assert.deepEqual(infiniRecords(s.infini, first), [], 'no badge on the first word');
  s = recordGame(s, first);
  assert.deepEqual(infiniRecords(s.infini, { guesses: 6, ms: 200_000 }), ['fewest']);
  assert.deepEqual(infiniRecords(s.infini, { guesses: 4, ms: 60_000 }), ['fewest', 'fastest']);
  s = recordGame(s, { mode: 'infini', guesses: 6, ms: 200_000 });
  assert.deepEqual(s.infini, { solved: 2, guesses: 15, fewest: 6, fastestMs: 134_000 });
  assert.equal(averageGuesses(s.infini), 7.5);
  assert.equal(s.daily.played, 0, 'other buckets untouched');

  const other = recordGame(emptyStats(), { mode: 'infini', guesses: 12, ms: 90_000 });
  assert.deepEqual(mergeStats(s, other).infini, { solved: 3, guesses: 27, fewest: 6, fastestMs: 90_000 });
  assert.deepEqual(mergeStats({ daily: s.daily, random: s.random }, other).infini, other.infini, 'old stats without infini');
  assert.equal(applyResults({}, [first]).infini.solved, 1, 'pending InfiniMode results apply to cloud stats');
});
