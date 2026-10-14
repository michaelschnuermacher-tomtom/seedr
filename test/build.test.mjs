import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { bundle, build } from '../build.mjs';
import { readFileSync as readDist, existsSync } from 'node:fs';
import { PHOTOS } from '../src/ui/photo-list.js';

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
  const code = bundle(new URL('../src/ui/app.js', import.meta.url).pathname);
  assert.doesNotThrow(() => new Function(code));
  assert.doesNotMatch(code, /<\/script/i);
});

test('the build copies the photos and lets the service worker precache them', () => {
  build();
  const dist = (p) => new URL(`../dist/${p}`, import.meta.url);
  for (const p of PHOTOS) assert.ok(existsSync(dist(p)), `dist/${p} is missing`);
  const sw = readDist(dist('sw.js'), 'utf8');
  for (const p of PHOTOS) assert.ok(sw.includes(`'./${p}'`), `sw.js does not precache ${p}`);
});
