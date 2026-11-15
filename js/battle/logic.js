// Battle mode rules. Pure functions over a plain room object; no Firebase code.
//
// Players take turns guessing on one shared board. A turn lasts
// settings.turnSecs; when it runs out the turn is skipped. The first player to
// guess the word wins the round. A match is settings.rounds rounds
// (0 = unlimited: it goes on until the host ends it).
//
// Room shape (one Firestore doc, rooms/{code}):
// {
//   code, hostUid, public, status: 'lobby' | 'playing' | 'roundOver' | 'matchOver',
//   settings: { turnSecs, rounds, maxPlayers, hard },
//   players: { [uid]: { name, color, score, seen } },   // seen = ms timestamp
//   order: [uid, ...],                                    // join order
//   round, seed, guesses: [{ uid, word }], turn: { uid, id } | null,
//   winner, createdAt, updatedAt
// }

import { evaluateGuess, hardModeViolation, WORD_LENGTH } from '../game.js';

export const COLORS = ['#a78bfa', '#f472b6', '#60a5fa', '#a3e635', '#f87171', '#e879f9', '#cbd5e1', '#fde047'];
export const LIMITS = {
  turnSecs: { min: 5, max: 60, step: 5 },
  rounds: { min: 1, max: 10, step: 1 },
  maxPlayers: { min: 2, max: 8, step: 1 },
};
export const DEFAULT_SETTINGS = { turnSecs: 10, rounds: 0, maxPlayers: 8, hard: false };
export const UNLIMITED = 0; // settings.rounds value for "keep playing until the host ends the match"
export const AWAY_MS = 60_000; // no heartbeat for this long = gone
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function makeCode(rand = Math.random) {
  return Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(rand() * CODE_CHARS.length)]).join('');
}

export function normalizeCode(text) {
  const code = String(text ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return code.length === 4 && [...code].every((c) => CODE_CHARS.includes(c)) ? code : null;
}

export function cleanName(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, 16);
}

const clamp = (n, { min, max }) => Math.min(max, Math.max(min, Math.round(Number(n) || 0)));

export function cleanSettings(s = {}) {
  return {
    turnSecs: clamp(s.turnSecs ?? DEFAULT_SETTINGS.turnSecs, LIMITS.turnSecs),
    rounds: Number(s.rounds ?? DEFAULT_SETTINGS.rounds) === UNLIMITED ? UNLIMITED : clamp(s.rounds, LIMITS.rounds),
    maxPlayers: clamp(s.maxPlayers ?? DEFAULT_SETTINGS.maxPlayers, LIMITS.maxPlayers),
    hard: !!s.hard,
  };
}

/**
 * A stepper press: the setting's next value. Rounds go 1 … 10, then ∞ (unlimited).
 */
export function stepSetting(key, value, step) {
  const lim = LIMITS[key];
  if (key === 'rounds') {
    const pos = value === UNLIMITED ? lim.max + 1 : value; // ∞ sits just past the max
    const next = Math.min(lim.max + 1, Math.max(lim.min, pos + step));
    return next > lim.max ? UNLIMITED : next;
  }
  return Math.min(lim.max, Math.max(lim.min, value + step * lim.step));
}

/** Last stepper position? (for disabling − and +) */
export function atLimit(key, value, step) {
  return stepSetting(key, value, step) === value;
}

export const isUnlimited = (room) => room.settings.rounds === UNLIMITED;

export function isPresent(room, uid, now) {
  const p = room.players?.[uid];
  return !!p && now - (p.seen ?? 0) < AWAY_MS;
}

export const presentPlayers = (room, now) => room.order.filter((uid) => isPresent(room, uid, now));

export function createRoom({ code, uid, name, now }) {
  return {
    code,
    hostUid: uid,
    public: true,
    status: 'lobby',
    settings: { ...DEFAULT_SETTINGS },
    players: { [uid]: { name: cleanName(name) || 'Player', color: COLORS[0], score: 0, seen: now } },
    order: [uid],
    round: 0,
    seed: null,
    guesses: [],
    turn: null,
    winner: null,
    createdAt: now,
    updatedAt: now,
  };
}

/** Join, or come back to, a room. */
export function joinRoom(room, { uid, name, now }) {
  const existing = room.players[uid];
  if (existing) {
    return { room: { ...room, players: { ...room.players, [uid]: { ...existing, name: cleanName(name) || existing.name, seen: now } }, updatedAt: now } };
  }
  if (room.status !== 'lobby') return { error: 'started' };
  if (room.order.length >= room.settings.maxPlayers) return { error: 'full' };
  const used = new Set(Object.values(room.players).map((p) => p.color));
  const color = COLORS.find((c) => !used.has(c)) ?? COLORS[room.order.length % COLORS.length];
  return {
    room: {
      ...room,
      players: { ...room.players, [uid]: { name: cleanName(name) || 'Player', color, score: 0, seen: now } },
      order: [...room.order, uid],
      updatedAt: now,
    },
  };
}

/** Next present player after `uid` in turn order. Falls back to `uid` if nobody else is here. */
export function nextTurnUid(room, uid, now) {
  const n = room.order.length;
  const start = room.order.indexOf(uid);
  for (let i = 1; i <= n; i++) {
    const cand = room.order[(start + i + n) % n];
    if (isPresent(room, cand, now)) return cand;
  }
  return uid;
}

/** Leave a room. Returns { room: null } when the last player leaves (delete it). */
export function leaveRoom(room, { uid, now }) {
  if (!room.players[uid]) return { room };
  const players = { ...room.players };
  delete players[uid];
  const order = room.order.filter((u) => u !== uid);
  if (!order.length) return { room: null };
  let next = { ...room, players, order, updatedAt: now };
  if (room.hostUid === uid) next.hostUid = order.find((u) => isPresent(next, u, now)) ?? order[0];
  if (room.turn?.uid === uid) {
    next.turn = { uid: nextTurnUid(room, uid, now), id: room.turn.id + 1 };
    if (next.turn.uid === uid) next.turn = { uid: order[0], id: room.turn.id + 1 };
  }
  if (room.status === 'playing' && order.length === 1 && room.order.length > 1) {
    // Everyone else left mid-round: nothing to race against, end the round.
    next = { ...next, status: 'roundOver', turn: null, winner: null };
  }
  return { room: next };
}

/** If the host has gone quiet, the first present player takes over. */
export function claimHost(room, { uid, now }) {
  if (isPresent(room, room.hostUid, now) || !isPresent(room, uid, now)) return null;
  const heir = room.order.find((u) => isPresent(room, u, now));
  return heir === uid ? { ...room, hostUid: uid, updatedAt: now } : null;
}

export function updateSettings(room, { uid, patch, now }) {
  if (uid !== room.hostUid || room.status !== 'lobby') return null;
  const settings = cleanSettings({ ...room.settings, ...patch });
  if (settings.maxPlayers < room.order.length) settings.maxPlayers = room.order.length;
  return { ...room, settings, public: 'public' in patch ? !!patch.public : room.public, updatedAt: now };
}

/** Start the next round (round 1 resets the scores). Host only. */
export function startRound(room, { uid, seed, now }) {
  if (uid !== room.hostUid) return { error: 'host' };
  const newMatch = room.status === 'lobby' || room.status === 'matchOver';
  if (!newMatch && room.status !== 'roundOver') return { error: 'state' };
  if (presentPlayers(room, now).length < 2) return { error: 'players' };

  const players = { ...room.players };
  if (newMatch) for (const u of Object.keys(players)) players[u] = { ...players[u], score: 0 };
  const round = newMatch ? 1 : room.round + 1;
  // The first turn rotates each round so nobody always goes first.
  const preferred = room.order[(round - 1) % room.order.length];
  const first = isPresent(room, preferred, now) ? preferred : nextTurnUid(room, preferred, now);
  return {
    room: {
      ...room, players, round, seed,
      status: 'playing',
      guesses: [],
      winner: null,
      turn: { uid: first, id: (room.turn?.id ?? 0) + 1 },
      updatedAt: now,
    },
  };
}

/** Host ends the match between rounds (how an unlimited match finishes). */
export function endMatch(room, { uid, now }) {
  if (uid !== room.hostUid || room.status !== 'roundOver') return null;
  return { ...room, status: 'matchOver', updatedAt: now };
}

/** The shared board as a solo-style game state (for coloring and hard mode). */
export function sharedState(room, answers) {
  const answer = answers[room.seed] ?? '';
  const guesses = (room.guesses ?? []).map((g) => g.word);
  return {
    answer, guesses, hard: !!room.settings.hard, infinite: true, current: '', status: 'playing',
    evaluations: guesses.map((g) => evaluateGuess(g, answer)),
  };
}

/**
 * Check a guess before sending it (also run inside the transaction).
 * @returns {null | 'turn' | 'short' | 'invalid' | string} null if OK, else an error
 */
export function guessError(room, { uid, word, answers, valid }) {
  if (room.status !== 'playing' || room.turn?.uid !== uid) return 'turn';
  if (word.length < WORD_LENGTH) return 'short';
  if (!valid.has(word)) return 'invalid';
  if (room.settings.hard) {
    const reason = hardModeViolation(sharedState(room, answers), word);
    if (reason) return reason;
  }
  return null;
}

export function applyGuess(room, { uid, word, turnId, answers, valid, now }) {
  if (room.turn?.id !== turnId) return { error: 'turn' };
  const error = guessError(room, { uid, word, answers, valid });
  if (error) return { error };
  const guesses = [...room.guesses, { uid, word }];
  if (word === answers[room.seed]) {
    const players = { ...room.players, [uid]: { ...room.players[uid], score: room.players[uid].score + 1 } };
    const status = !isUnlimited(room) && room.round >= room.settings.rounds ? 'matchOver' : 'roundOver';
    return { room: { ...room, guesses, players, status, winner: uid, turn: null, updatedAt: now } };
  }
  return { room: { ...room, guesses, turn: { uid: nextTurnUid(room, uid, now), id: room.turn.id + 1 }, updatedAt: now } };
}

/** Time ran out: skip to the next player. Null if the turn already moved on. */
export function skipTurn(room, { turnId, now }) {
  if (room.status !== 'playing' || room.turn?.id !== turnId) return null;
  return { ...room, turn: { uid: nextTurnUid(room, room.turn.uid, now), id: turnId + 1 }, updatedAt: now };
}

/** Players sorted by score, for the scoreboard. */
export function standings(room) {
  return room.order
    .map((uid) => ({ uid, ...room.players[uid] }))
    .sort((a, b) => b.score - a.score || room.order.indexOf(a.uid) - room.order.indexOf(b.uid));
}

/** Match winners (more than one on a tie). */
export function matchWinners(room) {
  const top = Math.max(0, ...Object.values(room.players).map((p) => p.score));
  return top > 0 ? room.order.filter((u) => room.players[u].score === top) : [];
}

/** Rooms worth listing in the lobby browser. */
export function listable(room, now) {
  return room.public && room.status === 'lobby' && room.order.length < room.settings.maxPlayers
    && presentPlayers(room, now).length > 0;
}

/**
 * This player's result for a finished match, for their stats. Null if the
 * match isn't over or they weren't in it.
 * A win means the top score alone; a shared top score is a tie.
 */
export function matchResult(room, uid) {
  if (room.status !== 'matchOver' || !room.players[uid]) return null;
  const mine = room.players[uid].score;
  const winners = matchWinners(room);
  return {
    mode: 'battle',
    match: `${room.code}-${room.seed}-${room.round}`,
    won: winners.length === 1 && winners[0] === uid,
    rounds: mine,
    at: room.updatedAt,
    opponents: room.order.filter((u) => u !== uid).map((u) => {
      const p = room.players[u];
      return { uid: u, name: p.name, color: p.color, result: Math.sign(mine - p.score) };
    }),
  };
}
