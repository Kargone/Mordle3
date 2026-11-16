import { test } from 'node:test';
import assert from 'node:assert/strict';
import { todayScore, leaderEntry, boardValue, rowText, rankRows, MS_CAP } from '../js/leaderboard.js';
import { emptyStats } from '../js/stats.js';

test('today score: fewer guesses first, then faster; a loss ranks last', () => {
  const a = todayScore({ guesses: 3, won: true, ms: 72_000 });
  const b = todayScore({ guesses: 3, won: true, ms: 39_000 });
  const c = todayScore({ guesses: 2, won: true, ms: 600_000 });
  const lost = todayScore({ guesses: 6, won: false, ms: 1_000 });
  const order = [a, b, c, lost].sort((x, y) => x.score - y.score);
  assert.deepEqual(order, [c, b, a, lost]);
  assert.equal(a.score, 3 * 10_000_000 + 72_000);
  assert.equal(todayScore({ guesses: 4, won: true, ms: 99_999_999 }).ms, MS_CAP, 'very long times are capped');
});

test('leader entry: public summary of stats', () => {
  const stats = emptyStats();
  stats.daily = { ...stats.daily, played: 10, wins: 9, currentStreak: 4, maxStreak: 7, lastDay: 100 };
  stats.infini = { solved: 12, guesses: 90, fewest: 3, fastestMs: 41_000 };
  stats.battle = { ...stats.battle, played: 5, wins: 2, rivals: { x: {} } };
  const e = leaderEntry(stats, 'Kar', 101);
  assert.deepEqual(e, {
    name: 'Kar',
    daily: { streak: 4, maxStreak: 7, played: 10, wins: 9, lastDay: 100 },
    infini: { solved: 12, fewest: 3, fastestMs: 41_000 },
    battle: { wins: 2, played: 5 },
  });
  assert.equal(leaderEntry(stats, 'Kar', 105).daily.streak, 0, 'a lapsed streak is posted as 0');
  assert.deepEqual(leaderEntry({}, 'New', 1).daily, { streak: 0, maxStreak: 0, played: 0, wins: 0, lastDay: 0 });
});

test('daily board: a streak not kept up since counts as 0', () => {
  const live = { name: 'A', daily: { streak: 5, maxStreak: 9, lastDay: 99 } };
  const stale = { name: 'B', daily: { streak: 30, maxStreak: 30, lastDay: 50 } };
  assert.equal(boardValue('daily', live, 100), 5);
  assert.equal(boardValue('daily', stale, 100), 0);
  const ranked = rankRows('daily', [stale, live], 100);
  assert.deepEqual(ranked.map((r) => [r.name, r.rank]), [['A', 1], ['B', 2]]);
});

test('ranking: ties share a rank; today ranks lowest score first', () => {
  const rows = [{ name: 'A', infini: { solved: 5 } }, { name: 'B', infini: { solved: 9 } }, { name: 'C', infini: { solved: 5 } }];
  assert.deepEqual(rankRows('infini', rows, 1).map((r) => `${r.name}${r.rank}`), ['B1', 'A2', 'C2']);
  const today = [todayScore({ guesses: 4, won: true, ms: 1000 }), todayScore({ guesses: 2, won: true, ms: 5000 })].map((s, i) => ({ name: 'P' + i, ...s }));
  assert.deepEqual(rankRows('today', today, 1).map((r) => r.name), ['P1', 'P0']);
});

test('row text', () => {
  assert.deepEqual(rowText('today', todayScore({ guesses: 3, won: true, ms: 72_000 }), 1), ['3', '1:12']);
  assert.deepEqual(rowText('today', todayScore({ guesses: 6, won: false, ms: 200_000 }), 1), ['X', '3:20']);
  assert.deepEqual(rowText('infini', { infini: { solved: 188, fastestMs: 52_000 } }, 1), ['188', '0:52']);
  assert.deepEqual(rowText('infini', { infini: { solved: 0, fastestMs: 0 } }, 1), ['0', '–']);
  assert.deepEqual(rowText('battle', { battle: { wins: 21, played: 36 } }, 1), ['21', '58%']);
  assert.deepEqual(rowText('daily', { daily: { streak: 6, maxStreak: 14, lastDay: 10 } }, 10), ['6', '14']);
});
