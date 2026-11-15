// Pure game logic. No DOM access — every function returns new state.

export const WORD_LENGTH = 5;
export const MAX_GUESSES = 6;

/** @typedef {'correct' | 'present' | 'absent'} LetterStatus */

/**
 * Score a guess against the answer. Two passes so duplicate letters are
 * handled correctly: exact matches claim their letter first, then the
 * remaining letters are matched left-to-right for "present".
 * @returns {LetterStatus[]}
 */
export function evaluateGuess(guess, answer) {
  const result = Array(WORD_LENGTH).fill('absent');
  const remaining = {};

  for (let i = 0; i < WORD_LENGTH; i++) {
    if (guess[i] === answer[i]) {
      result[i] = 'correct';
    } else {
      remaining[answer[i]] = (remaining[answer[i]] || 0) + 1;
    }
  }
  for (let i = 0; i < WORD_LENGTH; i++) {
    if (result[i] === 'correct') continue;
    const letter = guess[i];
    if (remaining[letter] > 0) {
      result[i] = 'present';
      remaining[letter]--;
    }
  }
  return result;
}

/**
 * @param {{answer: string, infinite?: boolean, hard?: boolean}} opts
 */
export function createGame({ answer, infinite = false, hard = false }) {
  return {
    answer,
    infinite,
    hard,
    guesses: [],
    evaluations: [],
    current: '',
    status: 'playing', // 'playing' | 'won' | 'lost'
  };
}

export function addLetter(state, letter) {
  if (state.status !== 'playing' || state.current.length >= WORD_LENGTH) return state;
  if (!/^[a-z]$/.test(letter)) return state;
  return { ...state, current: state.current + letter };
}

export function removeLetter(state) {
  if (state.status !== 'playing' || state.current.length === 0) return state;
  return { ...state, current: state.current.slice(0, -1) };
}

/** Clear the letters typed in the current row. */
export function clearWord(state) {
  if (state.status !== 'playing' || state.current.length === 0) return state;
  return { ...state, current: '' };
}

const ORDINALS = ['1st', '2nd', '3rd', '4th', '5th'];

/**
 * Hard mode: every revealed hint must be used. Greens stay in place,
 * yellows (and repeated hints) must appear at least as often as revealed.
 * @returns {string | null} human-readable reason, or null if the guess is allowed
 */
export function hardModeViolation(state, guess) {
  for (let g = 0; g < state.guesses.length; g++) {
    const prev = state.guesses[g];
    const evals = state.evaluations[g];
    const needed = {};
    for (let i = 0; i < WORD_LENGTH; i++) {
      if (evals[i] === 'correct' && guess[i] !== prev[i]) {
        return `${ORDINALS[i]} letter must be ${prev[i].toUpperCase()}`;
      }
      if (evals[i] !== 'absent') needed[prev[i]] = (needed[prev[i]] || 0) + 1;
    }
    for (const [letter, count] of Object.entries(needed)) {
      const have = [...guess].filter((c) => c === letter).length;
      if (have < count) return `Guess must contain ${letter.toUpperCase()}`;
    }
  }
  return null;
}

/**
 * Submit the current row.
 * @param {Set<string>} validWords
 * @returns {{state: object, error: null | 'short' | 'invalid' | string}}
 */
export function submitGuess(state, validWords) {
  if (state.status !== 'playing') return { state, error: null };
  const guess = state.current;
  if (guess.length < WORD_LENGTH) return { state, error: 'short' };
  if (!validWords.has(guess)) return { state, error: 'invalid' };
  if (state.hard) {
    const reason = hardModeViolation(state, guess);
    if (reason) return { state, error: reason };
  }

  const evaluation = evaluateGuess(guess, state.answer);
  const guesses = [...state.guesses, guess];
  let status = 'playing';
  if (guess === state.answer) status = 'won';
  else if (!state.infinite && guesses.length >= MAX_GUESSES) status = 'lost';

  return {
    state: {
      ...state,
      guesses,
      evaluations: [...state.evaluations, evaluation],
      current: '',
      status,
    },
    error: null,
  };
}

const RANK = { absent: 1, present: 2, correct: 3 };

/** Best-known status for each letter, for coloring the keyboard. */
export function keyboardStates(state) {
  const out = {};
  state.guesses.forEach((guess, g) => {
    [...guess].forEach((letter, i) => {
      const s = state.evaluations[g][i];
      if (!out[letter] || RANK[s] > RANK[out[letter]]) out[letter] = s;
    });
  });
  return out;
}
