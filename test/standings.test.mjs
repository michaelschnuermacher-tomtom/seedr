import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeStandings, resultKey } from '../src/engine/standings.js';

// strengths: p1 10, p2 6, p3 8, p4 7, p5 2
const players = [
  { id: 'p1', name: 'Anna', skill: 1 },
  { id: 'p2', name: 'Ben', skill: 5 },
  { id: 'p3', name: 'Carla', skill: 3 },
  { id: 'p4', name: 'David', skill: 4 },
  { id: 'p5', name: 'Eva', skill: 9 },
];
const schedule = [
  { round: 1, matches: [{ court: 1, team1: ['p1', 'p2'], team2: ['p3', 'p4'] }], sitOuts: ['p5'] },
  { round: 2, matches: [{ court: 1, team1: ['p1', 'p5'], team2: ['p2', 'p3'] }], sitOuts: ['p4'] },
];
const byId = (rows) => Object.fromEntries(rows.map((r) => [r.id, r]));

test('resultKey', () => {
  assert.equal(resultKey(3, 2), '3-2');
});

test('no results: everyone at zero, all share rank 1', () => {
  const rows = computeStandings(players, schedule, {});
  rows.forEach((r) => {
    assert.equal(r.points, 0);
    assert.equal(r.rank, 1);
  });
});

test('after round 1: winners lead, sit-out gets 0.5 bonus', () => {
  const rows = byId(computeStandings(players, schedule, { '1-1': 1 }));
  assert.deepEqual([rows.p1.wins, rows.p1.games, rows.p1.points, rows.p1.rank], [1, 1, 1, 1]);
  assert.deepEqual([rows.p2.points, rows.p2.rank], [1, 1]);
  assert.deepEqual([rows.p5.games, rows.p5.bonus, rows.p5.points, rows.p5.rank], [0, 0.5, 0.5, 3]);
  assert.deepEqual([rows.p3.points, rows.p3.rank], [0, 4]);
  assert.equal(rows.p1.avgGap, 1); // 16 vs 15
  assert.equal(rows.p3.avgGap, -1);
});

test('after round 2: shared ranks and bonus for both sit-outs', () => {
  const rows = byId(computeStandings(players, schedule, { '1-1': 1, '2-1': 2 }));
  assert.deepEqual([rows.p2.points, rows.p2.rank], [2, 1]);
  assert.deepEqual([rows.p1.points, rows.p1.rank], [1, 2]);
  assert.deepEqual([rows.p3.points, rows.p3.rank], [1, 2]);
  assert.deepEqual([rows.p4.bonus, rows.p4.points, rows.p4.rank], [0.5, 0.5, 4]);
  assert.deepEqual([rows.p5.bonus, rows.p5.points, rows.p5.rank], [0.5, 0.5, 4]);
});

test('a win in an unfinished round counts, but games and bonus do not change yet', () => {
  const twoCourts = [{ round: 1, matches: [
    { court: 1, team1: ['p1', 'p2'], team2: ['p3', 'p4'] },
    { court: 2, team1: ['p5', 'p6'], team2: ['p7', 'p8'] },
  ], sitOuts: [] }];
  const eight = [...players, { id: 'p6', name: 'F', skill: 5 }, { id: 'p7', name: 'G', skill: 5 }, { id: 'p8', name: 'H', skill: 5 }];
  const rows = byId(computeStandings(eight, twoCourts, { '1-1': 1 }));
  assert.equal(rows.p1.wins, 1);
  assert.equal(rows.p1.games, 0);
  assert.equal(rows.p5.bonus, 0);
});

test('clearing a result recomputes everything (no stale bonus)', () => {
  const rows = byId(computeStandings(players, schedule, { '2-1': 2 }));
  assert.deepEqual([rows.p1.games, rows.p4.games, rows.p4.bonus, rows.p5.bonus], [1, 0, 0.5, 0]);
  assert.equal(rows.p1.wins, 0);
});

test('rows are sorted by points, then weaker skill first, then name', () => {
  const rows = computeStandings(players, schedule, { '1-1': 1 });
  assert.deepEqual(rows.map((r) => r.id), ['p2', 'p1', 'p5', 'p4', 'p3']); // Ben (5) before Anna (1), David (4) before Carla (3)
});

test('a withdrawn player keeps wins but gets no bonus and no rank, and is listed last', () => {
  const gone = players.map((p) => (p.id === 'p1' ? { ...p, withdrawnAfter: 1 } : p));
  // round 2 as redrawn without Anna
  const redrawn = [schedule[0], { round: 2, matches: [{ court: 1, team1: ['p2', 'p5'], team2: ['p3', 'p4'] }], sitOuts: [] }];
  const rows = computeStandings(gone, redrawn, { '1-1': 1, '2-1': 2 });
  const anna = rows.at(-1);
  assert.deepEqual([anna.id, anna.withdrawn, anna.wins, anna.games, anna.bonus, anna.rank], ['p1', true, 1, 1, 0, null]);
  const r = byId(rows);
  assert.deepEqual([r.p5.games, r.p5.bonus], [1, 0.5], 'bonus counts against the remaining players only');
  assert.equal(r.p3.rank, 1);
});
