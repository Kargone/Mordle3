import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyStats, recordGame, effectiveStreak, winPercent } from '../js/stats.js';
import { buildShareText } from '../js/share.js';

test('daily streak continues on consecutive days and resets on a skip or loss', () => {
  let s = emptyStats();
  s = recordGame(s, { mode: 'daily', won: true, guesses: 3, day: 10 });
  s = recordGame(s, { mode: 'daily', won: true, guesses: 4, day: 11 });
  assert.equal(s.daily.currentStreak, 2);
  s = recordGame(s, { mode: 'daily', won: true, guesses: 2, day: 13 }); // skipped day 12
  assert.equal(s.daily.currentStreak, 1);
  assert.equal(s.daily.maxStreak, 2);
  s = recordGame(s, { mode: 'daily', won: false, guesses: 6, day: 14 });
  assert.equal(s.daily.currentStreak, 0);
  assert.deepEqual(s.daily.distribution, [0, 1, 1, 1, 0, 0]);
  assert.equal(winPercent(s.daily), 75);
});

test('the same daily puzzle is only recorded once', () => {
  let s = recordGame(emptyStats(), { mode: 'daily', won: true, guesses: 3, day: 5 });
  s = recordGame(s, { mode: 'daily', won: true, guesses: 3, day: 5 });
  assert.equal(s.daily.played, 1);
});

test('effectiveStreak shows 0 once a day has been missed', () => {
  const s = recordGame(emptyStats(), { mode: 'daily', won: true, guesses: 3, day: 5 });
  assert.equal(effectiveStreak(s.daily, 'daily', 6), 1);
  assert.equal(effectiveStreak(s.daily, 'daily', 7), 0);
});

test('random streak is consecutive wins', () => {
  let s = emptyStats();
  s = recordGame(s, { mode: 'random', won: true, guesses: 3 });
  s = recordGame(s, { mode: 'random', won: true, guesses: 5 });
  assert.equal(s.random.currentStreak, 2);
  assert.equal(s.daily.played, 0);
});

test('share text', () => {
  const evaluations = [
    ['absent', 'present', 'absent', 'absent', 'correct'],
    ['correct', 'correct', 'correct', 'correct', 'correct'],
  ];
  assert.equal(
    buildShareText({ mode: 'daily', day: 12, evaluations, won: true, hard: true }),
    'Mordle #12 2/6*\n\n⬛🟧⬛⬛🟦\n🟦🟦🟦🟦🟦',
  );
  const lost = buildShareText({ mode: 'random', seed: 1795, evaluations, won: false });
  assert.ok(lost.startsWith('Mordle seed 1795 X/6\n'));
  const inf = buildShareText({ mode: 'random', seed: 3, evaluations, won: true, infinite: true });
  assert.ok(inf.startsWith('Mordle seed 3 2 ∞'));
});
