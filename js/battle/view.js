// Battle mode DOM: lobby browser, room, race screen and round-over sheet.
// Pure rendering from (room, me, ...) — no Firebase, no timers.

import { WORD_LENGTH } from '../game.js';
import { createTile, setTile } from '../ui/board.js';
import { reducedMotion, retrigger } from '../ui/motion.js';
import { isPresent, isActive, presentPlayers, standings, matchWinners, atLimit, isUnlimited, LIMITS } from './logic.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const initial = (name) => (name || '?').trim().charAt(0).toUpperCase() || '?';
/** "3 rounds", "1 round", "∞ rounds". */
export const roundsText = (room) => (isUnlimited(room) ? '∞ rounds'
  : `${room.settings.rounds} round${room.settings.rounds === 1 ? '' : 's'}`);
/** "round 2 of 3", or "round 2" when unlimited. */
export const roundOf = (room) => `round ${room.round}${isUnlimited(room) ? '' : ` of ${room.settings.rounds}`}`;
const displayName = (room, uid, me) => (uid === me ? 'You' : room.players[uid]?.name ?? 'Player');

function avatar(color, text, cls = 'av') {
  const el = document.createElement('div');
  el.className = cls;
  el.style.background = color;
  el.textContent = text;
  el.setAttribute('aria-hidden', 'true');
  return el;
}

// ---------- which panel ----------
export function showPanel(name) {
  // name: 'lobby' | 'room' | 'race' | null (solo game)
  $('board-area').hidden = name !== null;
  $('battle-area').hidden = name !== 'race';
  $('battle-lobby').hidden = name !== 'lobby';
  $('battle-room').hidden = name !== 'room';
  $('keyboard').hidden = name === 'lobby' || name === 'room';
  if (name !== null) $('jump-pill').hidden = true;
}

// ---------- lobby browser ----------
export function renderLobby({ rooms, connecting, onJoin }) {
  const list = $('battle-rooms');
  $('battle-create').disabled = connecting;
  if (connecting) {
    list.innerHTML = '<p class="empty">Connecting…</p>';
    return;
  }
  if (!rooms.length) {
    list.innerHTML = '<p class="empty">No open rooms right now. Create one and share the link!</p>';
    return;
  }
  list.replaceChildren(...rooms.map((room) => {
    const host = room.players[room.hostUid]?.name ?? 'Someone';
    const row = document.createElement('div');
    row.className = 'room-row';
    row.innerHTML = `<b>${esc(host)}'s room${room.settings.hard ? '<span class="badge">HARD</span>' : ''}</b>
      <span class="meta">${room.order.length}/${room.settings.maxPlayers} players · ${room.settings.turnSecs}s turns · ${roundsText(room)}</span>`;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-secondary join';
    btn.textContent = 'Join';
    btn.setAttribute('aria-label', `Join ${host}'s room`);
    btn.addEventListener('click', () => onJoin(room.code));
    row.appendChild(btn);
    return row;
  }));
}

// ---------- room (waiting to start) ----------
export function renderRoom(room, me, now) {
  const host = room.players[room.hostUid];
  const isHost = room.hostUid === me;
  $('room-title').textContent = room.hostUid === me ? 'Your room' : `${host?.name ?? 'Host'}'s room`;
  $('room-code').textContent = room.code;
  $('room-url').textContent = roomUrl(room.code).replace(/^https?:\/\//, '');

  const slots = [];
  for (const uid of room.order) {
    const p = room.players[uid];
    const chip = document.createElement('div');
    chip.className = 'pchip' + (isActive(room, uid, now) ? '' : ' away');
    chip.appendChild(avatar(p.color, initial(p.name)));
    if (uid === room.hostUid) chip.insertAdjacentHTML('beforeend', '<span class="crown" aria-label="host">👑</span>');
    chip.insertAdjacentHTML('beforeend', `<span class="nm">${esc(uid === me ? `${p.name} (you)` : p.name)}</span>`);
    slots.push(chip);
  }
  for (let i = room.order.length; i < room.settings.maxPlayers; i++) {
    const chip = document.createElement('div');
    chip.className = 'pchip empty';
    chip.innerHTML = '<div class="av" aria-hidden="true"></div><span class="nm">open</span>';
    slots.push(chip);
  }
  $('room-players').replaceChildren(...slots);

  for (const key of Object.keys(LIMITS)) {
    const row = document.querySelector(`[data-setting="${key}"]`);
    const v = room.settings[key];
    row.querySelector('.val').textContent = key === 'turnSecs' ? `${v}s` : key === 'rounds' && isUnlimited(room) ? '∞' : v;
    row.querySelector('[data-step="-1"]').disabled = !isHost || atLimit(key, v, -1) || (key === 'maxPlayers' && v <= room.order.length);
    row.querySelector('[data-step="1"]').disabled = !isHost || atLimit(key, v, 1);
  }
  $('room-hard').checked = room.settings.hard;
  $('room-public').checked = room.public;
  $('room-hard').disabled = !isHost;
  $('room-public').disabled = !isHost;

  const nameInput = $('room-name');
  if (document.activeElement !== nameInput) nameInput.value = room.players[me]?.name ?? '';

  const here = presentPlayers(room, now).length;
  const start = $('room-start');
  start.hidden = !isHost;
  start.disabled = here < 2;
  start.textContent = `Start · ${here} player${here === 1 ? '' : 's'}`;
  $('room-wait').textContent = isHost
    ? (here < 2 ? 'Waiting for at least one more player. Share the link!' : '')
    : `Waiting for ${host?.name ?? 'the host'} to start`;
}

export const roomUrl = (code) => `${location.origin}${location.pathname}?battle=${code}`;

// ---------- race ----------
export function createRaceView() {
  let renderedKey = '';
  let rendered = 0;

  /** Turn strip: players in turn order starting with whoever's up. */
  function renderStrip(room, me, now) {
    const order = room.order;
    const startAt = room.turn ? Math.max(0, order.indexOf(room.turn.uid)) : 0;
    const rotated = order.map((_, i) => order[(startAt + i) % order.length]);
    const nextUid = room.turn ? rotated.find((u, i) => i > 0 && isActive(room, u, now)) : null;
    $('turn-strip').replaceChildren(...rotated.map((uid) => {
      const p = room.players[uid];
      const active = room.turn?.uid === uid;
      const chip = document.createElement('div');
      chip.className = 'pchip' + (active ? ' active' : '') + (isActive(room, uid, now) ? '' : ' away');
      chip.style.setProperty('--c', p.color);
      chip.appendChild(avatar(p.color, initial(p.name)));
      const label = displayName(room, uid, me) + (uid === nextUid && uid === me ? ' · next' : '');
      chip.insertAdjacentHTML('beforeend', `<span class="nm">${esc(label)}</span><span class="sc">${p.score} won</span>`);
      if (active) chip.insertAdjacentHTML('beforeend', '<span class="secs" id="turn-secs"></span>');
      return chip;
    }));
  }

  function row(color, letter, tiles, cls = '') {
    const r = document.createElement('div');
    r.className = 'brow' + (cls ? ' ' + cls : '');
    r.appendChild(avatar(color, letter, 'who'));
    tiles.forEach((t) => r.appendChild(t));
    const tag = document.createElement('span');
    tag.className = 'tag';
    r.appendChild(tag);
    return r;
  }

  /**
   * @param {object} room
   * @param {{me: string, now: number, draft: string, evaluations: string[][]}} ctx
   */
  function render(room, { me, now, draft, evaluations }) {
    renderStrip(room, me, now);
    const key = `${room.code}:${room.round}`;
    const fresh = key !== renderedKey;
    if (fresh) { renderedKey = key; rendered = 0; }

    const boardEl = $('battle-board');
    const rows = room.guesses.map((g, i) => {
      const p = room.players[g.uid] ?? { color: 'var(--text-faint)', name: '?' };
      const isNew = i >= rendered && !fresh;
      const tiles = [...g.word].map((l, j) => createTile(l, isNew ? 'tbd' : evaluations[i][j]));
      const r = row(p.color, initial(p.name), tiles);
      r.setAttribute('aria-label', `${displayName(room, g.uid, me)}: ${g.word.toUpperCase()}`);
      if (isNew) reveal(tiles, g.word, evaluations[i]);
      return r;
    });
    rendered = room.guesses.length;

    if (room.status === 'playing' && room.turn) {
      const mine = room.turn.uid === me;
      const p = room.players[room.turn.uid];
      if (mine) {
        rows.push(draftRow(room.players[me], draft, 'mine', 'your turn'));
      } else {
        const waiting = row(p.color, initial(p.name), Array.from({ length: WORD_LENGTH }, () => createTile()), 'pending');
        waiting.querySelector('.tag').textContent = '…';
        rows.push(waiting);
        if (room.players[me]) rows.push(draftRow(room.players[me], draft, 'draft', 'next'));
      }
    }
    boardEl.replaceChildren(...rows);
    const scroll = $('battle-scroll');
    scroll.scrollTop = scroll.scrollHeight;
  }

  function draftRow(p, draft, cls, tag) {
    const tiles = Array.from({ length: WORD_LENGTH }, (_, i) => createTile(draft[i] || '', draft[i] ? 'tbd' : 'empty'));
    const r = row(p.color, initial(p.name), tiles, cls);
    r.querySelector('.tag').textContent = tag;
    r.setAttribute('aria-label', `Your next guess: ${draft.toUpperCase() || 'empty'}`);
    return r;
  }

  function reveal(tiles, word, evaluation) {
    if (reducedMotion()) {
      tiles.forEach((t, i) => setTile(t, word[i], evaluation[i]));
      return;
    }
    tiles.forEach((t, i) => setTimeout(() => {
      retrigger(t, 'flip');
      setTimeout(() => setTile(t, word[i], evaluation[i]), 250);
    }, i * 160));
  }

  /** Called ~10x a second while a turn is running. */
  function tick(fraction, secsLeft) {
    const active = document.querySelector('#turn-strip .pchip.active');
    if (active) active.style.setProperty('--pct', String(Math.max(0, fraction) * 100));
    const secs = $('turn-secs');
    if (secs) secs.textContent = Math.max(0, Math.ceil(secsLeft));
  }

  return { render, tick };
}

// ---------- round over ----------
export function renderRoundSheet(room, me, now, answer) {
  const over = room.status === 'matchOver';
  const winners = matchWinners(room);
  const w = room.winner ? room.players[room.winner] : null;
  const av = $('round-av');
  if (over && winners.length) {
    const top = room.players[winners[0]];
    av.style.background = winners.length > 1 ? 'var(--raised)' : top.color;
    av.textContent = winners.length > 1 ? '🤝' : initial(top.name);
    $('round-title').textContent = winners.length > 1 ? "It's a tie!"
      : winners[0] === me ? 'You win the match!' : `${top.name} wins the match!`;
  } else {
    av.style.background = w ? w.color : 'var(--raised)';
    av.textContent = w ? initial(w.name) : '?';
    $('round-title').textContent = !w ? 'Round over' : room.winner === me ? 'You got it!' : `${w.name} got it!`;
  }
  $('round-answer').replaceChildren(...[...answer].map((l) => createTile(l, 'correct')));
  const winGuess = room.guesses.length;
  $('round-meta').textContent = `${w ? `on guess ${winGuess} · ` : ''}${roundOf(room)}${over ? ' · final score' : ''}`;

  $('round-table').replaceChildren(...standings(room).map((p) => {
    const r = document.createElement('div');
    r.className = 'score-row' + (p.uid === me ? ' me' : '');
    r.innerHTML = `<i style="background:${p.color}"></i><span>${esc(p.uid === me ? `${p.name} (you)` : p.name)}</span><b>${p.score}</b>`;
    return r;
  }));

  const isHost = room.hostUid === me;
  const here = presentPlayers(room, now).length;
  const next = $('round-next');
  next.hidden = !isHost;
  next.textContent = over ? 'Play again' : 'Next round';
  next.disabled = here < 2;
  // Unlimited matches end when the host says so.
  $('round-end').hidden = !isHost || over || !isUnlimited(room);
  const hostName = room.players[room.hostUid]?.name ?? 'the host';
  $('round-wait').textContent = isHost
    ? (here < 2 ? 'Everyone else has left.' : '')
    : `Waiting for ${hostName} to ${over ? 'start a new match' : 'start the next round'}`;
}

const DAY = 24 * 60 * 60 * 1000;

/** "today", "yesterday", "3 days ago", "last week", "5 weeks ago", "2 months ago". */
export function playedAgo(at, now) {
  const days = Math.floor((now - at) / DAY);
  if (days < 1) return 'today';
  if (days < 2) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 14) return 'last week';
  if (days < 60) return `${Math.floor(days / 7)} weeks ago`;
  return `${Math.floor(days / 30)} months ago`;
}

/** Battle stats sheet: totals and the record against each rival. */
export function renderBattleStats(battle, rivals, now) {
  $('bst-played').textContent = battle.played;
  $('bst-win').textContent = battle.played ? Math.round((battle.wins / battle.played) * 100) : 0;
  $('bst-rounds').textContent = battle.roundsWon;
  $('bst-best').textContent = battle.maxStreak;
  $('bst-empty').hidden = rivals.length > 0;
  $('bst-rivals').replaceChildren(...rivals.map((r) => {
    const row = document.createElement('div');
    row.className = 'rival';
    row.innerHTML = `<div class="mini" aria-hidden="true">${esc(initial(r.name))}</div>`
      + `<span>${esc(r.name)}<small>played ${playedAgo(r.last, now)}</small></span>`
      + `<b class="rec" aria-label="${r.wins} wins, ${r.losses} losses"><span class="w">${r.wins}</span> – ${r.losses}</b>`;
    row.firstChild.style.background = /^#[0-9a-f]{3,8}$/i.test(r.color ?? '') ? r.color : 'var(--raised)';
    return row;
  }));
}
