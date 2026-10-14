import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRng, randomInt, shuffle, newSeed } from '../src/engine/rng.js';

test('same seed gives the same sequence', () => {
  const a = createRng(42);
  const b = createRng(42);
  for (let i = 0; i < 5; i++) assert.equal(a(), b());
});

test('different seeds give different sequences', () => {
  assert.notEqual(createRng(1)(), createRng(2)());
});

test('values are in [0, 1)', () => {
  const rng = createRng(7);
  for (let i = 0; i < 1000; i++) {
    const v = rng();
    assert.ok(v >= 0 && v < 1);
  }
});

test('randomInt stays in range and hits every value', () => {
  const rng = createRng(9);
  const seen = new Set();
  for (let i = 0; i < 500; i++) {
    const v = randomInt(rng, 5);
    assert.ok(Number.isInteger(v) && v >= 0 && v < 5);
    seen.add(v);
  }
  assert.equal(seen.size, 5);
});

test('shuffle returns a permutation and leaves the input unchanged', () => {
  const input = [1, 2, 3, 4, 5, 6];
  const out = shuffle(createRng(3), input);
  assert.deepEqual(input, [1, 2, 3, 4, 5, 6]);
  assert.deepEqual([...out].sort((x, y) => x - y), input);
});

test('newSeed is a 32-bit unsigned integer', () => {
  const s = newSeed();
  assert.ok(Number.isInteger(s) && s >= 0 && s < 2 ** 32);
});
