// Battle mode: connects the rooms API, the views, timers and the keyboard.

import { ANSWERS, VALID } from '../words.js';
import { randomSeed } from '../daily.js';
import { keyboardStates, WORD_LENGTH } from '../game.js';
import { load, save } from '../storage.js';
import { createRoomsApi, HEARTBEAT_MS } from './net.js';
import { sharedState, guessError, presentPlayers, isPresent, normalizeCode, cleanName, matchResult, LIMITS } from './logic.js';
import { showPanel, renderLobby, renderRoom, createRaceView, renderRoundSheet, renderBattleStats, roomUrl, roundOf } from './view.js';
import { emptyBattle, rivalList } from '../stats.js';

const $ = (id) => document.getElementById(id);
const BACKUP_SKIP_MS = 3000; // others skip a stuck turn this long after the timer ends

const ERRORS = {
  short: 'Not enough letters',
  invalid: 'Not in word list',
  turn: 'Too late, the turn passed',
  gone: "That room doesn't exist anymore",
  full: 'That room is full',
  started: 'That game has already started',
  players: 'You need at least 2 players',
  host: 'Only the host can do that',
};

/**
 * @param {{
 *   cloud: object, keyboard: object, toast: (msg: string, ms?: number) => void,
 *   announce: (text: string) => void, onHeader: () => void,
 *   onMatch: (result: object) => void, getStats: () => object,
 * }} deps
 * onMatch gets this player's matchResult() each time a finished match is seen
 * (the stats code ignores repeats); getStats returns the battle stats bucket.
 */
export function createBattle({ cloud, keyboard, toast, announce, onHeader, onMatch, getStats }) {
  let api = null;
  let active = false; // battle mode is on screen
  let code = load('battleRoom', null);
  let room = null;
  let unwatchRoom = null;
  let unwatchLobby = null;
  let lobbyRooms = [];
  let draft = '';
  let sending = false;
  let turnSeen = { id: null, at: 0 };
  let skippedId = null;
  let sheetFor = '';
  let ticker = null;
  let heartbeat = null;
  const race = createRaceView();

  const me = () => api?.uid;
  const answer = () => ANSWERS[room?.seed] ?? '';

  async function connect() {
    if (api) return api;
    api = createRoomsApi(await cloud.session());
    return api;
  }

  const statsDialog = $('bstats-dialog');
  statsDialog.addEventListener('click', (e) => { if (e.target === statsDialog) statsDialog.close(); });
  function openStats() {
    const battle = { ...emptyBattle(), ...getStats() };
    renderBattleStats(battle, rivalList(battle), Date.now());
    if (!statsDialog.open) statsDialog.showModal();
  }

  // Leaving the app (switching apps, locking the phone, closing the tab) marks
  // this player away so their turns are skipped at once; coming back clears it.
  function markAway(away) {
    if (!code || !api || !room) return;
    api.heartbeat(code, away).catch(() => {});
  }
  document.addEventListener('visibilitychange', () => markAway(document.hidden));
  window.addEventListener('pagehide', () => markAway(true));
  window.addEventListener('pageshow', (e) => { if (e.persisted) markAway(false); });

  // ---------- room subscription ----------
  function enterRoom(nextCode, firstRoom) {
    if (code !== nextCode || !unwatchRoom) {
      unwatchRoom?.();
      code = nextCode;
      save('battleRoom', code);
      unwatchRoom = api.watch(code, onRoom, (err) => console.warn('Room watch failed:', err?.code ?? err));
      clearInterval(heartbeat);
      heartbeat = setInterval(beat, HEARTBEAT_MS);
    }
    if (firstRoom) onRoom(firstRoom);
    history.replaceState(null, '', `${location.pathname}?battle=${code}`);
  }

  function exitRoom(message) {
    unwatchRoom?.();
    unwatchRoom = null;
    clearInterval(heartbeat);
    clearInterval(ticker);
    ticker = null;
    code = null;
    room = null;
    draft = '';
    save('battleRoom', null);
    if (location.search.includes('battle=')) history.replaceState(null, '', location.pathname);
    $('round-dialog').open && $('round-dialog').close();
    if (message) toast(message, 2200);
    render();
  }

  async function beat() {
    if (!code || !api) return;
    try {
      await api.heartbeat(code);
      if (room && room.hostUid !== me() && !isPresent(room, room.hostUid, Date.now())) await api.claimHost(code);
    } catch (err) {
      console.warn('Heartbeat failed:', err?.code ?? err);
    }
  }

  function onRoom(next, fromCache = false) {
    // A cached or out-of-order copy can be older than what we already have
    // (for example from before we joined). Wait for the server's copy.
    if (fromCache && (!next || !next.players[me()])) return;
    if (next && room && next.code === room.code && next.updatedAt < room.updatedAt) return;
    if (!next) return exitRoom('The room was closed');
    if (!next.players[me()]) return exitRoom('You left the room');
    const prev = room;
    room = next;

    if (room.turn && room.turn.id !== turnSeen.id) {
      turnSeen = { id: room.turn.id, at: performance.now() };
      if (room.turn.uid === me() && room.status === 'playing') {
        toast('Your turn!', 1200);
        announce("Your turn. Type a word and press Enter.");
      }
    }
    if (prev && prev.round !== room.round) draft = '';
    if (room.status === 'matchOver') {
      const result = matchResult(room, me());
      if (result) onMatch(result);
    }
    if (room.status === 'playing' && !ticker) ticker = setInterval(tick, 100);
    if (room.status !== 'playing') { clearInterval(ticker); ticker = null; }

    // Announce new guesses for screen readers.
    if (prev && prev.round === room.round && room.guesses.length > prev.guesses.length) {
      const g = room.guesses.at(-1);
      announce(`${g.uid === me() ? 'You' : room.players[g.uid]?.name} guessed ${g.word.toUpperCase()}`);
    }
    render();
  }

  // ---------- timer ----------
  function tick() {
    if (!room || room.status !== 'playing' || !room.turn) return;
    const total = room.settings.turnSecs * 1000;
    const elapsed = performance.now() - turnSeen.at;
    if (active) race.tick(1 - elapsed / total, (total - elapsed) / 1000);
    const mine = room.turn.uid === me();
    // The current player's device ends their own turn; everyone else is a backup
    // in case that device went to sleep or lost connection.
    // A player who closed the game or switched away is skipped right away. (Only the
    // away flag is trusted here; comparing timestamps across devices can be off.)
    const gone = !mine && !!room.players[room.turn.uid]?.away;
    if ((gone || elapsed >= total + (mine ? 0 : BACKUP_SKIP_MS)) && skippedId !== room.turn.id) {
      skippedId = room.turn.id;
      if (mine) toast("Time's up!", 1000);
      api.skip(code, room.turn.id).catch((err) => console.warn('Skip failed:', err?.code ?? err));
    }
  }

  // ---------- rendering ----------
  function render() {
    onHeader();
    if (!active) return;
    if (!api) {
      showPanel('lobby');
      renderLobby({ rooms: [], connecting: true });
      return;
    }
    if (!room) {
      showPanel('lobby');
      renderLobby({ rooms: lobbyRooms, connecting: false, onJoin: join });
      watchLobby(true);
      return;
    }
    watchLobby(false);
    const now = Date.now();
    if (room.status === 'lobby') {
      showPanel('room');
      renderRoom(room, me(), now);
      closeSheet();
      return;
    }
    showPanel('race');
    const shared = sharedState(room, ANSWERS);
    race.render(room, { me: me(), now, draft, evaluations: shared.evaluations });
    keyboard.update(keyboardStates(shared));
    if (room.status === 'playing') closeSheet();
    else {
      renderRoundSheet(room, me(), now, answer());
      const key = `${room.code}:${room.round}:${room.status}`;
      if (sheetFor !== key) {
        sheetFor = key;
        setTimeout(() => active && room && room.status !== 'playing' && !$('round-dialog').open && $('round-dialog').showModal(), 900);
      }
    }
  }

  function closeSheet() {
    if ($('round-dialog').open) $('round-dialog').close();
  }

  function watchLobby(on) {
    if (on && !unwatchLobby && api) {
      unwatchLobby = api.watchLobby((rooms) => {
        lobbyRooms = rooms;
        if (active && !room) renderLobby({ rooms, connecting: false, onJoin: join });
      }, (err) => console.warn('Lobby watch failed:', err?.code ?? err));
    } else if (!on && unwatchLobby) {
      unwatchLobby();
      unwatchLobby = null;
    }
  }

  // ---------- actions ----------
  const playerName = () => cleanName($('battle-name').value) || cleanName(load('battleName', '')) || 'Player';

  async function run(promise) {
    try {
      const res = await promise;
      if (res?.error) {
        toast(ERRORS[res.error] ?? res.error, 2000);
        return null;
      }
      return res;
    } catch (err) {
      console.warn(err);
      toast("Couldn't reach the server. Try again?", 2200);
      return null;
    }
  }

  async function create() {
    await connect();
    try {
      const made = await api.create(playerName());
      enterRoom(made.code, made);
    } catch (err) {
      console.warn(err);
      toast("Couldn't create a room. Try again?", 2200);
    }
  }

  async function join(rawCode) {
    const c = normalizeCode(rawCode);
    if (!c) return toast('Room codes are 4 letters or numbers', 2000);
    await connect();
    const res = await run(api.join(c, playerName()));
    if (res) enterRoom(c, res.room);
    else if (code === c) exitRoom();
  }

  async function leave() {
    if (!code) return;
    const c = code;
    exitRoom();
    await run(api.leave(c));
  }

  async function startOrNext() {
    if (!room) return;
    await run(api.start(code, randomSeed(ANSWERS.length)));
  }

  function changeSetting(key, stepOrValue) {
    if (!room) return;
    run(api.settings(code, key, key in LIMITS ? { step: stepOrValue } : { value: stepOrValue }));
  }

  async function submit() {
    if (!room || room.status !== 'playing' || sending) return;
    const mine = room.turn?.uid === me();
    if (draft.length < WORD_LENGTH) return toast(ERRORS.short);
    if (!VALID.has(draft)) return toast(ERRORS.invalid);
    if (!mine) return toast('Wait for your turn', 1000);
    const err = guessError(room, { uid: me(), word: draft, answers: ANSWERS, valid: VALID });
    if (err) return toast(ERRORS[err] ?? err, 1800);
    sending = true;
    const word = draft;
    const res = await run(api.guess(code, word, room.turn.id, ANSWERS, VALID));
    sending = false;
    if (res) draft = '';
    render();
  }

  // ---------- wiring ----------
  $('battle-name').value = load('battleName', '');
  $('battle-name').addEventListener('change', (e) => save('battleName', cleanName(e.target.value)));
  $('room-name').addEventListener('change', (e) => {
    const name = cleanName(e.target.value);
    if (!name || !code) return;
    save('battleName', name);
    $('battle-name').value = name;
    run(api.join(code, name)); // rejoining updates your name
  });
  $('battle-create').addEventListener('click', create);
  $('battle-join-form').addEventListener('submit', (e) => {
    e.preventDefault();
    join($('battle-code').value);
  });
  $('room-copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(roomUrl(code));
      toast('Link copied', 1200);
    } catch {
      toast(`Room code: ${code}`, 2400);
    }
  });
  document.querySelectorAll('[data-setting] [data-step]').forEach((b) => b.addEventListener('click', () => {
    changeSetting(b.closest('[data-setting]').dataset.setting, Number(b.dataset.step));
  }));
  $('room-hard').addEventListener('change', (e) => changeSetting('hard', e.target.checked));
  $('room-public').addEventListener('change', (e) => changeSetting('public', e.target.checked));
  $('room-start').addEventListener('click', startOrNext);
  $('room-leave').addEventListener('click', leave);
  $('round-next').addEventListener('click', startOrNext);
  $('round-leave').addEventListener('click', leave);
  $('round-end').addEventListener('click', () => code && run(api.endMatch(code)));
  $('round-dialog').addEventListener('click', (e) => { if (e.target === $('round-dialog')) $('round-dialog').close(); });

  return {
    /** Battle mode came on screen. */
    async show() {
      active = true;
      render();
      await connect();
      if (!$('battle-name').value) {
        const first = (await cloud.session()).name.split(' ')[0];
        if (first) $('battle-name').value = first;
      }
      if (code && !unwatchRoom) {
        const res = await run(api.join(code, playerName()));
        if (res) enterRoom(code, res.room);
        else exitRoom();
      }
      render();
    },

    /** Another mode is on screen. You stay in your room. */
    hide() {
      active = false;
      watchLobby(false);
      closeSheet();
      showPanel(null);
    },

    /** Open a room from a ?battle=CODE link. */
    async openLink(rawCode) {
      const c = normalizeCode(rawCode);
      if (!c) return;
      await connect();
      if (code && code !== c) await leave();
      const res = await run(api.join(c, playerName()));
      if (res) enterRoom(c, res.room);
    },

    handleKey(key) {
      if (!room || room.status !== 'playing') {
        if (key === 'enter' && room && room.status !== 'lobby') $('round-dialog').showModal();
        return;
      }
      if (key === 'enter') return submit();
      if (key === 'clear') draft = '';
      else if (key === 'back') draft = draft.slice(0, -1);
      else if (draft.length < WORD_LENGTH) draft += key;
      else return;
      render();
    },

    openSheet() {
      if (room && room.status !== 'lobby' && room.status !== 'playing') $('round-dialog').showModal();
      else openStats();
    },

    get label() {
      if (!room) return '⚔ Battle';
      if (room.status === 'lobby') return `⚔ Battle · ${room.code}`;
      const r = roundOf(room);
      return `⚔ Battle · ${r[0].toUpperCase()}${r.slice(1)}`;
    },

    get inRoom() { return !!code; },
    get presentCount() { return room ? presentPlayers(room, Date.now()).length : 0; },
  };
}
