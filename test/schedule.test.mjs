import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRng } from '../src/engine/rng.js';
import { assignSitOuts, evaluate, strengthOf } from '../src/engine/schedule.js';

test('strength is 11 minus skill', () => {
  assert.equal(strengthOf(1), 10);
  assert.equal(strengthOf(10), 1);
});

test('sit-outs are spread evenly', () => {
  const rounds = assignSitOuts(18, 12, 8, createRng(1));
  assert.equal(rounds.length, 8);
  rounds.forEach((r) => assert.equal(r.length, 6));
  const counts = new Array(18).fill(0);
  rounds.flat().forEach((i) => counts[i]++);
  assert.ok(Math.max(...counts) - Math.min(...counts) <= 1);
});

test('nobody sits out twice before everyone has sat out once', () => {
  const rounds = assignSitOuts(10, 8, 12, createRng(2));
  const flat = rounds.flat();
  for (let start = 0; start < flat.length; start += 10) {
    const block = flat.slice(start, start + 10);
    assert.equal(new Set(block).size, block.length);
  }
});

test('nobody sits out when everyone fits on court', () => {
  assert.deepEqual(assignSitOuts(8, 8, 3, createRng(3)), [[], [], []]);
});

test('evaluate: balanced single match', () => {
  const strength = [1, 2, 3, 4].map(strengthOf); // 10, 9, 8, 7
  const e = evaluate([[0, 3, 1, 2]], strength, 4); // 17 vs 17
  assert.deepEqual(e, { cost: 0, partnerRepeats: 0, opponentRepeats: 0, sumDiffSq: 0, maxAbsDiff: 0, maxAbsBalance: 0 });
});

test('evaluate: unbalanced match and repeats', () => {
  const strength = [1, 2, 3, 4].map(strengthOf);
  const once = evaluate([[0, 1, 2, 3]], strength, 4); // 19 vs 15 → diff 4
  assert.equal(once.sumDiffSq, 16);
  assert.equal(once.maxAbsDiff, 4);
  assert.equal(once.maxAbsBalance, 4);
  assert.equal(once.cost, 10 * 16 + 3 * (4 * 16));
  const twice = evaluate([[0, 1, 2, 3], [0, 1, 2, 3]], strength, 4);
  assert.equal(twice.partnerRepeats, 2);
  assert.equal(twice.opponentRepeats, 4);
});
