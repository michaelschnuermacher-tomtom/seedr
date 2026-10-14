const STORAGE_KEY = 'seedr.v1';

export function createStore(backend) {
  let available = Boolean(backend);
  let data = { tournaments: {} };

  if (backend) {
    try {
      const raw = backend.getItem(STORAGE_KEY);
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed.tournaments === 'object') data = parsed;
        } catch {
          backend.setItem(`${STORAGE_KEY}.corrupt-${Date.now()}`, raw);
        }
      }
    } catch {
      available = false;
    }
  }

  function persist() {
    if (!backend) return false;
    try {
      backend.setItem(STORAGE_KEY, JSON.stringify(data));
      available = true;
      return true;
    } catch {
      available = false;
      return false;
    }
  }

  return {
    get available() { return available; },
    list() {
      return Object.values(data.tournaments).sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')));
    },
    get(id) { return data.tournaments[id] ?? null; },
    save(t) { data.tournaments[t.id] = t; return persist(); },
    remove(id) { delete data.tournaments[id]; return persist(); },
  };
}
