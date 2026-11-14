import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyStats, recordGame } from '../js/stats.js';
import { mergeBucket, mergeStats, applyResults, newerSettings, pickSyncedSettings } from '../js/sync.js';

const play = (stats, games) => games.reduce(recordGame, stats);

test('merging two devices adds up counts and keeps the best streak', () => {
  const phone = play(emptyStats(), [
    { mode: 'daily', won: true, guesses: 3, day: 1 },
    { mode: 'daily', won: true, guesses: 4, day: 2 },
    { mode: 'daily', won: true, guesses: 2, day: 3 },
  ]);
  const laptop = play(emptyStats(), [
    { mode: 'daily', won: false, guesses: 6, day: 5 },
    { mode: 'daily', won: true, guesses: 5, day: 6 },
  ]);
  const m = mergeStats(phone, laptop);
  assert.equal(m.daily.played, 5);
  assert.equal(m.daily.wins, 4);
  assert.deepEqual(m.daily.distribution, [0, 1, 1, 1, 1, 0]);
  assert.equal(m.daily.maxStreak, 3);
  assert.equal(m.daily.currentStreak, 1, 'current streak comes from the most recent day');
  assert.equal(m.daily.lastDay, 6);
});

test('the same daily played on both devices counts once', () => {
  const a = play(emptyStats(), [{ mode: 'daily', won: true, guesses: 3, day: 9 }]);
  const b = play(emptyStats(), [{ mode: 'daily', won: true, guesses: 5, day: 9 }]);
  const m = mergeBucket(a.daily, b.daily);
  assert.equal(m.played, 1);
  assert.equal(m.wins, 1);
  assert.deepEqual(m.distribution, [0, 0, 1, 0, 0, 0]);

  const lost = play(emptyStats(), [{ mode: 'daily', won: false, guesses: 6, day: 9 }]);
  const m2 = mergeBucket(a.daily, lost.daily);
  assert.equal(m2.played, 1);
  assert.equal(m2.wins, 1);
  assert.deepEqual(m2.distribution, [0, 0, 1, 0, 0, 0]);

  const won = play(emptyStats(), [{ mode: 'daily', won: true, guesses: 2, day: 8 }, { mode: 'daily', won: true, guesses: 2, day: 9 }]);
  const m3 = mergeBucket(lost.daily, won.daily);
  assert.equal(m3.currentStreak, 0, 'the first stats keep their loss for that day');
  assert.equal(m3.maxStreak, 2);
});

test('merging with empty stats changes nothing', () => {
  const a = play(emptyStats(), [
    { mode: 'random', won: true, guesses: 2 },
    { mode: 'random', won: true, guesses: 3 },
  ]);
  assert.deepEqual(mergeStats(a, emptyStats()).random, a.random);
  assert.deepEqual(mergeStats(emptyStats(), a).random, a.random);
});

test('stats saved before lastGuesses existed still merge', () => {
  const old = { played: 2, wins: 2, currentStreak: 2, maxStreak: 2, distribution: [0, 1, 1, 0, 0, 0], lastDay: 4 };
  const now = play(emptyStats(), [{ mode: 'daily', won: true, guesses: 4, day: 4 }]);
  const m = mergeBucket(now.daily, old);
  assert.equal(m.played, 2);
  assert.equal(m.wins, 2);
});

test('applyResults replays unsynced games, and a daily already counted is skipped', () => {
  const cloud = play(emptyStats(), [{ mode: 'daily', won: true, guesses: 3, day: 9 }]);
  const s = applyResults(cloud, [
    { mode: 'daily', won: true, guesses: 4, day: 9 },
    { mode: 'daily', won: true, guesses: 2, day: 10 },
  ]);
  assert.equal(s.daily.played, 2);
  assert.equal(s.daily.currentStreak, 2);
});

test('settings: newer remote settings win, mode never syncs', () => {
  const local = { mode: 'daily', hard: false, theme: 'dark', contrast: false };
  assert.equal(newerSettings(local, 200, { hard: true }, 100), null);
  assert.deepEqual(newerSettings(local, 100, { hard: true, theme: 'light', mode: 'infini' }, 200),
    { mode: 'daily', hard: true, theme: 'light', contrast: false });
  assert.deepEqual(pickSyncedSettings({ mode: 'random', hard: true, theme: 'system', contrast: true, updatedAt: 5 }),
    { hard: true, theme: 'system', contrast: true });
});

// ---------- in-progress daily ----------
import { encodeDaily, decodeDaily, pickDaily } from '../js/sync.js';
import { createGame, addLetter, submitGuess } from '../js/game.js';
import { ANSWERS, VALID } from '../js/words.js';

const HELLO = ANSWERS.indexOf('hello');
function slotWith(guesses, day = 14) {
  let state = createGame({ answer: 'hello' });
  for (const g of guesses) state = submitGuess([...g].reduce(addLetter, state), VALID).state;
  return { day, seed: HELLO, state, recorded: false };
}

test('daily round-trips through the cloud format', () => {
  const slot = slotWith(['crane', 'llama']);
  const data = encodeDaily(slot);
  assert.deepEqual(data, { day: 14, seed: HELLO, guesses: ['crane', 'llama'], hard: false });
  const back = decodeDaily(data, ANSWERS, 14);
  assert.deepEqual(back.state.evaluations, slot.state.evaluations);
  assert.equal(back.state.status, 'playing');
  assert.equal(back.recorded, false);
});

test('decodeDaily: finished games, wrong day and bad data', () => {
  const won = decodeDaily({ day: 14, seed: HELLO, guesses: ['crane', 'hello'] }, ANSWERS, 14);
  assert.equal(won.state.status, 'won');
  assert.equal(won.recorded, true);
  const lost = decodeDaily({ day: 14, seed: HELLO, guesses: Array(6).fill('crane') }, ANSWERS, 14);
  assert.equal(lost.state.status, 'lost');
  assert.equal(decodeDaily({ day: 13, seed: HELLO, guesses: [] }, ANSWERS, 14), null, 'yesterday');
  assert.equal(decodeDaily({ day: 14, seed: HELLO, guesses: ['NOPE!'] }, ANSWERS, 14), null);
  assert.equal(decodeDaily({ day: 14, seed: HELLO, guesses: Array(7).fill('crane') }, ANSWERS, 14), null);
  assert.equal(decodeDaily({ day: 14, seed: HELLO, guesses: ['hello', 'crane'] }, ANSWERS, 14), null);
  assert.equal(decodeDaily(undefined, ANSWERS, 14), null);
});

test('pickDaily keeps the copy with more guesses', () => {
  assert.equal(pickDaily(slotWith(['crane']), slotWith(['crane', 'llama'])), 'remote');
  assert.equal(pickDaily(slotWith(['crane', 'llama']), slotWith(['crane'])), 'local');
  assert.equal(pickDaily(slotWith(['crane']), slotWith(['slate'])), 'same');
  assert.equal(pickDaily(slotWith(['crane']), null), 'local');
  assert.equal(pickDaily(null, null), 'same');
  assert.equal(pickDaily(slotWith([]), null), 'same');
});
