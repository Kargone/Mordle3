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
  return { daily: emptyBucket(), random: emptyBucket() };
}

/**
 * Record a finished (non-infinite) game.
 * Daily streaks only continue if the previous recorded daily was won on the
 * previous day. Random streaks are consecutive wins.
 * @param {{mode: 'daily' | 'random', won: boolean, guesses: number, day?: number}} result
 */
export function recordGame(stats, { mode, won, guesses, day }) {
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
