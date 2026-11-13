// Results / statistics bottom sheet.

import { MAX_GUESSES } from '../game.js';
import { effectiveStreak, winPercent } from '../stats.js';
import { msUntilNextDay } from '../daily.js';
import { createTile } from './board.js';

const PRAISE = ['Unreal!', 'Brilliant!', 'Sharp!', 'Nice one!', 'Solid!', 'Clutch!'];

export function praiseFor(guessCount, infinite) {
  if (infinite && guessCount > MAX_GUESSES) return `Got it in ${guessCount}!`;
  return PRAISE[guessCount - 1] ?? 'Got it!';
}

const $ = (id) => document.getElementById(id);

function formatCountdown(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

export function createResultsSheet() {
  const dialog = $('stats-dialog');
  let timer = null;

  const tick = () => { $('countdown').textContent = formatCountdown(msUntilNextDay()); };

  dialog.addEventListener('close', () => clearInterval(timer));
  // Tap on the backdrop closes the sheet.
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });

  /**
   * @param {{mode: string, state: object, stats: object, today: number}} ctx
   */
  function open({ mode, state, stats, today }) {
    const over = state.status !== 'playing';
    const won = state.status === 'won';
    const infinite = mode === 'infini';

    // hero
    const hero = $('result-hero');
    hero.classList.toggle('no-result', !over);
    const modeName = { daily: 'Daily', random: 'Random', infini: 'InfiniMode' }[mode];
    $('stats-title').textContent = !over
      ? `Statistics · ${modeName}`
      : won ? `Solved in ${state.guesses.length}!` : 'So close! The word was';
    const tiles = $('answer-tiles');
    tiles.replaceChildren(...[...state.answer].map((l) => createTile(l, won ? 'correct' : 'present')));

    // stats
    $('stats-body').hidden = infinite;
    $('infini-note').hidden = !infinite;
    if (!infinite) {
      const bucket = stats[mode];
      $('st-played').textContent = bucket.played;
      $('st-win').textContent = winPercent(bucket);
      $('st-streak').textContent = effectiveStreak(bucket, mode, today);
      $('st-best').textContent = bucket.maxStreak;
      $('dist-label').textContent = `Guess distribution · ${modeName}`;

      const max = Math.max(1, ...bucket.distribution);
      const mine = over && won ? state.guesses.length - 1 : -1;
      const dist = $('dist');
      dist.replaceChildren(...bucket.distribution.map((n, i) => {
        const row = document.createElement('div');
        row.className = 'dist-row';
        row.innerHTML = `<span>${i + 1}</span><div class="dist-bar${i === mine ? ' me' : ''}">${n}</div>`;
        const bar = row.lastElementChild;
        requestAnimationFrame(() => bar.style.setProperty('--w', `${Math.max(7, (n / max) * 100)}%`));
        return row;
      }));
    }

    $('share-btn').hidden = !over;
    $('play-random-btn').textContent = mode === 'daily' ? 'Play Random' : 'New word';
    $('play-random-btn').classList.toggle('btn-block', !over);
    document.querySelector('.sheet-actions').style.gridTemplateColumns = over ? '' : '1fr';

    tick();
    clearInterval(timer);
    timer = setInterval(tick, 1000);
    if (!dialog.open) dialog.showModal();
  }

  return { open, close: () => dialog.open && dialog.close(), get isOpen() { return dialog.open; } };
}
