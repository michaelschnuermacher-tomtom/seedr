import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const ORIGIN = 'https://seedr.example';
const source = readFileSync(new URL('../src/ui/sw.js', import.meta.url), 'utf8');

// Runs sw.js against fake caches and fetch; returns a function that dispatches a fetch event.
function worker({ cached = {}, fetchImpl }) {
  const store = new Map(Object.entries(cached));
  const cache = {
    addAll: async () => {},
    put: async (req, res) => { store.set(req.url ?? req, res); },
  };
  const urlOf = (req) => new URL(req.url ?? req, `${ORIGIN}/app/`).href;
  const caches = {
    open: async () => cache,
    keys: async () => [],
    delete: async () => true,
    match: async (req) => store.get(urlOf(req)),
  };
  const listeners = {};
  const self = { location: { origin: ORIGIN }, addEventListener: (type, fn) => { listeners[type] = fn; }, skipWaiting() {}, clients: { claim() {} } };
  vm.runInNewContext(source, { self, caches, fetch: fetchImpl, URL, Response, Promise });
  return {
    store,
    dispatch(url, mode = 'navigate') {
      let responded = null;
      const waits = [];
      listeners.fetch({ request: { method: 'GET', url, mode }, respondWith: (p) => { responded = p; }, waitUntil: (p) => waits.push(p) });
      const settled = async () => { await Promise.allSettled([...waits, responded]); await new Promise((r) => setTimeout(r, 10)); };
      return { responded, settled };
    },
  };
}
const res = (body, { redirected = false } = {}) => Object.defineProperty(new Response(body), 'redirected', { value: redirected });
const within = (p, ms) => Promise.race([p, new Promise((_, reject) => setTimeout(() => reject(new Error(`no response within ${ms} ms`)), ms))]);

test('a cached app is served at once, even when the network hangs', async () => {
  const w = worker({ cached: { [`${ORIGIN}/app/`]: res('cached app') }, fetchImpl: () => new Promise(() => {}) });
  const { responded } = w.dispatch(`${ORIGIN}/app/`);
  assert.equal(await (await within(responded, 200)).text(), 'cached app');
});

test('without a cached copy the network response is used and cached', async () => {
  const w = worker({ fetchImpl: async () => res('fresh') });
  const { responded, settled } = w.dispatch(`${ORIGIN}/app/`);
  assert.equal(await (await responded).text(), 'fresh');
  await settled();
  assert.ok(w.store.has(`${ORIGIN}/app/`));
});

test('a cached app is refreshed in the background', async () => {
  const w = worker({ cached: { [`${ORIGIN}/app/`]: res('old') }, fetchImpl: async () => res('new') });
  const { responded, settled } = w.dispatch(`${ORIGIN}/app/`);
  assert.equal(await (await responded).text(), 'old');
  await settled();
  assert.equal(await w.store.get(`${ORIGIN}/app/`).text(), 'new');
});

test('a redirected response (e.g. a Wi-Fi login page) is not cached', async () => {
  const w = worker({ fetchImpl: async () => res('login portal', { redirected: true }) });
  const { settled } = w.dispatch(`${ORIGIN}/app/`);
  await settled();
  assert.equal(w.store.size, 0);
});

test('requests to other sites are not handled', () => {
  const w = worker({ fetchImpl: async () => res('x') });
  assert.equal(w.dispatch('https://other.example/font.woff', 'no-cors').responded, null);
});

test('offline and not cached: a navigation falls back to the cached index.html', async () => {
  const w = worker({ cached: { [`${ORIGIN}/app/index.html`]: res('index') }, fetchImpl: async () => { throw new TypeError('offline'); } });
  const { responded } = w.dispatch(`${ORIGIN}/app/?x=1`);
  assert.equal(await (await responded).text(), 'index');
});
