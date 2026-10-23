import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatSigned, slugify, newId } from '../src/ui/dom.js';

test('formatSigned', () => {
  assert.equal(formatSigned(1.25), '+1.3');
  assert.equal(formatSigned(-0.5), '−0.5');
  assert.equal(formatSigned(0), '0.0');
  assert.equal(formatSigned(-0.04), '0.0');
});

test('slugify', () => {
  assert.equal(slugify('Club Night 2026!'), 'club-night-2026');
  assert.equal(slugify('***'), 'tournament');
});

test('newId is unique-looking', () => {
  const a = newId();
  assert.match(a, /^t[0-9a-z]+$/);
  assert.notEqual(a, newId());
});
