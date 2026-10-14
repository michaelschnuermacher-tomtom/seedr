import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePlayers, createTournament, revealNext, hasResults, redraw, setResult, updateSettings } from '../src/engine/tournament.js';

test('parsePlayers reads "Name: skill" lines', () => {
  const { players, errors } = parsePlayers('Anna: 3\nBen Miller: 7\n\n  Müller, Jörg : 1 \r\nDavid:10\n');
  assert.deepEqual(errors, []);
  assert.deepEqual(players, [
    { name: 'Anna', skill: 3 },
    { name: 'Ben Miller', skill: 7 },
    { name: 'Müller, Jörg', skill: 1 },
    { name: 'David', skill: 10 },
  ]);
});

test('parsePlayers reports bad lines and keeps the good ones', () => {
  const { players, errors } = parsePlayers('Anna: 0\nBen: 11\nCarla 3\nanna: 4\nAnna: 5\n: 4\nHans: 3.5\nIda:');
  assert.deepEqual(players, [{ name: 'anna', skill: 4 }]);
  assert.equal(errors.length, 7);
  assert.match(errors[0], /^Line 1: skill must be a whole number from 1 to 10/);
  assert.match(errors[1], /^Line 2: skill must be a whole number from 1 to 10/);
  assert.match(errors[2], /^Line 3: expected "Name: skill"/);
  assert.match(errors[3], /^Line 5: duplicate name "Anna"/);
  assert.match(errors[4], /^Line 6: expected "Name: skill"/);
  assert.match(errors[5], /^Line 7: skill must be a whole number from 1 to 10/);
  assert.match(errors[6], /^Line 8: skill must be a whole number from 1 to 10/);
});

const SETTINGS = { courts: 2, rounds: 6, matchMinutes: 12, breakMinutes: 2, revealBatch: 2 };
const PLAYERS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((skill, i) => ({ name: `P${i + 1}`, skill }));
const make = (settings = SETTINGS) => createTournament({
  id: 't1', name: 'Club night', players: PLAYERS, settings, seed: 11, now: new Date('2026-10-14T18:00:00Z'),
});

test('createTournament builds a complete tournament', () => {
  const t = make();
  assert.equal(t.version, 1);
  assert.equal(t.id, 't1');
  assert.equal(t.createdAt, '2026-10-14T18:00:00.000Z');
  assert.deepEqual(t.players[0], { id: 'p1', name: 'P1', skill: 1 });
  assert.equal(t.schedule.length, 6);
  assert.equal(t.revealedRounds, 2);
  assert.deepEqual(t.results, {});
  assert.equal(t.seed, 11);
});

test('revealNext reveals batches until all rounds are visible', () => {
  let t = make();
  t = revealNext(t); assert.equal(t.revealedRounds, 4);
  t = revealNext(t); assert.equal(t.revealedRounds, 6);
  t = revealNext(t); assert.equal(t.revealedRounds, 6);
  assert.equal(make({ ...SETTINGS, revealBatch: 'all' }).revealedRounds, 6);
});

test('setResult sets, changes and clears a result without changing the input', () => {
  const t = make();
  const a = setResult(t, 1, 1, 2);
  assert.deepEqual(a.results, { '1-1': 2 });
  assert.deepEqual(t.results, {});
  assert.equal(hasResults(a), true);
  assert.deepEqual(setResult(a, 1, 1, null).results, {});
  assert.throws(() => setResult(t, 1, 9, 1), /Unknown match/);
});

test('redraw creates a new schedule, but not after results were entered', () => {
  const t = make();
  const r = redraw(t, 99);
  assert.equal(r.seed, 99);
  assert.notDeepEqual(r.schedule, t.schedule);
  assert.throws(() => redraw(setResult(t, 1, 1, 1), 5), /results/);
});

test('updateSettings changes a tournament that has not started and draws a new schedule', () => {
  const t = make();
  const players = [...PLAYERS.slice(0, 8), { name: 'New Player', skill: 2 }];
  const u = updateSettings(t, { name: 'Renamed', players, settings: { ...SETTINGS, courts: 1, rounds: 4, revealBatch: 'all' } }, 77);
  assert.equal(u.id, t.id);
  assert.equal(u.createdAt, t.createdAt);
  assert.equal(u.name, 'Renamed');
  assert.equal(u.seed, 77);
  assert.deepEqual(u.players.map((p) => p.id), ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9']);
  assert.equal(u.players[8].name, 'New Player');
  assert.equal(u.schedule.length, 4);
  u.schedule.forEach((r) => assert.equal(r.matches.length, 1));
  assert.equal(u.revealedRounds, 4);
  assert.deepEqual(u.results, {});
  assert.equal(t.name, 'Club night', 'input unchanged');
});

test('updateSettings is refused once a result has been entered', () => {
  const started = setResult(make(), 1, 1, 1);
  assert.throws(() => updateSettings(started, { name: 'x', players: PLAYERS, settings: SETTINGS }, 1), /results/);
});
