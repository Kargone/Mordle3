// Leaderboard tab (in the Statistics and Battle stats sheets) and the
// "#4 of 37 today" rank card on the results sheets.

import { BOARDS, rowText, boardValue } from '../leaderboard.js';
import { formatTime } from '../clock.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const MEDALS = ['🥇', '🥈', '🥉'];

/**
 * @param {{
 *   lb: object, today: () => number,
 *   account: () => {google: boolean, hidden: boolean, name: string},
 *   setName: (name: string) => void, setHidden: (hidden: boolean) => Promise<void>,
 *   onSignIn: () => void,
 * }} deps
 */
export function createLeaderboardUI({ lb, today, account, setName, setHidden, onSignIn }) {
  const panel = $('lb-panel');
  let board = 'today';
  let load = 0; // ignores answers from an older request

  // ---------- tabs ----------
  /** Show the Stats or Leaderboard tab of a sheet. */
  function showTab(dialog, tab, key) {
    dialog.classList.toggle('show-lb', tab === 'lb');
    dialog.querySelectorAll('.sheet-tabs [data-tab]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.tab === tab)));
    if (tab !== 'lb') return;
    if (panel.parentElement !== dialog) dialog.appendChild(panel);
    open(key ?? board);
  }
  document.querySelectorAll('.sheet-tabs').forEach((tabs) => {
    const dialog = tabs.closest('dialog');
    tabs.addEventListener('click', (e) => {
      const b = e.target.closest('[data-tab]');
      if (b) showTab(dialog, b.dataset.tab, dialog.dataset.board);
    });
    // Each time a sheet opens it starts on Stats.
    dialog.addEventListener('close', () => showTab(dialog, 'stats'));
  });

  // ---------- board ----------
  $('lb-boards').replaceChildren(...Object.entries(BOARDS).map(([key, b]) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.board = key;
    btn.textContent = b.label;
    btn.addEventListener('click', () => open(key));
    return btn;
  }));

  function row(r, me, day) {
    const [big, small] = rowText(board, r, day);
    const el = document.createElement('div');
    el.className = 'lr' + (r.uid === me ? ' me' : '');
    el.innerHTML = `<span class="rk">${r.rank <= 3 ? `<span class="md" aria-label="${r.rank}">${MEDALS[r.rank - 1]}</span>` : r.rank}</span>`
      + `<span class="nm">${esc(r.name)}${r.uid === me ? ' <small>(you)</small>' : ''}</span>`
      + `<span class="v">${big}<small>· ${small}</small></span>`;
    return el;
  }

  function note(text) {
    const p = document.createElement('p');
    p.className = 'lb-empty';
    p.textContent = text;
    return p;
  }

  async function open(key) {
    board = key;
    const day = today();
    $('lb-boards').querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.board === key)));
    $('lb-col').textContent = BOARDS[key].col;
    renderFooter();
    const list = $('lb-list');
    list.replaceChildren(note('Loading…'));
    const id = ++load;
    try {
      const { rows, me, own } = await lb.top(key, day);
      if (id !== load) return;
      const items = rows.map((r) => row(r, me, day));
      if (own && !rows.some((r) => r.uid === me)) {
        const { rank } = await lb.rank(key, own, day);
        if (id !== load) return;
        const gap = document.createElement('div');
        gap.className = 'lb-gap';
        gap.textContent = '⋮';
        items.push(gap, row({ ...own, uid: me, rank }, me, day));
      }
      list.replaceChildren(...(items.length ? items : [note(key === 'today'
        ? "Nobody's finished today's daily yet."
        : 'Nobody on this board yet.')]));
    } catch (err) {
      if (id !== load) return;
      console.warn('Leaderboard failed:', err?.code ?? err);
      list.replaceChildren(note("Couldn't load the leaderboard. Try again?"));
    }
  }

  // ---------- your name / hide me / sign in ----------
  function renderFooter() {
    const a = account();
    $('lb-you').hidden = !a.google;
    $('lb-join').hidden = a.google;
    if (document.activeElement !== $('lb-name')) $('lb-name').value = a.name;
    $('lb-hide').checked = a.hidden;
    $('lb-hidden-note').hidden = !a.hidden;
  }
  $('lb-name').addEventListener('change', (e) => {
    setName(e.target.value);
    renderFooter();
    setTimeout(() => open(board), 1600); // after the save goes through
  });
  $('lb-hide').addEventListener('change', async (e) => {
    e.target.disabled = true;
    try { await setHidden(e.target.checked); } finally { e.target.disabled = false; }
    open(board);
  });
  $('lb-signin').addEventListener('click', onSignIn);

  // ---------- rank card ----------
  let cardLoad = 0;
  /**
   * Fill a rank card after a game. `get` resolves to {key, data} (or null to hide),
   * after making sure this player's latest result is saved.
   */
  async function rankCard(el, get) {
    const id = ++cardLoad;
    el.hidden = true;
    const a = account();
    if (!a.google || a.hidden) return;
    try {
      const target = await get();
      if (!target || id !== cardLoad) return;
      const day = today();
      const { rank, total } = await lb.rank(target.key, target.data, day);
      if (id !== cardLoad) return;
      const of = { today: 'today', daily: 'on streaks', infini: 'in InfiniMode', battle: 'in Battle' }[target.key];
      el.innerHTML = `<span class="big">#${rank}</span><span><b>of ${total} ${of}</b><small>${esc(detail(target.key, target.data, day))}</small></span>`
        + '<button type="button" class="rank-all">See all</button>';
      el.querySelector('.rank-all').addEventListener('click', () => {
        const dialog = el.closest('dialog');
        dialog.dataset.board = target.key;
        showTab(dialog, 'lb', target.key);
      });
      el.hidden = false;
    } catch (err) {
      console.warn('Rank failed:', err?.code ?? err);
    }
  }

  function detail(key, data, day) {
    if (key === 'today') return data.won ? `${data.guesses} guess${data.guesses === 1 ? '' : 'es'} · ${formatTime(data.ms)}` : `Not solved · ${formatTime(data.ms)}`;
    const v = boardValue(key, data, day);
    return key === 'infini' ? `${v} word${v === 1 ? '' : 's'} solved` : `${v} match${v === 1 ? '' : 'es'} won`;
  }

  return {
    rankCard,
    /** Which board a sheet's Leaderboard tab opens on. */
    setDefault(dialog, key) { dialog.dataset.board = key; },
    /** Hide a sheet's rank card (and drop any answer still on its way). */
    hideCard(el) { cardLoad++; el.hidden = true; },
    refresh() { if (panel.closest('dialog')?.classList.contains('show-lb')) open(board); },
  };
}
