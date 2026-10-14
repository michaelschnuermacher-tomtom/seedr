import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/ui/store.js';

function memoryBackend(initial = {}) {
  const data = new Map(Object.entries(initial));
  return { data, getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => { data.set(k, String(v)); } };
}
const t = (id, createdAt) => ({ id, name: id, createdAt });

test('saved tournaments survive a new store on the same backend', () => {
  const backend = memoryBackend();
  const store = createStore(backend);
  assert.equal(store.save(t('a', '2026-01-01')), true);
  assert.equal(store.save(t('b', '2026-02-01')), true);
  const again = createStore(backend);
  assert.deepEqual(again.list().map((x) => x.id), ['b', 'a']);
  assert.deepEqual(again.get('a'), t('a', '2026-01-01'));
  assert.equal(again.available, true);
});

test('remove deletes a tournament', () => {
  const backend = memoryBackend();
  const store = createStore(backend);
  store.save(t('a', '2026-01-01'));
  store.remove('a');
  assert.equal(createStore(backend).get('a'), null);
});

test('without a backend it works in memory and reports unavailable', () => {
  const store = createStore(null);
  assert.equal(store.available, false);
  assert.equal(store.save(t('a', '2026-01-01')), false);
  assert.deepEqual(store.get('a'), t('a', '2026-01-01'));
});

test('a failing setItem (e.g. storage full) marks storage unavailable', () => {
  const store = createStore({ getItem: () => null, setItem: () => { throw new Error('QuotaExceeded'); } });
  assert.equal(store.save(t('a', '2026-01-01')), false);
  assert.equal(store.available, false);
});

test('corrupt stored data is backed up and the store starts empty', () => {
  const backend = memoryBackend({ 'seedr.v1': '{not json' });
  const store = createStore(backend);
  assert.deepEqual(store.list(), []);
  const backups = [...backend.data.keys()].filter((k) => k.startsWith('seedr.v1.corrupt-'));
  assert.equal(backups.length, 1);
  assert.equal(backend.data.get(backups[0]), '{not json');
});
