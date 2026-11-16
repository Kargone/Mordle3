// Leaderboards for Google-signed-in players.
//
// Firestore (see firestore.rules):
//   leaders/{uid}            = { name, daily: {...}, infini: {...}, battle: {...}, updatedAt }
//   days/{day}/scores/{uid}  = { name, guesses, won, ms, score }   one per player per daily, write-once
//
// Every board is a single-field sort, so no composite indexes are needed.
// There's no server checking results (Spark plan): the rules only reject
// impossible values. Fine among friends; not tamper-proof.

import { MAX_GUESSES } from './game.js';
import { effectiveStreak } from './stats.js';
import { formatTime } from './clock.js';

export const TOP = 50;
export const MS_CAP = 9_999_999; // ~2h46m; longer daily times are shown as this
const LOST = MAX_GUESSES + 1;

export const BOARDS = {
  today: { label: 'Today', col: 'Guesses · time' },
  daily: { label: 'Daily', col: 'Streak · best', field: 'daily.streak' },
  infini: { label: '∞ Infini', col: 'Solved · fastest', field: 'infini.solved' },
  battle: { label: '⚔ Battle', col: 'Wins · win %', field: 'battle.wins' },
};

/** Today's daily as a leaderboard score. Lower `score` ranks higher: fewer guesses, then faster. */
export function todayScore({ guesses, won, ms }) {
  const t = Math.min(MS_CAP, Math.max(0, Math.round(ms || 0)));
  return { guesses, won: !!won, ms: t, score: (won ? guesses : LOST) * 10_000_000 + t };
}

/** The public summary of someone's stats (everything but `name` comes from their stats). */
export function leaderEntry(stats, name, today) {
  const d = stats.daily ?? {};
  const i = stats.infini ?? {};
  const b = stats.battle ?? {};
  const n = (v) => (Number.isInteger(v) && v > 0 ? v : 0);
  return {
    name,
    daily: {
      streak: n(effectiveStreak({ currentStreak: 0, ...d }, 'daily', today)),
      maxStreak: n(d.maxStreak), played: n(d.played), wins: n(d.wins), lastDay: n(d.lastDay),
    },
    infini: { solved: n(i.solved), fewest: n(i.fewest), fastestMs: n(i.fastestMs) },
    battle: { wins: n(b.wins), played: n(b.played) },
  };
}

/** The number a board sorts by, for one entry (today: its score, lower is better). */
export function boardValue(key, data, today) {
  if (key === 'today') return data.score;
  if (key === 'daily') return today - (data.daily?.lastDay ?? 0) > 1 ? 0 : data.daily?.streak ?? 0;
  return key === 'infini' ? data.infini?.solved ?? 0 : data.battle?.wins ?? 0;
}

/** [big number, small detail] for a row. */
export function rowText(key, data, today) {
  if (key === 'today') return [data.won ? String(data.guesses) : 'X', formatTime(data.ms)];
  if (key === 'daily') return [String(boardValue('daily', data, today)), String(data.daily?.maxStreak ?? 0)];
  if (key === 'infini') return [String(data.infini?.solved ?? 0), data.infini?.fastestMs ? formatTime(data.infini.fastestMs) : '–'];
  const { wins = 0, played = 0 } = data.battle ?? {};
  return [String(wins), played ? `${Math.round((wins / played) * 100)}%` : '–'];
}

/**
 * Rank rows for display. A daily streak is stored as of the player's last game,
 * so one that has since lapsed counts as 0 here and drops down the list.
 */
export function rankRows(key, rows, today) {
  const v = (r) => boardValue(key, r, today);
  const sorted = [...rows].sort((a, b) => (key === 'today' ? v(a) - v(b) : v(b) - v(a)));
  let rank = 0;
  return sorted.map((r, i) => {
    if (i === 0 || v(r) !== v(sorted[i - 1])) rank = i + 1; // ties share a rank
    return { ...r, rank };
  });
}

/**
 * Firestore side. Writes only happen for Google accounts (the rules check too).
 * @param {object} cloud from createCloud
 */
export function createLeaderboard(cloud) {
  const google = () => cloud.state.status === 'google';

  async function ctx() {
    const { fb, db, uid } = await cloud.session();
    return { fb, db, uid };
  }

  // Right after linking a Google account, the old ID token doesn't list it yet:
  // refresh once and retry.
  async function write(fn) {
    try {
      await fn();
    } catch (err) {
      if (err?.code !== 'permission-denied') throw err;
      await cloud.refreshToken();
      await fn();
    }
  }

  return {
    /** Save this player's summary. */
    async publish(entry) {
      if (!google()) return;
      const { fb, db, uid } = await ctx();
      await write(() => fb.setDoc(fb.doc(db, 'leaders', uid), { ...entry, updatedAt: fb.serverTimestamp() }));
    },

    /** Post today's daily result once (scores are write-once). */
    async publishToday(day, name, result) {
      if (!google()) return false;
      const { fb, db, uid } = await ctx();
      const ref = fb.doc(db, 'days', String(day), 'scores', uid);
      if ((await fb.getDoc(ref)).exists()) return true;
      await write(() => fb.setDoc(ref, { name, ...todayScore(result) }));
      return true;
    },

    /** New name on today's score (the only change a posted score allows). */
    async rename(day, name) {
      const { fb, db, uid } = await ctx();
      await fb.updateDoc(fb.doc(db, 'days', String(day), 'scores', uid), { name });
    },

    /** Take this player off the boards ("Hide me"). */
    async remove(day) {
      const { fb, db, uid } = await ctx();
      await Promise.all([
        fb.deleteDoc(fb.doc(db, 'leaders', uid)),
        fb.deleteDoc(fb.doc(db, 'days', String(day), 'scores', uid)),
      ]);
    },

    /** Top rows of a board: [{uid, rank, ...data}], plus this player's own entry if they have one. */
    async top(key, day) {
      const { fb, db, uid } = await ctx();
      const q = key === 'today'
        ? fb.query(fb.collection(db, 'days', String(day), 'scores'), fb.orderBy('score'), fb.limit(TOP))
        : fb.query(fb.collection(db, 'leaders'), fb.orderBy(BOARDS[key].field, 'desc'), fb.limit(TOP));
      const ownRef = key === 'today' ? fb.doc(db, 'days', String(day), 'scores', uid) : fb.doc(db, 'leaders', uid);
      const [snap, own] = await Promise.all([fb.getDocs(q), fb.getDoc(ownRef)]);
      const rows = rankRows(key, snap.docs.map((d) => ({ uid: d.id, ...d.data() })), day);
      return { rows, me: uid, own: own.exists() ? own.data() : null };
    },

    /** Where `data` (an entry or today's score) stands: { rank, total }. Counts are cheap aggregate reads. */
    async rank(key, data, day) {
      const { fb, db } = await ctx();
      const col = key === 'today' ? fb.collection(db, 'days', String(day), 'scores') : fb.collection(db, 'leaders');
      const field = key === 'today' ? 'score' : BOARDS[key].field;
      const value = key === 'today' ? data.score : boardValue(key, data, day);
      const better = fb.query(col, fb.where(field, key === 'today' ? '<' : '>', value));
      const [ahead, all] = await Promise.all([fb.getCountFromServer(better), fb.getCountFromServer(col)]);
      return { rank: ahead.data().count + 1, total: all.data().count };
    },
  };
}
