// Merge rules for syncing between devices. Pure functions, no Firebase code.

import { emptyBucket, emptyStats, recordGame } from './stats.js';

/** Settings that follow you between devices. Mode is per-device. */
export const SYNCED_SETTINGS = ['hard', 'theme', 'contrast'];

export function pickSyncedSettings(settings) {
  const out = {};
  for (const k of SYNCED_SETTINGS) if (k in settings) out[k] = settings[k];
  return out;
}

/**
 * Combine one stats bucket from two devices that played separately.
 * Counts are added up; the best streak is the higher one; the current streak
 * comes from whichever device played the more recent daily. If both played the
 * same daily, that game is only counted once.
 */
export function mergeBucket(a = emptyBucket(), b = emptyBucket()) {
  const bLegacy = !('lastGuesses' in b); // saved before lastGuesses existed
  a = { ...emptyBucket(), ...a };
  b = { ...emptyBucket(), ...b };
  const out = {
    ...emptyBucket(),
    played: a.played + b.played,
    wins: a.wins + b.wins,
    distribution: a.distribution.map((n, i) => n + (b.distribution[i] ?? 0)),
    maxStreak: Math.max(a.maxStreak, b.maxStreak),
  };

  const sameDay = a.lastDay != null && a.lastDay === b.lastDay;
  if (sameDay) {
    // Drop b's copy of that day's game.
    out.played--;
    if (b.lastGuesses > 0) {
      out.wins--;
      out.distribution[b.lastGuesses - 1]--;
    } else if (bLegacy && a.currentStreak > 0 && b.currentStreak > 0) {
      out.wins--; // older data without lastGuesses: can't fix the chart, but keep the win count right
    }
    out.lastDay = a.lastDay;
    out.lastGuesses = a.lastGuesses;
    // a's result for the day is kept: if a lost it, the streak is broken.
    out.currentStreak = a.currentStreak > 0 ? Math.max(a.currentStreak, b.currentStreak) : 0;
  } else if (a.lastDay != null || b.lastDay != null) {
    const newer = (b.lastDay ?? -Infinity) > (a.lastDay ?? -Infinity) ? b : a;
    out.lastDay = newer.lastDay;
    out.lastGuesses = newer.lastGuesses;
    out.currentStreak = newer.currentStreak;
  } else {
    out.currentStreak = Math.max(a.currentStreak, b.currentStreak); // random: no dates to compare
  }
  out.maxStreak = Math.max(out.maxStreak, out.currentStreak);
  return out;
}

export function mergeStats(a = emptyStats(), b = emptyStats()) {
  return { daily: mergeBucket(a.daily, b.daily), random: mergeBucket(a.random, b.random) };
}

/** Apply finished games that haven't reached the cloud yet. */
export function applyResults(stats, results) {
  return results.reduce(recordGame, { ...emptyStats(), ...stats });
}

/** Newer settings win. Returns null if the remote ones are not newer. */
export function newerSettings(local, localAt, remote, remoteAt) {
  if (!remote || !(remoteAt > (localAt ?? 0))) return null;
  return { ...local, ...pickSyncedSettings(remote) };
}
