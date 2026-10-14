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
