import { Router } from 'express';
import { createRequire } from 'node:module';
import { cached, lru } from '../lib/cache.js';
import { upstream, UpstreamError } from '../lib/upstream.js';

const require = createRequire(import.meta.url);
const gbfsRegistry = require('../../src/data/local_data/gbfs-systems.json');

/**
 * Hosts the GBFS proxy is allowed to reach. A feed URL arrives from the client
 * and a discovery document can point anywhere, so the hostname is checked
 * against the bundled registry — an open URL proxy would be an SSRF hole.
 */
const GBFS_HOSTS = new Set(gbfsRegistry.systems.map((s) => new URL(s.url).host));

export function feedRoutes(env) {
  const router = Router();
  const tileCache = lru(600);

  const requireKey = (name, value) => {
    if (!value) throw new UpstreamError(`${name} is not configured on this server`, 501);
    return value;
  };

  /** What the browser is allowed to know: which capabilities exist, never the keys. */
  router.get('/health', (_req, res) => {
    res.json({
      ok: true,
      capabilities: {
        firms: Boolean(env.FIRMS_MAP_KEY),
        ais: Boolean(env.AISSTREAM_API_KEY),
        tomtom: Boolean(env.TOMTOM_API_KEY),
        opensky: Boolean(env.OPENSKY_CLIENT_ID && env.OPENSKY_CLIENT_SECRET),
      },
      startedAt: env._startedAt,
    });
  });

  // --- CelesTrak: element sets are good for days, so cache hard. ------------
  router.get('/celestrak', async (req, res, next) => {
    try {
      const group = String(req.query.group ?? 'stations').replace(/[^a-z0-9-]/gi, '');
      const { value, hit, age } = await cached('celestrak', group, 6 * 60 * 60 * 1000, async () => {
        const r = await upstream(
          `https://celestrak.org/NORAD/elements/gp.php?GROUP=${group}&FORMAT=tle`,
        );
        const text = await r.text();
        if (text.trim().toLowerCase().startsWith('no gp data')) {
          throw new UpstreamError(`CelesTrak has no group "${group}"`, 404);
        }
        return text;
      });
      res.set('content-type', 'text/plain; charset=utf-8');
      res.set('x-cache', hit ? `hit; age=${Math.round(age / 1000)}` : 'miss');
      res.send(value);
    } catch (err) {
      next(err);
    }
  });

  // --- NASA FIRMS: metered key, CSV out. -----------------------------------
  router.get('/firms', async (req, res, next) => {
    try {
      const key = requireKey('FIRMS_MAP_KEY', env.FIRMS_MAP_KEY);
      const area = String(req.query.area ?? '').replace(/[^0-9.,-]/g, '');
      const days = Math.min(10, Math.max(1, Number(req.query.days) || 1));
      if (!/^-?\d+(\.\d+)?(,-?\d+(\.\d+)?){3}$/.test(area)) {
        throw new UpstreamError('area must be minLon,minLat,maxLon,maxLat', 400);
      }
      const source = 'VIIRS_NOAA20_NRT';
      const { value, hit } = await cached('firms', `${source}|${area}|${days}`, 10 * 60_000, async () => {
        const url = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${key}/${source}/${area}/${days}`;
        const r = await upstream(url, { redactPattern: new RegExp(key, 'g') });
        return r.text();
      });
      res.set('content-type', 'text/csv; charset=utf-8');
      res.set('x-cache', hit ? 'hit' : 'miss');
      res.send(value);
    } catch (err) {
      next(err);
    }
  });

  // --- Launch Library 2: heavily rate limited when anonymous. ---------------
  router.get('/launches', async (req, res, next) => {
    try {
      const mode = req.query.mode === 'previous' ? 'previous' : 'upcoming';
      const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
      const { value, hit } = await cached('launches', `${mode}|${limit}`, 30 * 60_000, async () => {
        const url = `https://ll.thespacedevs.com/2.2.0/launch/${mode}/?limit=${limit}&mode=list`;
        const headers = env.LL2_TOKEN ? { authorization: `Token ${env.LL2_TOKEN}` } : {};
        const r = await upstream(url, { headers });
        return r.json();
      });
      res.set('x-cache', hit ? 'hit' : 'miss');
      res.json(value);
    } catch (err) {
      next(err);
    }
  });

  // --- GBFS: allowlisted hosts only. ---------------------------------------
  router.get('/gbfs', async (req, res, next) => {
    try {
      const raw = String(req.query.url ?? '');
      let target;
      try {
        target = new URL(raw);
      } catch {
        throw new UpstreamError('url must be absolute', 400);
      }
      if (target.protocol !== 'https:') throw new UpstreamError('https only', 400);
      if (!GBFS_HOSTS.has(target.host)) {
        throw new UpstreamError(`${target.host} is not in the bundled GBFS registry`, 403);
      }
      const { value, hit } = await cached('gbfs', target.href, 45_000, async () => {
        const r = await upstream(target.href, { timeoutMs: 12_000 });
        return r.json();
      });
      res.set('x-cache', hit ? 'hit' : 'miss');
      res.json(value);
    } catch (err) {
      next(err);
    }
  });

  // --- radio-browser: wants a real user agent, which a browser cannot set. --
  router.get('/radio', async (req, res, next) => {
    try {
      const lat = Number(req.query.lat);
      const lon = Number(req.query.lon);
      const distance = Math.min(1_000_000, Math.max(1000, Number(req.query.distance) || 200_000));
      const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 150));
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        throw new UpstreamError('lat and lon are required', 400);
      }
      const cacheKey = `${lat.toFixed(2)}|${lon.toFixed(2)}|${distance}|${limit}`;
      const { value, hit } = await cached('radio', cacheKey, 10 * 60_000, async () => {
        const params = new URLSearchParams({
          geo_lat: String(lat),
          geo_long: String(lon),
          geo_distance: String(distance),
          has_geo_info: 'true',
          hidebroken: 'true',
          order: 'votes',
          reverse: 'true',
          limit: String(limit),
        });
        const r = await upstream(`https://de1.api.radio-browser.info/json/stations/search?${params}`);
        return r.json();
      });
      res.set('x-cache', hit ? 'hit' : 'miss');
      res.json(value);
    } catch (err) {
      next(err);
    }
  });

  // --- TomTom flow tiles: one request per screenful, cached in memory. ------
  router.get('/tomtom/flow/:z/:x/:y', async (req, res, next) => {
    try {
      const key = requireKey('TOMTOM_API_KEY', env.TOMTOM_API_KEY);
      const z = Number(req.params.z);
      const x = Number(req.params.x);
      const y = Number(req.params.y);
      if (![z, x, y].every(Number.isInteger) || z < 0 || z > 22) {
        throw new UpstreamError('bad tile coordinates', 400);
      }
      const id = `${z}/${x}/${y}`;
      let buf = tileCache.get(id);
      if (!buf) {
        const url = `https://api.tomtom.com/traffic/map/4/tile/flow/relative0/${id}.png?key=${key}`;
        const r = await upstream(url, { timeoutMs: 12_000, redactPattern: new RegExp(key, 'g') });
        buf = Buffer.from(await r.arrayBuffer());
        tileCache.set(id, buf);
      }
      res.set('content-type', 'image/png');
      res.set('cache-control', 'public, max-age=180');
      res.send(buf);
    } catch (err) {
      next(err);
    }
  });

  // --- Nominatim: place search. Their policy requires a real user agent and
  //     a hard rate limit, neither of which a browser can promise. -----------
  router.get('/geocode', async (req, res, next) => {
    try {
      const q = String(req.query.q ?? '').trim().slice(0, 120);
      if (q.length < 2) throw new UpstreamError('q is required', 400);
      const { value, hit } = await cached('geocode', q.toLowerCase(), 24 * 60 * 60 * 1000, async () => {
        const params = new URLSearchParams({ q, format: 'jsonv2', limit: '6', addressdetails: '0' });
        const r = await upstream(`https://nominatim.openstreetmap.org/search?${params}`, {
          timeoutMs: 12_000,
        });
        const rows = await r.json();
        return rows.map((row) => ({
          label: row.display_name,
          lat: Number(row.lat),
          lon: Number(row.lon),
          kind: row.type,
          importance: row.importance,
        }));
      });
      res.set('x-cache', hit ? 'hit' : 'miss');
      res.json(value);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
