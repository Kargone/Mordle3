// Merge rules for syncing between devices. Pure functions, no Firebase code.

import { emptyBucket, emptyBattle, emptyStats, recordGame, trimRivals } from './stats.js';
import { evaluateGuess, MAX_GUESSES } from './game.js';

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

/** Battle records from two devices: counts added, rivals combined, streak from the newer one. */
export function mergeBattle(a = emptyBattle(), b = emptyBattle()) {
  a = { ...emptyBattle(), ...a };
  b = { ...emptyBattle(), ...b };
  const newer = b.lastAt > a.lastAt ? b : a;
  const rivals = { ...a.rivals };
  for (const [uid, r] of Object.entries(b.rivals)) {
    const o = rivals[uid];
    rivals[uid] = !o ? r : {
      ...(r.last > o.last ? r : o),
      wins: o.wins + r.wins,
      losses: o.losses + r.losses,
    };
  }
  return {
    played: a.played + b.played,
    wins: a.wins + b.wins,
    roundsWon: a.roundsWon + b.roundsWon,
    currentStreak: newer.currentStreak,
    maxStreak: Math.max(a.maxStreak, b.maxStreak),
    rivals: trimRivals(rivals),
    lastMatch: newer.lastMatch,
    lastAt: newer.lastAt,
  };
}

export function mergeStats(a = emptyStats(), b = emptyStats()) {
  return {
    daily: mergeBucket(a.daily, b.daily),
    random: mergeBucket(a.random, b.random),
    battle: mergeBattle(a.battle, b.battle),
  };
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

// ---------- in-progress daily ----------
// Stored as { day, seed, guesses, hard }. Firestore can't hold nested arrays,
// so colors are recomputed from the guesses. Typed-but-unsubmitted letters stay local.

export function encodeDaily(slot) {
  return { day: slot.day, seed: slot.seed, guesses: [...slot.state.guesses], hard: !!slot.state.hard };
}

/** Rebuild a daily slot from cloud data, or null if it doesn't fit today's word. */
export function decodeDaily(data, answers, today) {
  if (!data || data.day !== today || !Array.isArray(data.guesses)) return null;
  const answer = answers[data.seed];
  if (!answer || data.guesses.length > MAX_GUESSES) return null;
  if (!data.guesses.every((g) => typeof g === 'string' && /^[a-z]{5}$/.test(g))) return null;
  const won = data.guesses.at(-1) === answer;
  if (data.guesses.slice(0, -1).includes(answer)) return null; // can't keep guessing after a win
  const status = won ? 'won' : data.guesses.length >= MAX_GUESSES ? 'lost' : 'playing';
  return {
    day: data.day,
    seed: data.seed,
    recorded: status !== 'playing', // the device that finished it already counted it
    state: {
      answer, infinite: false, hard: !!data.hard, current: '', status,
      guesses: [...data.guesses],
      evaluations: data.guesses.map((g) => evaluateGuess(g, answer)),
    },
  };
}

/**
 * Which copy of today's daily to keep: the one with more guesses.
 * @returns {'remote' | 'local' | 'same'}
 */
export function pickDaily(localSlot, remoteSlot) {
  const l = localSlot?.state.guesses.length ?? 0;
  const r = remoteSlot?.state.guesses.length ?? 0;
  if (remoteSlot && r > l) return 'remote';
  if (localSlot && l > r) return 'local';
  return 'same';
}
