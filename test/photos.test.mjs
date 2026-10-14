import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { PHOTOS, TOURNAMENT_PHOTO } from '../src/ui/photo-list.js';

const ui = (p) => new URL(`../src/ui/${p}`, import.meta.url);

test('the photo list names existing optimized photos', () => {
  assert.equal(PHOTOS.length, 14);
  for (const p of PHOTOS) assert.ok(existsSync(ui(p)), `${p} is missing`);
  assert.ok(PHOTOS.includes(TOURNAMENT_PHOTO));
  assert.equal(TOURNAMENT_PHOTO, 'photos/13-sunset-court-group.jpg');
  assert.deepEqual(readdirSync(ui('photos')).sort(), PHOTOS.map((p) => p.slice('photos/'.length)).sort());
});

test('optimized photos are small and carry no metadata (no GPS location)', () => {
  for (const p of PHOTOS) {
    const bytes = readFileSync(ui(p));
    assert.ok(bytes.length < 400 * 1024, `${p} is ${Math.round(bytes.length / 1024)} KB`);
    assert.equal(bytes.indexOf('Exif'), -1, `${p} still has an Exif block`);
  }
});

test('the tournament banner starts with photo 13 and then shows every photo once', async () => {
  const { photoOrder } = await import('../src/ui/hero.js');
  const order = photoOrder();
  assert.equal(order[0], 'photos/13-sunset-court-group.jpg');
  assert.deepEqual([...order].sort(), [...PHOTOS].sort());
});

test('every photo has a focus point (where the faces are) and its size', async () => {
  const { PHOTO_INFO } = await import('../src/ui/photo-list.js');
  for (const p of PHOTOS) {
    const info = PHOTO_INFO[p];
    assert.ok(info, `${p} has no focus point`);
    const [fx, fy, w, h] = info;
    assert.ok(fx >= 0 && fx <= 1 && fy >= 0 && fy <= 1, `${p} focus out of range`);
    assert.ok(w > 0 && h > 0);
  }
});

test('the banner crop keeps the focus point visible', async () => {
  const { bannerPosition } = await import('../src/ui/hero.js');
  // Portrait 1200×1600 photo in a 900×230 banner: scaled to 900×1200, 230 px visible.
  assert.equal(bannerPosition([0.5, 0.3], 1200, 1600, 900, 230), '50% 25.3%'); // faces 30% down
  assert.equal(bannerPosition([0.5, 0.02], 1200, 1600, 900, 230), '50% 0%'); // clamped at the top
  assert.equal(bannerPosition([0.5, 0.99], 1200, 1600, 900, 230), '50% 100%'); // clamped at the bottom
  // Square photo in a tall narrow box: width is cropped instead.
  assert.equal(bannerPosition([0.25, 0.5], 640, 640, 100, 400), '16.7% 50%');
});
