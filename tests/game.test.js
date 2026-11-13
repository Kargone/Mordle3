import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateGuess, createGame, addLetter, removeLetter, submitGuess,
  hardModeViolation, keyboardStates, MAX_GUESSES,
} from '../js/game.js';
import { VALID, ANSWERS } from '../js/words.js';

const C = 'correct', P = 'present', A = 'absent';

const type = (state, word) => [...word].reduce(addLetter, state);
const play = (state, word) => submitGuess(type(state, word), VALID);

test('evaluateGuess: all correct / all absent', () => {
  assert.deepEqual(evaluateGuess('crane', 'crane'), [C, C, C, C, C]);
  assert.deepEqual(evaluateGuess('fully', 'crane'), [A, A, A, A, A]);
});

test('evaluateGuess: duplicate letters only score as many times as the answer has them', () => {
  // HELLO has two Ls: guess LLAMA -> both Ls present, extra letters absent
  assert.deepEqual(evaluateGuess('llama', 'hello'), [P, P, A, A, A]);
  // ABBEY has two Bs: guess BOBBY -> one green B, one yellow B, third B absent
  assert.deepEqual(evaluateGuess('bobby', 'abbey'), [P, A, C, A, C]);
  // green claims the letter before yellow can
  assert.deepEqual(evaluateGuess('speed', 'abide'), [A, A, P, A, P]);
  assert.deepEqual(evaluateGuess('eerie', 'crane'), [A, A, P, A, C]);
});

test('word lists are ported intact', () => {
  assert.equal(ANSWERS.length, 2309);
  assert.equal(ANSWERS[0], 'cigar');
  assert.ok(ANSWERS.every((w) => VALID.has(w)));
  assert.ok(VALID.has('aahed'));
});

test('typing respects word length and game status', () => {
  let s = createGame({ answer: 'crane' });
  s = type(s, 'abcdefg');
  assert.equal(s.current, 'abcde');
  s = removeLetter(removeLetter(s));
  assert.equal(s.current, 'abc');
  assert.equal(addLetter(s, '1').current, 'abc');
});

test('submitGuess errors: too short, not a word', () => {
  const s = createGame({ answer: 'crane' });
  assert.equal(submitGuess(type(s, 'cra'), VALID).error, 'short');
  assert.equal(submitGuess(type(s, 'zzzzz'), VALID).error, 'invalid');
});

test('win and loss', () => {
  let s = createGame({ answer: 'crane' });
  ({ state: s } = play(s, 'slate'));
  assert.equal(s.status, 'playing');
  ({ state: s } = play(s, 'crane'));
  assert.equal(s.status, 'won');
  assert.equal(addLetter(s, 'a'), s, 'no typing after the game ends');

  let l = createGame({ answer: 'crane' });
  for (let i = 0; i < MAX_GUESSES; i++) ({ state: l } = play(l, 'slate'));
  assert.equal(l.status, 'lost');
});

test('InfiniMode never loses', () => {
  let s = createGame({ answer: 'crane', infinite: true });
  for (let i = 0; i < 20; i++) ({ state: s } = play(s, 'slate'));
  assert.equal(s.status, 'playing');
  assert.equal(s.guesses.length, 20);
  ({ state: s } = play(s, 'crane'));
  assert.equal(s.status, 'won');
});

test('hard mode: greens stay put, yellows must be reused', () => {
  let s = createGame({ answer: 'crane', hard: true });
  ({ state: s } = play(s, 'react')); // r present, e present, a correct, c present, t absent
  assert.equal(hardModeViolation(s, 'brine'), '3rd letter must be A');
  assert.equal(hardModeViolation(s, 'slate'), 'Guess must contain R');
  assert.equal(play(s, 'blame').error, 'Guess must contain R');
  assert.equal(play(s, 'crane').error, null);
});

test('hard mode: repeated hints must appear as many times', () => {
  let s = createGame({ answer: 'llama', hard: true });
  ({ state: s } = play(s, 'hello')); // two Ls revealed (yellow)
  assert.equal(hardModeViolation(s, 'lucky'), 'Guess must contain L');
  assert.equal(hardModeViolation(s, 'atoll'), null);
});

test('keyboardStates keeps the best status per letter', () => {
  let s = createGame({ answer: 'crane' });
  ({ state: s } = play(s, 'react')); // c present
  ({ state: s } = play(s, 'crate')); // c correct
  const k = keyboardStates(s);
  assert.equal(k.c, C);
  assert.equal(k.t, A);
});
