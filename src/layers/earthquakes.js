import { FRESHNESS } from '../core/layer.js';
import { fetchJson } from '../core/net.js';
import { PointLayer } from './pointLayer.js';

const FEEDS = {
  hour: 'all_hour',
  day: 'all_day',
  week: '2.5_week',
  month: '4.5_month',
};

/** Colour by depth: shallow events do the damage, so make depth legible. */
function depthColor(depthKm) {
  if (depthKm < 33) return '#ff5c5c';
  if (depthKm < 70) return '#ff9a3c';
  if (depthKm < 300) return '#ffd93c';
  return '#7aa2ff';
}

export class EarthquakeLayer extends PointLayer {
  constructor() {
    super({
      id: 'quakes',
      name: 'Seismic',
      short: 'SEIS',
      kind: 'quake',
      color: '#ff5c5c',
      hotkey: '4',
      cadenceMs: 5 * 60_000,
      iconSize: 26,
      groundClamped: true,
      defaultOn: true,
      attribution: { label: 'USGS Earthquake Hazards Program', url: 'https://earthquake.usgs.gov/earthquakes/feed/' },
      note: 'Automatic solutions are published within minutes and revised later; magnitude and depth for recent events can change substantially.',
    });
    this.window = 'day';
  }

  setWindow(win) {
    if (!FEEDS[win]) return;
    this.window = win;
    if (this.enabled) this.onCameraSettled();
  }

  async fetchPoints(ctx, signal) {
    const url = `https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/${FEEDS[this.window]}.geojson`;
    const body = await fetchJson(url, { signal, timeoutMs: 15_000 });
    const generated = Number(body.metadata?.generated) || Date.now();

    const points = (body.features ?? []).map((f) => {
      const [lon, lat, depthKm] = f.geometry?.coordinates ?? [];
      const mag = f.properties?.mag;
      return {
        id: f.id,
        label: mag == null ? f.properties?.place : `M${mag.toFixed(1)}`,
        sub: f.properties?.place ?? '',
        lat,
        lon,
        altM: 0,
        color: depthColor(depthKm ?? 0),
        // Magnitude is logarithmic; scale the glyph, not the number.
        scale: Math.max(0.55, Math.min(2.6, ((mag ?? 0) + 1) / 3)),
        // Rough felt-radius cue for anything people would have noticed.
        radiusMeters: mag >= 4.5 ? 10 ** (0.5 * mag + 1.4) : 0,
        meta: {
          magnitude: mag,
          magType: f.properties?.magType,
          depthKm,
          place: f.properties?.place,
          time: f.properties?.time,
          updated: f.properties?.updated,
          status: f.properties?.status,
          tsunami: Boolean(f.properties?.tsunami),
          felt: f.properties?.felt,
          url: f.properties?.url,
        },
        fixAt: f.properties?.time ?? generated,
      };
    });

    const lagMin = (Date.now() - generated) / 60_000;
    return {
      points,
      state: lagMin > 20 ? FRESHNESS.DELAYED : FRESHNESS.LIVE,
      note: `${points.length} events · last ${this.window}`,
    };
  }
}
