import { test } from 'node:test';
import assert from 'node:assert/strict';
import { playersPerRound, gamesPerPlayer, recommendOptions, fewerGamesCount, roundStartTimes, describeGames } from '../src/engine/timeplan.js';

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

test('fewerGamesCount: how many players get the smaller number of games', () => {
  assert.equal(fewerGamesCount(17, 2, 8), 4); // 64 places: 13 × 4 games, 4 × 3 games
  assert.equal(fewerGamesCount(16, 2, 8), 0);
  assert.equal(fewerGamesCount(10, 2, 5), 0); // 40 places, 4 games each
});

test('roundStartTimes: the last match ends at the end time', () => {
  assert.deepEqual(roundStartTimes({ rounds: 4, matchMinutes: 25, breakMinutes: 5, endTime: '18:00' }),
    ['16:05', '16:35', '17:05', '17:35']);
  assert.deepEqual(roundStartTimes({ rounds: 3, matchMinutes: 20, breakMinutes: 0, endTime: '00:30' }), ['23:30', '23:50', '00:10']);
});

test('describeGames says exactly how many players play how many games', () => {
  assert.equal(describeGames(17, 2, 8), '13 players play 4 games, 4 players play 3 games');
  assert.equal(describeGames(16, 2, 8), 'all 16 players play 4 games');
  assert.equal(describeGames(9, 2, 1), '8 players play 1 game, 1 player plays 0 games');
});

test('an extra option leaves courts empty in the last round when that evens out the games', () => {
  const options = recommendOptions({ players: 17, courts: 2, totalMinutes: 240, breakMinutes: 5 });
  assert.deepEqual(options[0], { rounds: 9, lastRoundCourts: 1, matchMinutes: 21, breakMinutes: 5, gamesMin: 4, gamesMax: 4, even: true, totalMinutes: 234 });
  assert.ok(options.some((o) => o.rounds === 9 && !o.lastRoundCourts), 'the option with all courts stays');
  assert.ok(!options.some((o) => o.rounds === 8 && o.lastRoundCourts), 'no extra option when it would not help');
  assert.equal(describeGames(17, 2, 9, 1), 'all 17 players play 4 games');
  assert.equal(fewerGamesCount(18, 3, 8, 1), 2); // 88 places: 16 × 5 games, 2 × 4 games
});
