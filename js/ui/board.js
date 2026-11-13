// Board rendering. Renders from game state; animations are triggered explicitly.

import { WORD_LENGTH, MAX_GUESSES } from '../game.js';
import { reducedMotion, retrigger, sparks, wait } from './motion.js';

const FLIP_MS = 550;
const FLIP_STAGGER = 220;
const FLIP_MIDPOINT = 0.45; // matches 45% keyframe in animations.css
const WIN_STAGGER = 100;
const WIN_MS = 900;

const STATUS_LABEL = { correct: 'correct', present: 'in the word, wrong spot', absent: 'not in the word' };

function tileLabel(letter, state) {
  if (!letter) return 'empty';
  const L = letter.toUpperCase();
  return STATUS_LABEL[state] ? `${L}, ${STATUS_LABEL[state]}` : L;
}

export function setTile(tile, letter, state) {
  tile.textContent = letter || '';
  tile.dataset.state = state;
  tile.setAttribute('aria-label', tileLabel(letter, state));
}

export function createTile(letter = '', state = 'empty') {
  const tile = document.createElement('div');
  tile.className = 'tile';
  tile.setAttribute('role', 'img');
  setTile(tile, letter, state);
  return tile;
}

export function createBoard(boardEl, areaEl) {
  const rows = [];

  function ensureRows(count) {
    while (rows.length < count) {
      const row = document.createElement('div');
      row.className = 'row';
      row.setAttribute('role', 'group');
      row.setAttribute('aria-label', `Guess ${rows.length + 1}`);
      for (let i = 0; i < WORD_LENGTH; i++) row.appendChild(createTile());
      boardEl.appendChild(row);
      rows.push(row);
    }
    while (rows.length > count) rows.pop().remove();
  }

  /**
   * Sync the DOM to the game state.
   * @param {{skipRow?: number}} opts skipRow: a submitted row that is about to be
   *   revealed. It's drawn as typed (uncolored) so the flip can color it.
   */
  function render(state, { skipRow = -1 } = {}) {
    const active = state.status === 'playing' ? 1 : 0;
    const count = state.infinite ? Math.max(MAX_GUESSES, state.guesses.length + active) : MAX_GUESSES;
    ensureRows(count);
    areaEl.classList.toggle('scrolling', count > MAX_GUESSES);

    rows.forEach((row, r) => {
      const submitted = r < state.guesses.length;
      const word = submitted ? state.guesses[r] : r === state.guesses.length ? state.current : '';
      [...row.children].forEach((tile, i) => {
        const letter = word[i] || '';
        let s = letter ? 'tbd' : 'empty';
        if (submitted && r !== skipRow) s = state.evaluations[r][i];
        setTile(tile, letter, s);
      });
    });
  }

  function pop(row, col) {
    const tile = rows[row]?.children[col];
    if (tile && !reducedMotion()) retrigger(tile, 'pop');
  }

  function shake(row) {
    if (rows[row] && !reducedMotion()) retrigger(rows[row], 'shake');
  }

  async function reveal(row, word, evaluation) {
    const tiles = [...rows[row].children];
    if (reducedMotion()) {
      tiles.forEach((t, i) => setTile(t, word[i], evaluation[i]));
      return;
    }
    tiles.forEach((tile, i) => {
      setTimeout(() => {
        retrigger(tile, 'flip');
        setTimeout(() => setTile(tile, word[i], evaluation[i]), FLIP_MS * FLIP_MIDPOINT);
      }, i * FLIP_STAGGER);
    });
    await wait((WORD_LENGTH - 1) * FLIP_STAGGER + FLIP_MS);
  }

  async function win(row) {
    if (reducedMotion()) return;
    const css = getComputedStyle(document.documentElement);
    const colors = [css.getPropertyValue('--correct-fg'), css.getPropertyValue('--present-fg')];
    [...rows[row].children].forEach((tile, i) => {
      setTimeout(() => {
        retrigger(tile, 'win');
        setTimeout(() => sparks(tile, colors), 220);
      }, i * WIN_STAGGER);
    });
    await wait((WORD_LENGTH - 1) * WIN_STAGGER + WIN_MS);
  }

  function scrollToRow(row) {
    if (!areaEl.classList.contains('scrolling')) return;
    rows[Math.min(row, rows.length - 1)]?.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
  }

  return { render, pop, shake, reveal, win, scrollToRow };
}
