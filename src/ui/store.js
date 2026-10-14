// Each tournament lives under its own key and is read fresh on every access, so two
// open tabs never overwrite each other's tournaments. When storage fails, tournaments
// are kept in memory for this page and `available` becomes false.
export const STORAGE_PREFIX = 'seedr.v1.t.';

export function createStore(backend) {
  let available = Boolean(backend);
  const memory = new Map();

  const read = (key) => {
    try {
      const value = JSON.parse(backend.getItem(key));
      return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
    } catch {
      return null;
    }
  };

  const storedKeys = () => {
    if (!backend) return [];
    try {
      const keys = [];
      for (let i = 0; i < backend.length; i++) {
        const key = backend.key(i);
        if (key?.startsWith(STORAGE_PREFIX)) keys.push(key);
      }
      return keys;
    } catch {
      available = false;
      return [];
    }
  };

  return {
    get available() { return available; },
    list() {
      const byId = new Map();
      for (const key of storedKeys()) {
        const t = read(key);
        if (t) byId.set(key.slice(STORAGE_PREFIX.length), t);
      }
      for (const [id, t] of memory) byId.set(id, t);
      return [...byId.values()].sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')));
    },
    get(id) {
      if (memory.has(id)) return memory.get(id);
      return backend ? read(STORAGE_PREFIX + id) : null;
    },
    save(t) {
      if (backend) {
        try {
          backend.setItem(STORAGE_PREFIX + t.id, JSON.stringify(t));
          memory.delete(t.id);
          available = true;
          return true;
        } catch {
          available = false;
        }
      }
      memory.set(t.id, t);
      return false;
    },
    remove(id) {
      memory.delete(id);
      if (!backend) return false;
      try {
        backend.removeItem(STORAGE_PREFIX + id);
        return true;
      } catch {
        available = false;
        return false;
      }
    },
  };
}
