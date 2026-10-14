import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LOGO_SVG, logoDataUrl } from '../src/ui/logo.js';
import { build } from '../build.mjs';

test('the logo uses the four Grand Slam colors', () => {
  for (const color of ['#2596be', '#1f3c88', '#c8553d', '#006633']) assert.ok(LOGO_SVG.includes(color), color);
  assert.match(logoDataUrl(), /^data:image\/svg\+xml,/);
});

test('the build ships the app icons and links them', () => {
  build();
  const dist = (p) => new URL(`../dist/${p}`, import.meta.url);
  const html = readFileSync(dist('index.html'), 'utf8');
  assert.match(html, /<link rel="apple-touch-icon" href="icons\/apple-touch-icon.png">/);
  assert.match(html, /<link rel="icon" href="icons\/logo.svg"/);
  const manifest = JSON.parse(readFileSync(dist('manifest.webmanifest'), 'utf8'));
  assert.deepEqual(manifest.icons.map((i) => i.sizes), ['192x192', '512x512']);
  for (const icon of [...manifest.icons.map((i) => i.src), 'icons/apple-touch-icon.png', 'icons/logo.svg']) {
    const bytes = readFileSync(dist(icon));
    assert.ok(bytes.length > 100, `${icon} is empty`);
  }
  const sw = readFileSync(dist('sw.js'), 'utf8');
  assert.ok(sw.includes("'./icons/apple-touch-icon.png'"), 'service worker precaches the icon');
});
