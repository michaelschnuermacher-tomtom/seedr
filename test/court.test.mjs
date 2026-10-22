import { test } from 'node:test';
import assert from 'node:assert/strict';
import { courtSvg } from '../src/ui/court.js';

test('the background court has the four Grand Slam surfaces and white lines', () => {
  for (const landscape of [false, true]) {
    const svg = courtSvg({ landscape });
    for (const color of ['#2596be', '#1f3c88', '#c8553d', '#006633']) assert.ok(svg.includes(color), color);
    assert.match(svg, /stroke="#fff"/);
  }
});

test('upright the court lies sideways, on a wide screen lengthwise', () => {
  const portrait = courtSvg({ landscape: false });
  assert.match(portrait, /viewBox="0 0 82 178"/);
  assert.match(portrait, /rotate\(90\)/);
  const landscape = courtSvg({ landscape: true });
  assert.match(landscape, /viewBox="0 0 178 82"/);
  assert.doesNotMatch(landscape, /rotate/);
});

test('the whole court fits inside the frame', () => {
  // Portrait: the court surface (78 ft across) nearly fills the 82 ft wide frame.
  const rects = [...courtSvg({ landscape: false }).matchAll(/<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)" fill="#(2596be|1f3c88|c8553d|006633)"/g)]
    .map((m) => m.slice(1, 5).map(Number));
  const left = Math.min(...rects.map(([x]) => x));
  const right = Math.max(...rects.map(([x, , w]) => x + w));
  assert.deepEqual([left, right], [2, 80]);
});
