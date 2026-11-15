// Battle rooms in Firestore: rooms/{code}. Every change that depends on the
// current room runs in a transaction through a pure function from logic.js, so
// two players acting at once can't overwrite each other.

import * as L from './logic.js';

export const HEARTBEAT_MS = 20_000;
// Every write pushes expireAt a day ahead. With a Firestore TTL policy on
// rooms.expireAt, rooms nobody has touched for a day get deleted automatically.
export const ROOM_LIFETIME_MS = 24 * 60 * 60 * 1000;
const expiry = (now) => new Date(now + ROOM_LIFETIME_MS);

/**
 * @param {{fb: object, db: object, uid: string}} session from cloud.session()
 */
export function createRoomsApi(session) {
  const { fb, db, uid } = session;
  const roomRef = (code) => fb.doc(db, 'rooms', code);

  // This player's changes run one at a time, so quick taps don't collide with each other.
  let queue = Promise.resolve();
  function mutate(code, change) {
    const run = () => transact(code, change);
    const result = queue.then(run, run);
    queue = result.catch(() => {});
    return result;
  }

  /** Run `change(room)` in a transaction. It returns the new room, null for "no change", or {error}. */
  async function transact(code, change) {
    return fb.runTransaction(db, async (tx) => {
      const snap = await tx.get(roomRef(code));
      if (!snap.exists()) return { error: 'gone' };
      const now = Date.now();
      const out = change(snap.data(), now);
      if (!out) return { room: snap.data(), unchanged: true };
      if (out.error) return out;
      const next = 'room' in out ? out.room : out;
      if (next === null) tx.delete(roomRef(code));
      else tx.set(roomRef(code), { ...next, expireAt: expiry(now) });
      return { room: next };
    });
  }

  return {
    uid,

    async create(name) {
      for (let attempt = 0; attempt < 5; attempt++) {
        const code = L.makeCode();
        const made = await fb.runTransaction(db, async (tx) => {
          const snap = await tx.get(roomRef(code));
          if (snap.exists()) return null;
          const now = Date.now();
          const room = L.createRoom({ code, uid, name, now });
          tx.set(roomRef(code), { ...room, expireAt: expiry(now) });
          return room;
        });
        if (made) return made;
      }
      throw new Error('Could not find a free room code');
    },

    join: (code, name) => mutate(code, (room, now) => L.joinRoom(room, { uid, name, now })),
    leave: (code) => mutate(code, (room, now) => L.leaveRoom(room, { uid, now })),
    /** step: +1/-1 for a stepper (applied to the latest value, so quick taps all count); else value. */
    settings: (code, key, { step, value }) => mutate(code, (room, now) => {
      const patch = step != null ? { [key]: room.settings[key] + step * L.LIMITS[key].step } : { [key]: value };
      return L.updateSettings(room, { uid, patch, now });
    }),
    start: (code, seed) => mutate(code, (room, now) => L.startRound(room, { uid, seed, now })),
    guess: (code, word, turnId, answers, valid) =>
      mutate(code, (room, now) => L.applyGuess(room, { uid, word, turnId, answers, valid, now })),
    skip: (code, turnId) => mutate(code, (room, now) => L.skipTurn(room, { turnId, now })),
    claimHost: (code) => mutate(code, (room, now) => L.claimHost(room, { uid, now })),

    /** Cheap presence ping: a field update, not a transaction. */
    heartbeat(code) {
      const now = Date.now();
      return fb.updateDoc(roomRef(code), { [`players.${uid}.seen`]: now, updatedAt: now, expireAt: expiry(now) });
    },

    watch(code, onRoom, onError) {
      // fromCache: the SDK may first replay an older cached copy (e.g. from the lobby list).
      return fb.onSnapshot(roomRef(code), (snap) => onRoom(snap.exists() ? snap.data() : null, !!snap.metadata?.fromCache), onError);
    },

    /** Live list of public rooms waiting for players. */
    watchLobby(onRooms, onError) {
      const q = fb.query(fb.collection(db, 'rooms'), fb.where('public', '==', true), fb.where('status', '==', 'lobby'));
      return fb.onSnapshot(q, (snap) => {
        const now = Date.now();
        const rooms = snap.docs.map((d) => d.data()).filter((r) => L.listable(r, now));
        rooms.sort((a, b) => b.updatedAt - a.updatedAt);
        onRooms(rooms.slice(0, 20));
      }, onError);
    },
  };
}
