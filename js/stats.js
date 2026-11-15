// Stats bookkeeping. Pure functions over a plain stats object.
// Daily and random games keep separate buckets. InfiniMode games are not recorded.

import { MAX_GUESSES } from './game.js';

export function emptyBucket() {
  return {
    played: 0,
    wins: 0,
    currentStreak: 0,
    maxStreak: 0,
    distribution: Array(MAX_GUESSES).fill(0), // index = guesses - 1
    lastDay: null, // daily bucket only: puzzle number of the last recorded game
    lastGuesses: 0, // daily bucket only: guesses in that game if won, 0 if lost (used when merging devices)
  };
}

export function emptyStats() {
  return { daily: emptyBucket(), random: emptyBucket(), battle: emptyBattle() };
}

export const MAX_RIVALS = 30;

/** Battle record. rivals[uid] = { name, color, wins, losses, last } (wins/losses are matches against them). */
export function emptyBattle() {
  return {
    played: 0,
    wins: 0,
    roundsWon: 0,
    currentStreak: 0,
    maxStreak: 0,
    rivals: {},
    lastMatch: null, // id of the last recorded match, so it's only counted once
    lastAt: 0, // when it ended (ms)
  };
}

/** Keep the most recently played rivals. */
export function trimRivals(rivals) {
  const keep = Object.entries(rivals).sort((a, b) => b[1].last - a[1].last).slice(0, MAX_RIVALS);
  return Object.fromEntries(keep);
}

/** Rivals as a list, most recently played first. */
export function rivalList(battle) {
  return Object.entries(battle?.rivals ?? {})
    .map(([uid, r]) => ({ uid, ...r }))
    .sort((a, b) => b.last - a.last);
}

function recordBattle(stats, { match, won, rounds, at, opponents }) {
  const prev = { ...emptyBattle(), ...stats.battle };
  if (prev.lastMatch === match) return stats; // already counted
  const b = { ...prev, rivals: { ...prev.rivals } };
  b.played++;
  b.roundsWon += rounds;
  if (won) {
    b.wins++;
    b.currentStreak++;
    b.maxStreak = Math.max(b.maxStreak, b.currentStreak);
  } else {
    b.currentStreak = 0;
  }
  for (const o of opponents ?? []) {
    const r = b.rivals[o.uid] ?? { wins: 0, losses: 0 };
    b.rivals[o.uid] = {
      ...r, name: o.name, color: o.color, last: at,
      wins: r.wins + (o.result > 0 ? 1 : 0),
      losses: r.losses + (o.result < 0 ? 1 : 0),
    };
  }
  b.rivals = trimRivals(b.rivals);
  b.lastMatch = match;
  b.lastAt = at;
  return { ...stats, battle: b };
}

/**
 * Record a finished (non-infinite) game, or a battle match (see recordBattle).
 * Daily streaks only continue if the previous recorded daily was won on the
 * previous day. Random streaks are consecutive wins.
 * @param {{mode: 'daily' | 'random', won: boolean, guesses: number, day?: number}} result
 */
export function recordGame(stats, result) {
  if (result.mode === 'battle') return recordBattle(stats, result);
  const { mode, won, guesses, day } = result;
  const prev = stats[mode] ?? emptyBucket();
  if (mode === 'daily' && prev.lastDay === day) return stats; // already counted today

  const b = { ...prev, distribution: [...prev.distribution] };
  b.played++;
  if (won) {
    b.wins++;
    b.distribution[guesses - 1]++;
    const continues = mode === 'random' || prev.lastDay === day - 1;
    b.currentStreak = continues ? prev.currentStreak + 1 : 1;
    b.maxStreak = Math.max(b.maxStreak, b.currentStreak);
  } else {
    b.currentStreak = 0;
  }
  if (mode === 'daily') {
    b.lastDay = day;
    b.lastGuesses = won ? guesses : 0;
  }
  return { ...stats, [mode]: b };
}

/**
 * A daily streak is broken if a day was skipped. Call when displaying.
 */
export function effectiveStreak(bucket, mode, today) {
  if (mode !== 'daily' || bucket.lastDay == null) return bucket.currentStreak;
  return today - bucket.lastDay > 1 ? 0 : bucket.currentStreak;
}

export function winPercent(bucket) {
  return bucket.played ? Math.round((bucket.wins / bucket.played) * 100) : 0;
}
