/**
 * Fetch helpers. Every remote read in this app goes through here so that
 * timeouts, aborts and HTTP failures are classified the same way and layers
 * can report an honest freshness state instead of silently showing stale dots.
 */

export class FeedError extends Error {
  constructor(message, { status = 0, kind = 'network' } = {}) {
    super(message);
    this.name = 'FeedError';
    this.status = status;
    this.kind = kind; // 'network' | 'http' | 'timeout' | 'parse' | 'quota' | 'auth'
  }
}

function classify(status) {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'quota';
  return 'http';
}

export async function fetchJson(url, { timeoutMs = 15000, signal, headers, ...rest } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new FeedError('timed out', { kind: 'timeout' })), timeoutMs);
  const onAbort = () => ctrl.abort(signal?.reason);
  signal?.addEventListener('abort', onAbort, { once: true });

  try {
    const res = await fetch(url, {
      ...rest,
      signal: ctrl.signal,
      headers: { accept: 'application/json', ...headers },
    });
    if (!res.ok) {
      throw new FeedError(`${res.status} ${res.statusText} from ${new URL(url, location.href).host}`, {
        status: res.status,
        kind: classify(res.status),
      });
    }
    try {
      return await res.json();
    } catch {
      throw new FeedError('response was not valid JSON', { kind: 'parse' });
    }
  } catch (err) {
    if (err instanceof FeedError) throw err;
    if (err?.name === 'AbortError') throw new FeedError('request aborted', { kind: 'timeout' });
    throw new FeedError(err?.message || 'network unreachable', { kind: 'network' });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

export async function fetchText(url, { timeoutMs = 15000, signal, ...rest } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const onAbort = () => ctrl.abort(signal?.reason);
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const res = await fetch(url, { ...rest, signal: ctrl.signal });
    if (!res.ok) {
      throw new FeedError(`${res.status} ${res.statusText}`, { status: res.status, kind: classify(res.status) });
    }
    return await res.text();
  } catch (err) {
    if (err instanceof FeedError) throw err;
    throw new FeedError(err?.message || 'network unreachable', { kind: 'network' });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/** Read-through memory cache keyed by URL, so panning does not re-hammer feeds. */
export function memoize(fn, { ttlMs = 60_000, max = 64 } = {}) {
  const store = new Map();
  return async (key, ...args) => {
    const hit = store.get(key);
    if (hit && Date.now() - hit.at < ttlMs) return hit.value;
    const value = await fn(key, ...args);
    store.set(key, { at: Date.now(), value });
    if (store.size > max) store.delete(store.keys().next().value);
    return value;
  };
}
