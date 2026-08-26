import { FRESHNESS } from '../core/layer.js';
import { fetchJson } from '../core/net.js';
import { PointLayer } from './pointLayer.js';
import { haversine } from '../util/geo.js';
import registry from '../data/local_data/gbfs-systems.json';

/** GBFS feeds are per-operator; the proxy caches and CORS-normalises them. */
const via = (url) => `/api/gbfs?url=${encodeURIComponent(url)}`;

function pickFeed(discovery, name) {
  const langs = discovery?.data ?? {};
  for (const key of Object.keys(langs)) {
    const feeds = langs[key]?.feeds;
    const hit = Array.isArray(feeds) ? feeds.find((f) => f.name === name) : null;
    if (hit?.url) return hit.url;
  }
  // GBFS 3.x drops the language keying.
  const feeds = discovery?.data?.feeds;
  return Array.isArray(feeds) ? feeds.find((f) => f.name === name)?.url : null;
}

function availabilityColor(free, capacity) {
  if (!capacity) return '#8a9a97';
  const ratio = free / capacity;
  if (ratio <= 0.05) return '#ff5c5c';
  if (ratio <= 0.25) return '#ffb648';
  return '#50e3c2';
}

export class BikeshareLayer extends PointLayer {
  constructor() {
    super({
      id: 'bikeshare',
      name: 'Bikeshare',
      short: 'BIKE',
      kind: 'bike',
      color: '#50e3c2',
      hotkey: '8',
      cadenceMs: 60_000,
      viewportDriven: true,
      maxCameraHeight: 120_000,
      iconSize: 18,
      labelMaxDistance: 6_000,
      attribution: { label: 'Operator GBFS feeds', url: 'https://github.com/MobilityData/gbfs' },
      note: 'Dock counts are the operator’s own numbers, typically refreshed every 10–60 s. A bike shown as available can still be broken or already claimed.',
    });
    this._systemCache = new Map();
  }

  /** Systems whose service area plausibly covers the current view. */
  #systemsNear(lat, lon) {
    return registry.systems.filter(
      (s) => haversine(lat, lon, s.lat, s.lon) < (s.radiusKm + 25) * 1000,
    );
  }

  async #loadSystem(system, signal) {
    let cached = this._systemCache.get(system.id);
    if (!cached || Date.now() - cached.at > 6 * 60 * 60 * 1000) {
      const discovery = await fetchJson(via(system.url), { signal, timeoutMs: 15_000 });
      cached = {
        at: Date.now(),
        info: pickFeed(discovery, 'station_information'),
        status: pickFeed(discovery, 'station_status'),
      };
      this._systemCache.set(system.id, cached);
    }
    if (!cached.info || !cached.status) throw new Error(`${system.name}: feed has no station data`);

    const [info, status] = await Promise.all([
      fetchJson(via(cached.info), { signal, timeoutMs: 15_000 }),
      fetchJson(via(cached.status), { signal, timeoutMs: 15_000 }),
    ]);

    const byId = new Map(
      (status.data?.stations ?? []).map((s) => [String(s.station_id), s]),
    );

    return (info.data?.stations ?? []).map((s) => {
      const live = byId.get(String(s.station_id)) ?? {};
      const bikes = live.num_bikes_available ?? 0;
      const docks = live.num_docks_available ?? 0;
      const capacity = s.capacity ?? bikes + docks;
      return {
        id: `${system.id}:${s.station_id}`,
        label: `${bikes}`,
        sub: s.name ?? '',
        lat: Number(s.lat),
        lon: Number(s.lon),
        color: availabilityColor(bikes, capacity),
        scale: 0.9,
        meta: {
          system: system.name,
          station: s.name,
          bikesAvailable: bikes,
          ebikesAvailable: live.num_ebikes_available ?? null,
          docksAvailable: docks,
          capacity,
          renting: live.is_renting === 1 || live.is_renting === true,
          returning: live.is_returning === 1 || live.is_returning === true,
          reportedAt: live.last_reported ? new Date(live.last_reported * 1000).toISOString() : null,
        },
        fixAt: live.last_reported ? live.last_reported * 1000 : Date.now(),
      };
    });
  }

  async fetchPoints(ctx, signal) {
    const { lat, lon } = ctx.focus();
    const systems = this.#systemsNear(lat, lon);
    if (!systems.length) {
      return { points: [], state: FRESHNESS.IDLE, note: 'no known system in view' };
    }

    const settled = await Promise.allSettled(systems.map((s) => this.#loadSystem(s, signal)));
    const points = settled.filter((r) => r.status === 'fulfilled').flatMap((r) => r.value);
    const failed = settled.filter((r) => r.status === 'rejected').length;

    if (!points.length && failed) throw new Error(`all ${failed} bikeshare feeds failed`);

    return {
      points: points.filter((p) => haversine(lat, lon, p.lat, p.lon) < ctx.viewRadiusMeters() * 1.5),
      state: failed ? FRESHNESS.PARTIAL : FRESHNESS.LIVE,
      note: failed
        ? `${points.length} docks · ${failed} feed(s) down`
        : `${points.length} docks · ${systems.map((s) => s.name).join(', ')}`,
    };
  }
}
