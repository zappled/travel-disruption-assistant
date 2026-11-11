import type { Store } from "../store.js";

// api.weather.gov requires an identifying User-Agent. Deliberately generic:
// no personal or company details are sent to external services.
export const USER_AGENT = "travel-disruption-assistant/0.1 (prototype)";

export class HttpError extends Error {
  constructor(
    public status: number,
    public url: string,
  ) {
    super(`HTTP ${status} from ${new URL(url).host}`);
  }
}

interface FetchOptions {
  store: Store;
  ttlMs: number;
  timeoutMs?: number;
  retries?: number;
  accept?: string;
}

/**
 * GET a URL with timeout, one retry on 5xx/network errors, and a TTL cache
 * (so repeated assessments don't hammer free public APIs).
 */
export async function cachedGet(
  url: string,
  { store, ttlMs, timeoutMs = 10_000, retries = 1, accept = "application/json" }: FetchOptions,
): Promise<{ body: string; fetchedAt: string }> {
  const key = `http:${url}`;
  const hit = store.get<{ body: string; fetchedAt: string }>(key);
  if (hit) return hit;

  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": USER_AGENT, Accept: accept },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) {
        lastErr = new HttpError(res.status, url);
        if (res.status < 500 && res.status !== 429) break; // not retryable
        continue;
      }
      const value = { body: await res.text(), fetchedAt: new Date().toISOString() };
      store.set(key, value, ttlMs);
      return value;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

export async function cachedGetJson<T>(url: string, opts: FetchOptions): Promise<{ data: T; fetchedAt: string }> {
  const { body, fetchedAt } = await cachedGet(url, opts);
  return { data: JSON.parse(body) as T, fetchedAt };
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === "TimeoutError") return "timed out";
    return err.message;
  }
  return String(err);
}
