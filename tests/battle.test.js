import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ANSWERS, VALID } from '../js/words.js';
import {
  createRoom, joinRoom, leaveRoom, claimHost, updateSettings, startRound, applyGuess, skipTurn,
  nextTurnUid, guessError, sharedState, standings, matchWinners, listable, makeCode, normalizeCode,
  cleanSettings, COLORS, AWAY_MS,
} from '../js/battle/logic.js';

const SEED = ANSWERS.indexOf('lemon');
const ctx = { answers: ANSWERS, valid: VALID };
const T = 1_000_000;

function roomOf(names, now = T) {
  let room = createRoom({ code: 'KQ7P', uid: names[0], name: names[0], now });
  for (const n of names.slice(1)) room = joinRoom(room, { uid: n, name: n, now }).room;
  return room;
}
const guess = (room, uid, word, now = T) => applyGuess(room, { uid, word, turnId: room.turn.id, ...ctx, now });

test('room codes and names', () => {
  assert.match(makeCode(), /^[A-Z2-9]{4}$/);
  assert.equal(normalizeCode(' kq7p '), 'KQ7P');
  assert.equal(normalizeCode('KQ0P'), null, 'no look-alike characters');
  assert.equal(normalizeCode('ABC'), null);
  assert.deepEqual(cleanSettings({ turnSecs: 2, rounds: 99, maxPlayers: '4', hard: 1 }), { turnSecs: 5, rounds: 10, maxPlayers: 4, hard: true });
});

test('joining: colors, max players, already started, rejoin', () => {
  let room = roomOf(['mia', 'you', 'kai']);
  assert.deepEqual(room.order, ['mia', 'you', 'kai']);
  assert.deepEqual(room.order.map((u) => room.players[u].color), COLORS.slice(0, 3));
  room = updateSettings(room, { uid: 'mia', patch: { maxPlayers: 3 }, now: T });
  assert.equal(joinRoom(room, { uid: 'ben', name: 'Ben', now: T }).error, 'full');
  assert.equal(updateSettings(room, { uid: 'you', patch: { maxPlayers: 8 }, now: T }), null, 'only the host');
  assert.equal(updateSettings(room, { uid: 'mia', patch: { maxPlayers: 2 }, now: T }).settings.maxPlayers, 3, "can't go below players in the room");

  room = startRound(room, { uid: 'mia', seed: SEED, now: T }).room;
  assert.equal(joinRoom(room, { uid: 'ben', name: 'Ben', now: T }).error, 'started');
  const back = joinRoom(room, { uid: 'kai', name: 'Kai2', now: T + 5 }).room;
  assert.equal(back.players.kai.name, 'Kai2');
  assert.equal(back.players.kai.seen, T + 5);
});

test('start needs the host and two players; scores reset; first turn rotates', () => {
  const solo = roomOf(['mia']);
  assert.equal(startRound(solo, { uid: 'mia', seed: SEED, now: T }).error, 'players');
  let room = roomOf(['mia', 'you', 'kai']);
  assert.equal(startRound(room, { uid: 'you', seed: SEED, now: T }).error, 'host');
  room = startRound(room, { uid: 'mia', seed: SEED, now: T }).room;
  assert.equal(room.status, 'playing');
  assert.equal(room.round, 1);
  assert.equal(room.turn.uid, 'mia');
  assert.equal(startRound(room, { uid: 'mia', seed: SEED, now: T }).error, 'state', "can't restart mid-round");

  room = guess(room, 'mia', 'crane').room;
  room = guess(room, 'you', 'lemon').room;
  assert.equal(room.status, 'roundOver');
  room = startRound(room, { uid: 'mia', seed: SEED, now: T }).room;
  assert.equal(room.round, 2);
  assert.equal(room.turn.uid, 'you', 'round 2 starts with the second player');
  assert.deepEqual(room.guesses, []);
  assert.equal(room.players.you.score, 1, 'scores carry between rounds');
});

test('turns go around in order; only the current player can guess', () => {
  let room = startRound(roomOf(['mia', 'you', 'kai']), { uid: 'mia', seed: SEED, now: T }).room;
  assert.equal(guess(room, 'you', 'crane').error, 'turn');
  room = guess(room, 'mia', 'crane').room;
  assert.equal(room.turn.uid, 'you');
  room = guess(room, 'you', 'pious').room;
  room = guess(room, 'kai', 'thumb').room;
  assert.equal(room.turn.uid, 'mia', 'wraps around');
  assert.deepEqual(room.guesses.map((g) => g.uid), ['mia', 'you', 'kai']);
  assert.equal(guess(room, 'mia', 'cra').error, 'short');
  assert.equal(guess(room, 'mia', 'zzzzz').error, 'invalid');
  const stale = applyGuess(room, { uid: 'mia', word: 'motel', turnId: room.turn.id - 1, ...ctx, now: T });
  assert.equal(stale.error, 'turn', 'a guess for an old turn is rejected');
});

test('timeout skips to the next player, once', () => {
  let room = startRound(roomOf(['mia', 'you']), { uid: 'mia', seed: SEED, now: T }).room;
  const id = room.turn.id;
  room = skipTurn(room, { turnId: id, now: T });
  assert.equal(room.turn.uid, 'you');
  assert.equal(skipTurn(room, { turnId: id, now: T }), null, 'a second skip for the same turn does nothing');
});

test('players who stop sending heartbeats are skipped', () => {
  let room = roomOf(['mia', 'you', 'kai']);
  room = { ...room, players: { ...room.players, you: { ...room.players.you, seen: T - AWAY_MS - 1 } } };
  assert.equal(nextTurnUid(room, 'mia', T), 'kai');
  room = startRound(room, { uid: 'mia', seed: SEED, now: T }).room;
  room = guess(room, 'mia', 'crane').room;
  assert.equal(room.turn.uid, 'kai');
});

test('winning: score, round over, match over, standings', () => {
  let room = roomOf(['mia', 'you']);
  room = updateSettings(room, { uid: 'mia', patch: { rounds: 2 }, now: T });
  room = startRound(room, { uid: 'mia', seed: SEED, now: T }).room;
  room = guess(room, 'mia', 'lemon').room;
  assert.equal(room.status, 'roundOver');
  assert.equal(room.winner, 'mia');
  assert.equal(room.turn, null);
  room = startRound(room, { uid: 'mia', seed: SEED, now: T }).room;
  room = guess(room, 'you', 'lemon').room;
  assert.equal(room.status, 'matchOver');
  assert.deepEqual(matchWinners(room), ['mia', 'you'], 'a tie');
  assert.deepEqual(standings(room).map((p) => p.score), [1, 1]);
  room = startRound(room, { uid: 'mia', seed: SEED, now: T }).room;
  assert.equal(room.round, 1, 'play again starts a new match');
  assert.equal(room.players.mia.score, 0);
});

test('hard mode uses everyone\'s hints', () => {
  let room = roomOf(['mia', 'you']);
  room = updateSettings(room, { uid: 'mia', patch: { hard: true }, now: T });
  room = startRound(room, { uid: 'mia', seed: SEED, now: T }).room;
  room = guess(room, 'mia', 'motel').room; // L, E, M, O all revealed
  assert.match(guessError(room, { uid: 'you', word: 'crane', ...ctx }), /must/);
  assert.equal(guessError(room, { uid: 'you', word: 'melon', ...ctx }), null);
  assert.equal(sharedState(room, ANSWERS).evaluations.length, 1);
});

test('leaving: host moves on, turn moves on, last one out deletes the room', () => {
  let room = startRound(roomOf(['mia', 'you', 'kai']), { uid: 'mia', seed: SEED, now: T }).room;
  room = leaveRoom(room, { uid: 'mia', now: T }).room;
  assert.equal(room.hostUid, 'you');
  assert.equal(room.turn.uid, 'you');
  assert.deepEqual(room.order, ['you', 'kai']);
  room = leaveRoom(room, { uid: 'kai', now: T }).room;
  assert.equal(room.status, 'roundOver', 'alone mid-round: the round ends');
  assert.equal(leaveRoom(room, { uid: 'you', now: T }).room, null);
});

test('a quiet host is replaced by the first present player', () => {
  let room = roomOf(['mia', 'you', 'kai']);
  room = { ...room, players: { ...room.players, mia: { ...room.players.mia, seen: T - AWAY_MS - 1 } } };
  assert.equal(claimHost(room, { uid: 'kai', now: T }), null, 'kai is not first in line');
  assert.equal(claimHost(room, { uid: 'you', now: T }).hostUid, 'you');
});

test('lobby browser lists open public rooms only', () => {
  const room = roomOf(['mia', 'you']);
  assert.ok(listable(room, T));
  assert.ok(!listable({ ...room, public: false }, T));
  assert.ok(!listable({ ...room, status: 'playing' }, T));
  assert.ok(!listable(room, T + AWAY_MS + 1), 'everyone gone');
  assert.ok(!listable({ ...room, settings: { ...room.settings, maxPlayers: 2 } }, T), 'full');
});
