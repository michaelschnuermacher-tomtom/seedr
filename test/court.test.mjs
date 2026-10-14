import { test } from 'node:test';
import assert from 'node:assert/strict';
import { courtSvg } from '../src/ui/court.js';

test('the background court has the four Grand Slam surfaces and white lines', () => {
  const svg = courtSvg({ landscape: false });
  for (const color of ['#2596be', '#1f3c88', '#c8553d', '#006633']) assert.ok(svg.includes(color), color);
  assert.match(svg, /stroke="#fff"/);
  assert.match(svg, /viewBox="0 0 84 150"/);
});

test('in landscape the court is turned sideways', () => {
  const svg = courtSvg({ landscape: true });
  assert.match(svg, /viewBox="0 0 150 84"/);
  assert.match(svg, /rotate\(90\)/);
});
