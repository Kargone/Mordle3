// Firebase sync. Loaded only when js/firebase-config.js has a config, and the
// game never waits on it: localStorage stays the source the UI reads from, and
// this module copies data to and from Firestore in the background.
//
// Every player is signed in anonymously. Signing in with Google links that
// anonymous account (same uid), or, if the Google account is already used on
// another device, switches to it and merges this device's stats in once.
//
// Firestore: users/{uid} = { stats, settings, settingsAt, daily, updatedAt }

import { load, save } from './storage.js';
import { emptyStats } from './stats.js';
import { mergeStats, applyResults, pickSyncedSettings } from './sync.js';

const SDK = 'https://www.gstatic.com/firebasejs/11.0.2';

/**
 * @typedef {{
 *   status: 'off' | 'connecting' | 'anon' | 'google' | 'error',
 *   name?: string, pending?: number,
 * }} CloudState
 *
 * @param {object | null} config Firebase web config
 * @param {{
 *   getLocal: () => {stats: object, settings: object, settingsAt: number},
 *   onData: (data: {stats: object, settings?: object, settingsAt?: number, daily?: object}) => void,
 *   onSignedOut: () => void,
 *   onState: (state: CloudState) => void,
 * }} hooks
 */
export function createCloud(config, hooks) {
  let fb = null; // loaded SDK functions
  let auth = null;
  let db = null;
  let ref = null; // users/{uid}
  let unsubscribe = null;
  let state = { status: config ? 'connecting' : 'off' };
  let flushing = null;
  let session = null; // { fb, db, uid, name } once signed in
  const waiters = [];

  const pending = () => load('pending', []);
  const emit = (patch) => {
    state = { ...state, ...patch, pending: pending().length };
    hooks.onState(state);
  };

  async function start() {
    hooks.onState(state);
    if (!config) return;
    try {
      const [app, authMod, store] = await Promise.all([
        import(`${SDK}/firebase-app.js`),
        import(`${SDK}/firebase-auth.js`),
        import(`${SDK}/firebase-firestore.js`),
      ]);
      fb = { ...authMod, ...store };
      const fbApp = app.initializeApp(config);
      auth = authMod.getAuth(fbApp);
      db = store.getFirestore(fbApp);
      authMod.onAuthStateChanged(auth, (user) => {
        if (user) attach(user).catch(fail);
        else authMod.signInAnonymously(auth).catch(fail);
      });
      addEventListener('online', () => flush());
    } catch (err) {
      fail(err);
    }
  }

  function fail(err) {
    console.warn('Sync unavailable:', err?.code ?? err?.message ?? err);
    emit({ status: 'error' });
  }

  function describe(user) {
    const google = user.providerData.some((p) => p.providerId === 'google.com');
    return { status: google ? 'google' : 'anon', name: google ? (user.displayName || user.email || 'Google account') : undefined };
  }

  async function attach(user) {
    unsubscribe?.();
    ref = fb.doc(db, 'users', user.uid);

    // First time this device sees this account: merge local stats into it once.
    if (load('syncUid', null) !== user.uid) {
      const local = hooks.getLocal();
      const merged = pending().length; // local stats already include these games
      await fb.runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        const remote = snap.exists() ? snap.data() : null;
        const stats = remote?.stats ? mergeStats(remote.stats, local.stats) : local.stats;
        const useLocalSettings = !remote?.settings || (local.settingsAt ?? 0) > (remote.settingsAt ?? 0);
        tx.set(ref, {
          stats,
          settings: useLocalSettings ? pickSyncedSettings(local.settings) : remote.settings,
          settingsAt: useLocalSettings ? (local.settingsAt ?? 0) : remote.settingsAt,
          updatedAt: fb.serverTimestamp(),
        }, { merge: true }); // keep fields this merge doesn't touch, like daily
      });
      save('pending', pending().slice(merged)); // those games are now part of the merged stats
      save('syncUid', user.uid);
    }

    emit(describe(user));
    session = { fb, db, uid: user.uid, name: user.displayName || '' };
    waiters.splice(0).forEach((resolve) => resolve(session));
    unsubscribe = fb.onSnapshot(ref, (snap) => {
      if (!snap.exists()) return;
      const d = snap.data();
      // Show cloud stats plus any games still waiting to upload.
      hooks.onData({ stats: applyResults(d.stats ?? emptyStats(), pending()), settings: d.settings, settingsAt: d.settingsAt, daily: d.daily });
    }, fail);
    await flush();
  }

  /** Upload finished games. Each one is applied inside a transaction, so two devices never overwrite each other. */
  function flush() {
    if (!ref || flushing) return flushing;
    const queue = pending();
    if (!queue.length) return Promise.resolve();
    flushing = fb.runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      const stats = applyResults(snap.data()?.stats ?? emptyStats(), queue);
      tx.set(ref, { stats, updatedAt: fb.serverTimestamp() }, { merge: true });
    }).then(() => {
      // Only remove what was uploaded; more games may have finished meanwhile.
      save('pending', pending().slice(queue.length));
      emit({});
    }).catch((err) => {
      console.warn('Sync will retry:', err?.code ?? err);
      emit({});
    }).finally(() => { flushing = null; });
    return flushing;
  }

  return {
    start,
    get state() { return state; },
    get enabled() { return !!config; },

    /** Firestore access for battle mode. Resolves once signed in (anonymously or with Google). */
    session() {
      if (session) return Promise.resolve(session);
      return new Promise((resolve) => waiters.push(resolve));
    },

    /** Call when a Daily or Random game finishes (after recording it locally). */
    record(result) {
      if (!config) return;
      save('pending', [...pending(), result]);
      emit({});
      flush();
    },

    /** Save today's daily progress ({day, seed, guesses, hard}). */
    pushDaily(daily) {
      if (!ref) return;
      fb.setDoc(ref, { daily }, { merge: true }).catch((err) => console.warn('Daily sync failed:', err?.code ?? err));
    },

    pushSettings(settings, settingsAt) {
      if (!ref) return;
      fb.setDoc(ref, { settings: pickSyncedSettings(settings), settingsAt }, { merge: true }).catch(fail);
    },

    async signInWithGoogle() {
      if (!auth) return;
      const provider = new fb.GoogleAuthProvider();
      try {
        const cred = await fb.linkWithPopup(auth.currentUser, provider);
        emit(describe(cred.user)); // same uid, so no auth change event
      } catch (err) {
        if (err?.code === 'auth/credential-already-in-use') {
          // This Google account is already used on another device: switch to it.
          // attach() merges this device's stats in because the uid changes.
          await fb.signInWithCredential(auth, fb.GoogleAuthProvider.credentialFromError(err));
        } else if (err?.code !== 'auth/popup-closed-by-user' && err?.code !== 'auth/cancelled-popup-request') {
          throw err;
        }
      }
    },

    async signOut() {
      if (!auth) return;
      await flush();
      unsubscribe?.();
      unsubscribe = null;
      ref = null;
      session = null;
      // Stats are safe in the Google account. Start this device fresh so they
      // aren't merged in a second time on the next sign-in.
      save('pending', []);
      hooks.onSignedOut();
      emit({ status: 'connecting', name: undefined });
      await fb.signOut(auth); // onAuthStateChanged then signs in anonymously
    },
  };
}
