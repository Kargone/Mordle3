// Build the shareable results text. Emoji are set to match the chosen palette.

import { MAX_GUESSES } from './game.js';
import { formatTime } from './clock.js';

export const SHARE_EMOJI = { correct: '🟦', present: '🟧', absent: '⬛' };

/**
 * @param {{
 *   mode: 'daily' | 'random', day?: number, seed?: number,
 *   evaluations: string[][], won: boolean, hard?: boolean, infinite?: boolean,
 *   url?: string, ms?: number
 * }} game  ms = play time (InfiniMode), shown as ⏱ 2:14
 */
export function buildShareText(game) {
  const { mode, day, seed, evaluations, won, hard, infinite, url, ms } = game;
  const label = mode === 'daily' ? `Mordle #${day}` : `Mordle seed ${seed}`;
  const tries = won ? evaluations.length : 'X';
  const score = infinite ? `${tries} ∞` : `${tries}/${MAX_GUESSES}`;
  const time = infinite && ms > 0 ? ` ⏱ ${formatTime(ms)}` : '';
  const header = `${label} ${score}${hard ? '*' : ''}${time}`;
  const grid = evaluations
    .map((row) => row.map((s) => SHARE_EMOJI[s]).join(''))
    .join('\n');
  return [header, '', grid, url ? `\n${url}` : ''].join('\n').trimEnd();
}
