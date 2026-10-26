// Each tournament lives under its own key and is read fresh on every access, so two
// open tabs never overwrite each other's tournaments. When storage fails, tournaments
// are kept in memory for this page and `available` becomes false.
// The people (shared by all tournaments) live under one key of their own; before a
// tournament is first linked to people, an untouched copy is kept under ORIGINAL_PREFIX.
export const STORAGE_PREFIX = 'seedr.v1.t.';
export const PEOPLE_KEY = 'seedr.v1.people';
export const ORIGINAL_PREFIX = 'seedr.v1.original.t.';

export function createStore(backend) {
  let available = Boolean(backend);
  const memory = new Map();
  let memoryPeople = null;

  const write = (key, value) => {
    if (!backend) return false;
    try {
      backend.setItem(key, JSON.stringify(value));
      available = true;
      return true;
    } catch {
      available = false;
      return false;
    }
  };

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
    // The people list, or null when there is none yet (before the first start of the
    // version with shared players).
    people() {
      if (memoryPeople) return memoryPeople;
      if (!backend) return null;
      try {
        const value = JSON.parse(backend.getItem(PEOPLE_KEY));
        return Array.isArray(value?.people) ? value.people : null;
      } catch {
        return null;
      }
    },
    savePeople(people) {
      if (write(PEOPLE_KEY, { version: 1, people })) {
        memoryPeople = null;
        return true;
      }
      memoryPeople = people;
      return false;
    },
    // Keeps an untouched copy of a tournament (only the first one).
    keepOriginal(t) {
      if (!backend) return;
      try {
        if (backend.getItem(ORIGINAL_PREFIX + t.id) === null) write(ORIGINAL_PREFIX + t.id, t);
      } catch {
        available = false;
      }
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
