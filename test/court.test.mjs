import { test } from 'node:test';
import assert from 'node:assert/strict';
import { courtSvg } from '../src/ui/court.js';

// Court surface rectangles (the four quarters' court colors) of a picture.
const surface = (svg) => [...svg.matchAll(/<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)" fill="#(2596be|1f3c88|c8553d|006633)"/g)]
  .map((m) => m.slice(1, 5).map(Number));
const box = (svg) => {
  const [, w, h] = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg).map(Number);
  const rects = surface(svg);
  const left = Math.min(...rects.map(([x]) => x));
  const top = Math.min(...rects.map(([, y]) => y));
  const right = Math.max(...rects.map(([x, , rw]) => x + rw));
  const bottom = Math.max(...rects.map(([, y, , rh]) => y + rh));
  return { w, h, cw: round(right - left), ch: round(bottom - top), left, top };
};
const round = (x) => Math.round(x * 10) / 10;

test('the background court has the four Grand Slam surfaces and white lines', () => {
  for (const aspect of [0.46, 1.78]) {
    const svg = courtSvg({ aspect });
    for (const color of ['#2596be', '#1f3c88', '#c8553d', '#006633']) assert.ok(svg.includes(color), color);
    assert.match(svg, /stroke="#fff"/);
  }
});

test('the picture has the screen shape and the court runs along it', () => {
  const phone = box(courtSvg({ aspect: 0.46 }));
  assert.ok(Math.abs(phone.w / phone.h - 0.46) < 0.01);
  assert.ok(Math.abs(phone.cw - 36) <= 0.2 && Math.abs(phone.ch - 78) <= 0.2, 'upright: court from top to bottom');
  const laptop = box(courtSvg({ aspect: 1.78 }));
  assert.ok(Math.abs(laptop.w / laptop.h - 1.78) < 0.01);
  assert.ok(Math.abs(laptop.cw - 78) <= 0.2 && Math.abs(laptop.ch - 36) <= 0.2, 'wide: court from left to right');
});

test('the whole court is visible and fills most of the limiting side', () => {
  for (const aspect of [0.4, 0.46, 0.56, 0.69, 0.75, 1, 1.33, 1.78, 2.2]) {
    const b = box(courtSvg({ aspect }));
    assert.ok(b.left >= 0 && b.top >= 0 && b.left + b.cw <= b.w + 0.1 && b.top + b.ch <= b.h + 0.1, `aspect ${aspect}: inside`);
    const share = Math.max(b.cw / b.w, b.ch / b.h);
    assert.ok(share > 0.9 && share < 0.94, `aspect ${aspect}: fills ${share.toFixed(2)}`);
  }
});
