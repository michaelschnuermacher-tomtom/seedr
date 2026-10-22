import { test } from 'node:test';
import assert from 'node:assert/strict';
import { courtSvg } from '../src/ui/court.js';

// Court surface rectangles (the quarters' court colors) of a picture.
const surface = (svg) => [...svg.matchAll(/<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)" fill="#(2596be|1f3c88|c8553d|006633)"/g)]
  .map((m) => m.slice(1, 5).map(Number));
const box = (svg) => {
  const [, w, h] = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg).map(Number);
  const rects = surface(svg);
  const left = Math.min(...rects.map(([x]) => x));
  const top = Math.min(...rects.map(([, y]) => y));
  const right = Math.max(...rects.map(([x, , rw]) => x + rw));
  const bottom = Math.max(...rects.map(([, y, , rh]) => y + rh));
  return { w, h, cw: right - left, ch: bottom - top, left, top, rects };
};

test('the background has two courts with the four Grand Slam surfaces and white lines', () => {
  const svg = courtSvg({ aspect: 0.46 });
  for (const color of ['#2596be', '#1f3c88', '#c8553d', '#006633']) assert.equal(svg.split(color).length - 1, 2, color);
  assert.equal(svg.match(/stroke="#fff"/g).length, 2);
});

test('the courts lie sideways, one above the other, 12 ft apart', () => {
  for (const aspect of [0.46, 1.78]) {
    const b = box(courtSvg({ aspect }));
    assert.ok(Math.abs(b.w / b.h - aspect) < 0.01, `aspect ${aspect}`);
    assert.ok(Math.abs(b.cw - 78) < 0.2 && Math.abs(b.ch - 84) < 0.2, `aspect ${aspect}: two 78 × 36 courts + 12 ft`);
  }
});

test('both courts are visible and fill most of the limiting side', () => {
  for (const aspect of [0.4, 0.46, 0.56, 0.69, 0.75, 1, 1.33, 1.78, 2.2]) {
    const b = box(courtSvg({ aspect }));
    assert.ok(b.left >= 0 && b.top >= 0 && b.left + b.cw <= b.w + 0.1 && b.top + b.ch <= b.h + 0.1, `aspect ${aspect}: inside`);
    const share = Math.max(b.cw / b.w, b.ch / b.h);
    assert.ok(share > 0.9 && share < 0.94, `aspect ${aspect}: fills ${share.toFixed(2)}`);
  }
});
