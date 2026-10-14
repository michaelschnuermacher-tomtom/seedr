import { test } from 'node:test';
import assert from 'node:assert/strict';
import { playersPerRound, gamesPerPlayer, recommendOptions } from '../src/engine/timeplan.js';

test('players per round is limited by courts and by groups of four', () => {
  assert.equal(playersPerRound(18, 3), 12);
  assert.equal(playersPerRound(10, 3), 8);
  assert.equal(playersPerRound(5, 3), 4);
  assert.equal(playersPerRound(3, 2), 0);
});

test('games per player: even and uneven', () => {
  assert.deepEqual(gamesPerPlayer(18, 3, 9), { min: 6, max: 6, even: true });
  assert.deepEqual(gamesPerPlayer(18, 3, 8), { min: 5, max: 6, even: false });
});

test('recommendations for the spec example (18 players, 3 courts, 120 min, 2 min break)', () => {
  const options = recommendOptions({ players: 18, courts: 3, totalMinutes: 120, breakMinutes: 2 });
  const byRounds = Object.fromEntries(options.map((o) => [o.rounds, o]));
  assert.deepEqual(byRounds[6], { rounds: 6, matchMinutes: 18, breakMinutes: 2, gamesMin: 4, gamesMax: 4, even: true, totalMinutes: 120 });
  assert.deepEqual(byRounds[9], { rounds: 9, matchMinutes: 11, breakMinutes: 2, gamesMin: 6, gamesMax: 6, even: true, totalMinutes: 117 });
  assert.equal(byRounds[8].matchMinutes, 13);
  assert.equal(byRounds[8].even, false);
  assert.deepEqual(options.filter((o) => o.even).map((o) => o.rounds), [3, 6, 9, 12, 15]);
  assert.equal(options.findIndex((o) => !o.even), 5, 'even options come first');
  assert.ok(options.every((o) => o.matchMinutes >= 5 && o.totalMinutes <= 120));
  assert.equal(Math.max(...options.map((o) => o.rounds)), 17);
});

test('no options with fewer than 4 players or too little time', () => {
  assert.deepEqual(recommendOptions({ players: 3, courts: 1, totalMinutes: 60, breakMinutes: 2 }), []);
  assert.deepEqual(recommendOptions({ players: 8, courts: 2, totalMinutes: 6, breakMinutes: 2 }), []);
});
