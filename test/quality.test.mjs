import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drawQuality } from '../src/engine/quality.js';

const players = ['Anna', 'Ben', 'Carla', 'David', 'Eva'].map((name, i) => ({ id: `p${i + 1}`, name, skill: [1, 5, 3, 4, 9][i] }));
const round = (n, team1, team2, sitOuts) => ({ round: n, matches: [{ court: 1, team1, team2 }], sitOuts });

test('gaps, partners, opponents and sit-outs of a small schedule', () => {
  const schedule = [
    round(1, ['p1', 'p2'], ['p3', 'p4'], ['p5']), // 7 vs 7.25
    round(2, ['p1', 'p3'], ['p2', 'p4'], ['p5']), // 4.5 vs 9.25
    round(3, ['p1', 'p4'], ['p2', 'p3'], ['p5']), // 5.75 vs 8.5
  ];
  const q = drawQuality(players, schedule);
  assert.equal(q.matches, 3);
  assert.equal(q.avgGap, (0.25 + 4.75 + 2.75) / 3);
  assert.deepEqual(q.worst, { gap: 4.75, round: 2, court: 1 });
  assert.deepEqual(q.partners, { distinct: 3, repeats: 0 }); // 4 players, everyone with each other once
  assert.equal(q.opponents.distinct, 3);
  assert.equal(q.opponents.repeats, 6); // each of the 6 pairs faced each other twice
  assert.equal(q.opponents.thirds, 0);
  assert.deepEqual(q.opponents.most.map((m) => [m.names.join(' & '), m.times]), [['Anna & Ben', 2], ['Anna & Carla', 2], ['Anna & David', 2]]);
  assert.deepEqual(q.sitOuts, { backToBack: 1, longestRun: 3 });
});

test('an empty schedule gives zeros', () => {
  const q = drawQuality(players, []);
  assert.deepEqual([q.matches, q.avgGap, q.worst, q.partners.distinct], [0, 0, null, 0]);
});
