// Entry point: owns app state, wires input to game logic and UI.

import { ANSWERS, VALID } from './words.js';
import { createGame, addLetter, removeLetter, clearWord, submitGuess, keyboardStates } from './game.js';
import { dayNumber, dailyAnswerIndex, parseSeed, randomSeed } from './daily.js';
import { load, save } from './storage.js';
import { emptyStats, recordGame, effectiveStreak, infiniRecords } from './stats.js';
import { newClock, startClock, stopClock, clockMs, formatTime } from './clock.js';
import { newerSettings, encodeDaily, decodeDaily, pickDaily } from './sync.js';
import { createCloud } from './cloud.js';
import { firebaseConfig } from './firebase-config.js';
import { buildShareText } from './share.js';
import { applyIcons } from './ui/icons.js';
import { createBoard, createTile } from './ui/board.js';
import { createKeyboard } from './ui/keyboard.js';
import { createToaster } from './ui/toast.js';
import { createResultsSheet, praiseFor } from './ui/results.js';
import { createAccountUI } from './ui/account.js';
import { createBattle } from './battle/controller.js';
import { wait } from './ui/motion.js';

const $ = (id) => document.getElementById(id);
const root = document.documentElement;
const MODES = ['daily', 'random', 'infini', 'battle'];

// ---------- persisted state ----------
const settings = { mode: 'daily', hard: false, theme: 'system', contrast: false, ...load('settings', {}) };
let stats = { ...emptyStats(), ...load('stats', {}) };
const games = load('games', {}); // { daily: {day, seed, state}, random: {seed, state, recorded}, infini: {seed, state, clock} }
// A clock left running when the page closed: that stretch isn't counted.
if (games.infini?.clock) games.infini.clock.since = null;

let settingsAt = load('settingsAt', 0); // when synced settings last changed on this device
const saveSettings = () => save('settings', settings);
const saveGames = () => save('games', games);

function newSlot(mode, seed) {
  const slot = {
    seed,
    state: createGame({ answer: ANSWERS[seed], infinite: mode === 'infini', hard: settings.hard }),
    recorded: false,
  };
  if (mode === 'daily') slot.day = dayNumber();
  if (mode === 'infini') slot.clock = newClock();
  return slot;
}

function isValidSlot(slot) {
  return slot && Number.isInteger(slot.seed) && slot.state && Array.isArray(slot.state.guesses)
    && ANSWERS[slot.seed] === slot.state.answer;
}

/** The game for a mode, creating (or rolling over the daily) as needed. */
function slotFor(mode) {
  let slot = games[mode];
  if (mode === 'daily') {
    const day = dayNumber();
    if (!isValidSlot(slot) || slot.day !== day) slot = newSlot('daily', dailyAnswerIndex(day, ANSWERS.length));
  } else if (!isValidSlot(slot)) {
    slot = newSlot(mode, randomSeed(ANSWERS.length));
  }
  games[mode] = slot;
  return slot;
}

let mode = MODES.includes(settings.mode) && (settings.mode !== 'battle' || firebaseConfig) ? settings.mode : 'daily';
let busy = false; // true while a row is revealing

const current = () => slotFor(mode);
/** Solo mode whose settings apply while Battle is on screen. */
const soloMode = () => (mode === 'battle' ? 'daily' : mode);

// ---------- UI ----------
applyIcons();
const board = createBoard($('board'), $('board-area'), $('jump-pill'));
const keyboard = createKeyboard($('keyboard'), handleKey);
const toast = createToaster($('toasts'));
const results = createResultsSheet();

// ---------- sync ----------
const cloud = createCloud(firebaseConfig, {
  getLocal: () => ({ stats, settings, settingsAt }),
  onData(data) {
    if (JSON.stringify(data.stats) !== JSON.stringify(stats)) {
      stats = { ...emptyStats(), ...data.stats };
      save('stats', stats);
      if (results.isOpen) openResults();
    }
    const next = newerSettings(settings, settingsAt, data.settings, data.settingsAt);
    if (next) {
      Object.assign(settings, next);
      settingsAt = data.settingsAt;
      saveSettings();
      save('settingsAt', settingsAt);
      applyAppearance();
    }
    syncDaily(data.daily);
  },
  onSignedOut() {
    stats = emptyStats();
    save('stats', stats);
  },
  onState(state) {
    account.update(state);
    if (results.isOpen) updateSheetAccount();
  },
});

const account = createAccountUI({
  async onSignIn() {
    if (!battle.canSwitchAccount) return toast('Leave the Battle room first to sign in', 2400);
    try {
      await cloud.signInWithGoogle();
    } catch (err) {
      console.warn(err);
      toast("Couldn't sign in. Try again?");
    }
  },
  async onSignOut() {
    if (!battle.canSwitchAccount) return toast('Leave the Battle room first to sign out', 2400);
    await cloud.signOut();
    toast('Signed out. Your stats are saved to your Google account.', 2600);
  },
});

const battle = createBattle({
  cloud, keyboard, toast, announce, onHeader: renderHeader,
  getStats: () => ({ battle: stats.battle, coop: stats.coop }),
  onMatch(result) {
    const next = recordGame(stats, result);
    if (next === stats) return; // already counted
    stats = next;
    save('stats', stats);
    cloud.record(result);
  },
});
$('mode-menu').querySelector('[data-mode="battle"]').hidden = !cloud.enabled;

/** Keep whichever copy of today's daily is further along. */
let lastRemoteDaily = null;
function syncDaily(remoteData = lastRemoteDaily) {
  lastRemoteDaily = remoteData;
  if (busy) return; // mid-reveal: checked again when it finishes
  const today = dayNumber();
  const local = games.daily?.day === today ? games.daily : null;
  const remote = decodeDaily(remoteData, ANSWERS, today);
  const pick = pickDaily(local, remote);
  if (pick === 'local') cloud.pushDaily(encodeDaily(local));
  if (pick !== 'remote') return;
  games.daily = remote;
  saveGames();
  if (mode === 'daily') {
    renderAll();
    toast('Picked up your daily from another device', 2200);
  }
}

/** A synced setting changed on this device. */
function touchSettings() {
  settingsAt = Date.now();
  save('settingsAt', settingsAt);
  saveSettings();
  cloud.pushSettings(settings, settingsAt);
}

function announce(text) {
  $('announcer').textContent = text;
}

function renderHeader() {
  root.dataset.mode = mode;
  if (mode === 'battle') {
    $('mode-label').textContent = battle.label;
  } else {
    const slot = current();
    $('mode-label').textContent = {
      daily: `Daily #${slot.day}`,
      random: `Random · seed ${slot.seed}`,
      infini: `∞ Infini · seed ${slot.seed}`,
    }[mode];
  }
  document.querySelector('[data-meta="battle"]').textContent = battle.inRoom ? "you're in a room" : 'take turns with friends';
  document.querySelector('[data-meta="daily"]').textContent = `#${dayNumber()} · same for everyone`;
  document.querySelector('[data-meta="random"]').textContent = games.random ? `seed ${games.random.seed}` : 'random word';
  document.querySelector('[data-meta="infini"]').textContent = 'unlimited guesses';
  document.querySelectorAll('#mode-menu [data-mode]').forEach((b) => {
    b.setAttribute('aria-checked', String(b.dataset.mode === mode));
  });
}

// ---------- InfiniMode clock ----------
// Runs from the first letter typed until the word is solved, only while InfiniMode
// is on screen and the page is visible.
let clockTimer = null;
const clockStarted = (slot) => slot.state.guesses.length > 0 || slot.state.current.length > 0 || slot.clock?.ms > 0;
function syncClock() {
  const slot = games.infini;
  if (!slot) return;
  slot.clock ??= newClock();
  const s = slot.state;
  const run = mode === 'infini' && !document.hidden && s.status === 'playing' && clockStarted(slot);
  const now = Date.now();
  const next = run ? startClock(slot.clock, now) : stopClock(slot.clock, now);
  if (next !== slot.clock) { slot.clock = next; saveGames(); }
  renderClock();
  clearInterval(clockTimer);
  let ticks = 0;
  clockTimer = run ? setInterval(() => { renderClock(); if (++ticks % 5 === 0) bankClock(); }, 1000) : null;
}
/** Save the time so far (a running stretch is lost if the page closes without a pause). */
function bankClock() {
  const slot = games.infini;
  if (slot?.clock?.since == null) return;
  const now = Date.now();
  slot.clock = startClock(stopClock(slot.clock, now), now);
  saveGames();
}
window.addEventListener('pagehide', bankClock);
function renderClock() {
  const slot = games.infini;
  const show = mode === 'infini' && !!slot?.clock && clockStarted(slot);
  $('play-clock').hidden = !show;
  if (show) $('play-clock-time').textContent = formatTime(clockMs(slot.clock, Date.now()));
}
document.addEventListener('visibilitychange', syncClock);

function renderAll() {
  syncClock();
  if (mode === 'battle') {
    renderHeader();
    battle.show();
    return;
  }
  battle.hide();
  const { state } = current();
  renderHeader();
  board.render(state);
  keyboard.update(keyboardStates(state));
  board.scrollToBottom();
  saveGames();
}

// ---------- input ----------
const ERRORS = { short: 'Not enough letters', invalid: 'Not in word list' };

async function handleKey(key) {
  if (mode === 'battle') return battle.handleKey(key);
  if (busy) return;
  const slot = current();
  const state = slot.state;
  if (state.status !== 'playing') {
    if (key === 'enter') openResults();
    return;
  }

  if (key === 'back' || key === 'clear') {
    slot.state = key === 'clear' ? clearWord(state) : removeLetter(state);
    board.render(slot.state);
    saveGames();
    return;
  }

  if (key !== 'enter') {
    const next = addLetter(state, key);
    if (next === state) return;
    slot.state = next;
    board.render(next);
    board.pop(next.guesses.length, next.current.length - 1);
    if (mode === 'infini' && slot.clock?.since == null) syncClock(); // first letter starts the clock
    saveGames();
    return;
  }

  // Enter
  const row = state.guesses.length;
  const { state: next, error } = submitGuess(state, VALID);
  if (error) {
    board.shake(row);
    toast(ERRORS[error] ?? error);
    return;
  }

  busy = true;
  slot.state = next;
  if (mode === 'infini') syncClock(); // stops on the answer
  saveGames(); // persist before animating so a refresh can't lose the guess
  if (mode === 'daily') cloud.pushDaily(encodeDaily(slot));
  board.render(next, { skipRow: row });
  await board.reveal(row, next.guesses[row], next.evaluations[row]);
  keyboard.update(keyboardStates(next));
  announce(`${next.guesses[row].toUpperCase()}: ${next.evaluations[row].join(', ')}`);

  if (next.status === 'playing') {
    board.render(next);
    board.scrollToBottom();
    busy = false;
    syncDaily();
    return;
  }

  if (next.status === 'won') {
    toast(praiseFor(next.guesses.length, next.infinite), 1800);
    await board.win(row);
  } else {
    toast(next.answer.toUpperCase(), 2600);
    await wait(600);
  }
  finishGame(slot);
  busy = false;
  syncDaily();
  await wait(400);
  openResults();
}

function finishGame(slot) {
  if (slot.recorded) return;
  const { state } = slot;
  if (mode === 'infini') {
    if (state.status !== 'won') return;
    const result = { mode: 'infini', guesses: state.guesses.length, ms: clockMs(slot.clock, Date.now()) };
    slot.best = infiniRecords(stats.infini, result);
    stats = recordGame(stats, result);
    slot.recorded = true;
    save('stats', stats);
    cloud.record(result);
    saveGames();
    return;
  }
  stats = recordGame(stats, {
    mode: mode === 'daily' ? 'daily' : 'random',
    won: state.status === 'won',
    guesses: state.guesses.length,
    day: slot.day,
  });
  slot.recorded = true;
  save('stats', stats);
  cloud.record({ mode: mode === 'daily' ? 'daily' : 'random', won: state.status === 'won', guesses: state.guesses.length, day: slot.day });
  saveGames();
}

function openResults() {
  if (mode === 'battle') return battle.openSheet();
  results.open({ mode, state: current().state, stats, today: dayNumber(), slot: current() });
  updateSheetAccount();
}

function updateSheetAccount() {
  const bucket = stats[mode === 'daily' ? 'daily' : 'random'];
  account.updateSheet({ mode, played: bucket.played, streak: effectiveStreak(bucket, mode, dayNumber()) });
}

document.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  // Ctrl+Backspace (Alt or Cmd on a Mac) clears the word, like in a text field.
  const clear = k === 'backspace' && (e.ctrlKey || e.metaKey || e.altKey);
  if ((e.ctrlKey || e.metaKey || e.altKey) && !clear) return;
  if (document.querySelector('dialog[open]') || !$('mode-menu').hidden) return;
  if (e.target instanceof HTMLInputElement) return;

  let key = null;
  if (clear) key = 'clear';
  else if (k === 'enter') key = 'enter';
  else if (k === 'backspace') key = 'back';
  else if (/^[a-z]$/.test(k)) key = k;
  if (!key) return;

  e.preventDefault();
  keyboard.flash(key === 'clear' ? 'back' : key);
  handleKey(key);
});

// ---------- modes ----------
function setMode(next, { fresh = false, seed = null } = {}) {
  if (busy) return;
  if (fresh) games[next] = newSlot(next, seed ?? randomSeed(ANSWERS.length));
  mode = next;
  settings.mode = next;
  saveSettings();
  closeMenu();
  renderAll();
}

const chip = $('mode-chip');
const menu = $('mode-menu');

function openMenu() {
  menu.hidden = false;
  chip.setAttribute('aria-expanded', 'true');
  menu.querySelector('[aria-checked="true"]')?.focus();
}
function closeMenu() {
  menu.hidden = true;
  chip.setAttribute('aria-expanded', 'false');
}

chip.addEventListener('click', () => (menu.hidden ? openMenu() : closeMenu()));
menu.addEventListener('click', (e) => {
  const b = e.target.closest('[data-mode]');
  if (b) setMode(b.dataset.mode);
});
document.addEventListener('pointerdown', (e) => {
  if (!menu.hidden && !e.target.closest('.mode-wrap')) closeMenu();
});
document.addEventListener('keydown', (e) => {
  if (menu.hidden) return;
  if (e.key === 'Escape') { closeMenu(); chip.focus(); }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const items = [...menu.querySelectorAll('[data-mode]')];
    const i = items.indexOf(document.activeElement);
    items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length].focus();
  }
});

// ---------- results sheet buttons ----------
$('share-btn').addEventListener('click', async () => {
  const slot = current();
  const { state } = slot;
  let url = '';
  if (location.protocol.startsWith('http')) {
    url = location.origin + location.pathname;
    if (mode !== 'daily') url += `?seed=${slot.seed}${mode === 'infini' ? '&mode=infini' : ''}`;
  }
  const text = buildShareText({
    mode: mode === 'daily' ? 'daily' : 'random',
    day: slot.day,
    seed: slot.seed,
    evaluations: state.evaluations,
    won: state.status === 'won',
    hard: state.hard,
    infinite: state.infinite,
    url,
  });
  const touch = matchMedia('(pointer: coarse)').matches;
  try {
    if (touch && navigator.share) {
      await navigator.share({ text });
    } else {
      await navigator.clipboard.writeText(text);
      toast('Copied results to clipboard');
    }
  } catch (err) {
    if (err?.name !== 'AbortError') toast("Couldn't share. Try again?");
  }
});

$('play-random-btn').addEventListener('click', () => {
  results.close();
  const target = mode === 'daily' ? 'random' : mode;
  const existing = games[target];
  const reuse = mode === 'daily' && isValidSlot(existing) && existing.state.status === 'playing';
  setMode(target, { fresh: !reuse });
});

// ---------- header buttons & dialogs ----------
$('help-btn').addEventListener('click', () => $('help-dialog').showModal());
$('stats-btn').addEventListener('click', openResults);
$('settings-btn').addEventListener('click', openSettings);

document.querySelectorAll('dialog.modal').forEach((d) => {
  d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
});

// help examples
document.querySelectorAll('[data-example]').forEach((row) => {
  row.dataset.example.split(',').forEach((part) => {
    const [letter, state] = part.split(':');
    row.appendChild(createTile(letter, state || 'tbd'));
  });
});

// ---------- settings ----------
function applyAppearance() {
  root.dataset.theme = settings.theme;
  if (settings.contrast) root.dataset.contrast = 'high';
  else delete root.dataset.contrast;
  const bg = getComputedStyle(root).getPropertyValue('--bg').trim();
  document.querySelector('meta[name="theme-color"]').setAttribute('content', bg);
}

function openSettings() {
  const slot = slotFor(soloMode());
  const locked = slot.state.guesses.length > 0 && slot.state.status === 'playing';
  const hard = $('hard-toggle');
  hard.checked = locked ? slot.state.hard : settings.hard;
  hard.disabled = locked;
  $('hard-hint').textContent = locked
    ? 'Can only be changed at the start of a game.'
    : "Any letters you've found must be used in later guesses.";
  $('contrast-toggle').checked = settings.contrast;
  document.querySelectorAll('[data-theme-choice]').forEach((b) => {
    b.setAttribute('aria-checked', String(b.dataset.themeChoice === settings.theme));
  });
  $('seed-current').textContent = soloMode() === 'daily'
    ? `Pick a seed (0–${ANSWERS.length - 1}) to play a specific word in Random mode.`
    : `Current seed: ${slot.seed}. Enter another (0–${ANSWERS.length - 1}) to play a specific word.`;
  $('seed-input').placeholder = `0 – ${ANSWERS.length - 1}`;
  $('seed-input').value = '';
  $('settings-dialog').showModal();
}

$('hard-toggle').addEventListener('change', (e) => {
  settings.hard = e.target.checked;
  touchSettings();
  const slot = slotFor(soloMode());
  if (slot.state.guesses.length === 0) slot.state = { ...slot.state, hard: settings.hard };
  saveGames();
});

$('contrast-toggle').addEventListener('change', (e) => {
  settings.contrast = e.target.checked;
  touchSettings();
  applyAppearance();
});

$('theme-seg').addEventListener('click', (e) => {
  const b = e.target.closest('[data-theme-choice]');
  if (!b) return;
  settings.theme = b.dataset.themeChoice;
  touchSettings();
  applyAppearance();
  document.querySelectorAll('[data-theme-choice]').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
});

$('seed-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const seed = parseSeed($('seed-input').value, ANSWERS.length);
  if (seed === null) {
    toast(`Seed must be a number from 0 to ${ANSWERS.length - 1}`);
    return;
  }
  $('settings-dialog').close();
  setMode(soloMode() === 'daily' ? 'random' : mode, { fresh: true, seed });
});

$('new-random-btn').addEventListener('click', () => {
  $('settings-dialog').close();
  setMode(soloMode() === 'daily' ? 'random' : mode, { fresh: true });
});

// ---------- startup ----------
let battleLink = null;
function readUrlSeed() {
  const params = new URLSearchParams(location.search);
  if (params.has('battle') && cloud.enabled) {
    battleLink = params.get('battle');
    mode = 'battle';
    settings.mode = 'battle';
    saveSettings();
    return;
  }
  if (!params.has('seed')) return;
  const seed = parseSeed(params.get('seed'), ANSWERS.length);
  const target = params.get('mode') === 'infini' ? 'infini' : 'random';
  if (seed !== null) {
    const existing = games[target];
    if (!(isValidSlot(existing) && existing.seed === seed)) games[target] = newSlot(target, seed);
    mode = target;
    settings.mode = target;
    saveSettings();
  }
  history.replaceState(null, '', location.pathname);
}

// Daily rolls over at midnight while the tab is open.
function checkDayRollover() {
  if (mode === 'daily' && games.daily?.day !== dayNumber() && !busy) renderAll();
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkDayRollover(); });
setInterval(checkDayRollover, 60_000);

applyAppearance();
matchMedia('(prefers-color-scheme: light)').addEventListener('change', applyAppearance);
readUrlSeed();
renderAll();
cloud.start();
if (battleLink) battle.openLink(battleLink);

if (!load('seenHelp', false)) {
  save('seenHelp', true);
  $('help-dialog').showModal();
} else if (mode !== 'battle' && current().state.status !== 'playing') {
  // Returning to a finished game: show the results again.
  openResults();
}
