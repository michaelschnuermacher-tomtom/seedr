import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/ui/store.js';

function memoryBackend(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    get length() { return data.size; },
    key: (i) => [...data.keys()][i] ?? null,
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => { data.set(k, String(v)); },
    removeItem: (k) => { data.delete(k); },
  };
}
const t = (id, createdAt, extra = {}) => ({ id, name: id, createdAt, ...extra });

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

test('two tabs do not overwrite each other\'s tournaments', () => {
  const backend = memoryBackend();
  const setup = createStore(backend);
  setup.save(t('a', '2026-01-01'));
  setup.save(t('old', '2025-01-01'));
  const tabA = createStore(backend);
  const tabB = createStore(backend);
  tabA.save(t('a', '2026-01-01', { results: { '1-1': 1 } }));
  tabB.remove('old');
  const fresh = createStore(backend);
  assert.deepEqual(fresh.get('a').results, { '1-1': 1 });
  assert.equal(fresh.get('old'), null);
  assert.deepEqual(tabB.get('a').results, { '1-1': 1 }, 'tab B sees tab A\'s change');
});

test('without a backend it works in memory and reports unavailable', () => {
  const store = createStore(null);
  assert.equal(store.available, false);
  assert.equal(store.save(t('a', '2026-01-01')), false);
  assert.deepEqual(store.get('a'), t('a', '2026-01-01'));
  assert.deepEqual(store.list().map((x) => x.id), ['a']);
});

test('a failing setItem (e.g. storage full) keeps the tournament in memory', () => {
  const backend = memoryBackend();
  backend.setItem = () => { throw new Error('QuotaExceeded'); };
  const store = createStore(backend);
  assert.equal(store.save(t('a', '2026-01-01')), false);
  assert.equal(store.available, false);
  assert.deepEqual(store.get('a'), t('a', '2026-01-01'));
});

test('a corrupt stored entry is skipped and left untouched', () => {
  const backend = memoryBackend({ 'seedr.v1.t.bad': '{not json', 'seedr.v1.t.null': 'null' });
  const store = createStore(backend);
  store.save(t('a', '2026-01-01'));
  assert.deepEqual(store.list().map((x) => x.id), ['a']);
  assert.equal(store.get('bad'), null);
  assert.equal(backend.data.get('seedr.v1.t.bad'), '{not json');
});

test('ids like "constructor" are not mistaken for saved tournaments', () => {
  assert.equal(createStore(memoryBackend()).get('constructor'), null);
  assert.equal(createStore(null).get('constructor'), null);
});
