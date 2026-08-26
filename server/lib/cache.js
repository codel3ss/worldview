import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = path.join(process.cwd(), 'server', '.cache');

const key = (ns, id) => path.join(ROOT, ns, `${crypto.createHash('sha1').update(id).digest('hex')}.json`);

/**
 * Disk-backed read-through cache. Upstreams like CelesTrak explicitly ask that
 * you not re-fetch element sets more than a few times a day; this is how we
 * keep that promise across restarts.
 */
export async function cached(ns, id, ttlMs, produce) {
  const file = key(ns, id);
  try {
    const raw = JSON.parse(await fs.readFile(file, 'utf8'));
    if (Date.now() - raw.at < ttlMs) return { value: raw.value, hit: true, age: Date.now() - raw.at };
  } catch {
    /* cold cache */
  }

  const value = await produce();
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify({ at: Date.now(), value }));
  return { value, hit: false, age: 0 };
}

/** In-memory cache for things too hot or too large for disk (map tiles). */
export function lru(max = 400) {
  const map = new Map();
  return {
    get(k) {
      if (!map.has(k)) return undefined;
      const v = map.get(k);
      map.delete(k);
      map.set(k, v);
      return v;
    },
    set(k, v) {
      if (map.has(k)) map.delete(k);
      map.set(k, v);
      if (map.size > max) map.delete(map.keys().next().value);
    },
  };
}
