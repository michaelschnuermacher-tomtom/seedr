import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { bundle, build } from '../build.mjs';
import { readFileSync as readDist, existsSync } from 'node:fs';

function fixture(files) {
  const dir = mkdtempSync(join(tmpdir(), 'seedr-bundle-'));
  for (const [name, src] of Object.entries(files)) writeFileSync(join(dir, name), src);
  return dir;
}

test('bundle inlines imports in dependency order', () => {
  const dir = fixture({
    'a.js': "import { b } from './b.js';\nexport function a() { return b() + 1; }\nglobalThis.__seedrResult = a();\n",
    'b.js': 'export function b() { return 41; }\n',
  });
  const code = bundle(join(dir, 'a.js'));
  assert.doesNotMatch(code, /^\s*(import|export)\s/m);
  new Function(code)();
  assert.equal(globalThis.__seedrResult, 42);
});

test('bundle rejects the same top-level name in two modules', () => {
  const dir = fixture({
    'a.js': "import { b } from './b.js';\nfunction helper() {}\n",
    'b.js': 'export function b() {}\nfunction helper() {}\n',
  });
  assert.throws(() => bundle(join(dir, 'a.js')), /"helper" is declared in both/);
});

test('the app bundle compiles', () => {
  const code = bundle(fileURLToPath(new URL('../src/ui/app.js', import.meta.url)));
  assert.doesNotThrow(() => new Function(code));
  assert.doesNotMatch(code, /<\/script/i);
});

test('the build copies the icons and lets the service worker precache them', () => {
  const out = mkdtempSync(join(tmpdir(), 'seedr-dist-'));
  build(out);
  const dist = (p) => join(out, p);
  const icons = ['icons/logo.svg', 'icons/apple-touch-icon.png', 'icons/icon-192.png', 'icons/icon-512.png'];
  for (const p of icons) assert.ok(existsSync(dist(p)), `dist/${p} is missing`);
  assert.ok(!existsSync(dist('photos')), 'no photos folder');
  const sw = readDist(dist('sw.js'), 'utf8');
  for (const p of icons) assert.ok(sw.includes(`'./${p}'`), `sw.js does not precache ${p}`);
  assert.doesNotMatch(sw, /photos\//);
});
