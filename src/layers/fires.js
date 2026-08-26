import { FRESHNESS } from '../core/layer.js';
import { fetchText } from '../core/net.js';
import { PointLayer } from './pointLayer.js';

/** Minimal CSV reader — FIRMS returns a flat, quote-free table. */
function parseCsv(text) {
  const [header, ...rows] = text.trim().split(/\r?\n/);
  if (!header) return [];
  const cols = header.split(',');
  return rows
    .filter(Boolean)
    .map((line) => Object.fromEntries(line.split(',').map((v, i) => [cols[i], v])));
}

const CONFIDENCE_COLOR = { l: '#ffd93c', n: '#ff9a3c', h: '#ff5c5c' };

export class FireLayer extends PointLayer {
  constructor() {
    super({
      id: 'fires',
      name: 'Active fire',
      short: 'FIRE',
      kind: 'fire',
      color: '#ff7a3c',
      hotkey: '5',
      cadenceMs: 10 * 60_000,
      viewportDriven: true,
      maxCameraHeight: 6_000_000,
      iconSize: 20,
      requiresKey: 'firms',
      attribution: { label: 'NASA FIRMS (VIIRS/MODIS)', url: 'https://firms.modaps.eosdis.nasa.gov/' },
      note: 'Thermal anomalies detected from orbit, not confirmed fires — flares, furnaces and hot roofs also trigger them. Each satellite passes only a few times a day, so absence is not evidence of no fire.',
    });
  }

  async fetchPoints(ctx, signal) {
    const box = ctx.viewBox();
    if (!box) return { points: [], state: FRESHNESS.IDLE, note: 'zoom in to query FIRMS' };

    const area = [box.minLon, box.minLat, box.maxLon, box.maxLat].map((v) => v.toFixed(3)).join(',');
    const text = await fetchText(`/api/firms?area=${encodeURIComponent(area)}&days=1`, {
      signal,
      timeoutMs: 25_000,
    });

    let newest = 0;
    const points = parseCsv(text)
      .map((r, i) => {
        const lat = Number(r.latitude);
        const lon = Number(r.longitude);
        // acq_date + acq_time (HHMM) are UTC.
        const hhmm = String(r.acq_time ?? '0000').padStart(4, '0');
        const at = Date.parse(`${r.acq_date}T${hhmm.slice(0, 2)}:${hhmm.slice(2)}:00Z`);
        newest = Math.max(newest, at || 0);
        const conf = String(r.confidence ?? '').toLowerCase();
        return {
          id: `${r.latitude},${r.longitude},${r.acq_date},${r.acq_time},${i}`,
          label: '',
          sub: r.satellite ?? '',
          lat,
          lon,
          color: CONFIDENCE_COLOR[conf] ?? this.color,
          scale: Math.max(0.6, Math.min(1.8, Number(r.frp ?? 1) / 25)),
          meta: {
            brightnessK: Number(r.bright_ti4 ?? r.brightness) || null,
            fireRadiativePowerMW: Number(r.frp) || null,
            confidence: r.confidence,
            satellite: r.satellite,
            instrument: r.instrument,
            dayNight: r.daynight === 'D' ? 'day' : 'night',
            acquiredUtc: Number.isFinite(at) ? new Date(at).toISOString() : null,
          },
          fixAt: at,
        };
      })
      .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));

    const lagH = newest ? (Date.now() - newest) / 3_600_000 : Infinity;
    return {
      points,
      // FIRMS is inherently a few hours behind — never claim it is live.
      state: points.length === 0 ? FRESHNESS.PARTIAL : FRESHNESS.DELAYED,
      note: points.length
        ? `${points.length} detections · newest ${lagH.toFixed(1)}h old`
        : 'no detections in view (last 24h)',
    };
  }
}
