/**
 * Minimal key/value cache with optional TTL. Everything the app persists
 * (users, sessions, saved routes, source responses) goes through this
 * interface, so swapping the in-memory implementation for Redis later
 * doesn't touch any route code.
 *
 * NOTE: the in-memory implementation is wiped whenever the API restarts.
 */
export interface Store {
  get<T>(key: string): T | undefined;
  set<T>(key: string, value: T, ttlMs?: number): void;
  delete(key: string): void;
}

interface Entry {
  value: unknown;
  expiresAt: number | null;
}

export class MemoryStore implements Store {
  private data = new Map<string, Entry>();

  get<T>(key: string): T | undefined {
    const entry = this.data.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      this.data.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  set<T>(key: string, value: T, ttlMs?: number): void {
    this.data.set(key, {
      value,
      expiresAt: ttlMs ? Date.now() + ttlMs : null,
    });
  }

  delete(key: string): void {
    this.data.delete(key);
  }
}
