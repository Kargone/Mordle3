// On-screen keyboard: pill keys in a tray.

import { ICONS } from './icons.js';

const ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];

/**
 * @param {HTMLElement} el
 * @param {(key: string) => void} onKey  receives 'a'..'z', 'enter', 'back', or 'clear' (hold ⌫)
 */
export function createKeyboard(el, onKey) {
  const keys = {};

  const makeKey = (key, label, wide = false, aria = null) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = wide ? 'key wide' : 'key';
    b.dataset.key = key;
    b.innerHTML = label;
    if (aria) b.setAttribute('aria-label', aria);
    keys[key] = b;
    return b;
  };

  ROWS.forEach((letters, i) => {
    const row = document.createElement('div');
    row.className = i === 1 ? 'kb-row mid' : 'kb-row';
    if (i === 2) row.appendChild(makeKey('enter', ICONS.enter, true, 'Enter'));
    for (const l of letters) row.appendChild(makeKey(l, l));
    if (i === 2) row.appendChild(makeKey('back', ICONS.back, true, 'Backspace'));
    el.appendChild(row);
  });

  // Holding backspace clears the whole word.
  const HOLD_MS = 450;
  let holdTimer = null;
  let held = false;
  const stopHold = () => { clearTimeout(holdTimer); holdTimer = null; };

  // Keep focus off the keys so a physical Enter never "clicks" the last key tapped.
  el.addEventListener('pointerdown', (e) => {
    const key = e.target.closest('.key');
    if (!key) return;
    e.preventDefault();
    held = false;
    stopHold();
    if (key.dataset.key === 'back') {
      holdTimer = setTimeout(() => { held = true; holdTimer = null; onKey('clear'); }, HOLD_MS);
    }
  });
  for (const type of ['pointerup', 'pointerleave', 'pointercancel']) el.addEventListener(type, stopHold);
  el.addEventListener('contextmenu', (e) => { if (e.target.closest('.key')) e.preventDefault(); });
  el.addEventListener('click', (e) => {
    const key = e.target.closest('.key');
    if (!key) return;
    if (held) { held = false; return; } // the hold already cleared the word
    onKey(key.dataset.key);
  });

  return {
    /** @param {Record<string, string>} states letter -> status */
    update(states) {
      for (const [k, b] of Object.entries(keys)) {
        if (k.length !== 1) continue;
        if (states[k]) b.dataset.state = states[k];
        else delete b.dataset.state;
        b.setAttribute('aria-label', states[k] ? `${k}, ${states[k]}` : k);
      }
    },
    /** Brief pressed look when the physical key is used. */
    flash(key) {
      const b = keys[key];
      if (!b) return;
      b.classList.add('pressed');
      setTimeout(() => b.classList.remove('pressed'), 90);
    },
  };
}
