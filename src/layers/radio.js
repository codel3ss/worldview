import { FRESHNESS } from '../core/layer.js';
import { fetchJson } from '../core/net.js';
import { PointLayer } from './pointLayer.js';
import { bus } from '../core/eventBus.js';
import { DIRECT } from '../core/feedRoute.js';

/**
 * Transmitter markers you can actually listen to. Stream URLs come from the
 * community radio-browser index; the audio element plays the operator's own
 * stream directly, so nothing is re-hosted here.
 */
export class RadioLayer extends PointLayer {
  constructor() {
    super({
      id: 'radio',
      name: 'Radio',
      short: 'RF',
      kind: 'radio',
      color: '#ff8fd0',
      hotkey: '9',
      cadenceMs: 10 * 60_000,
      viewportDriven: true,
      maxCameraHeight: 1_500_000,
      iconSize: 20,
      labelMaxDistance: 60_000,
      attribution: { label: 'radio-browser.info community index', url: 'https://www.radio-browser.info/' },
      note: 'Positions are the station’s self-declared location, often a studio or city centre rather than a transmitter site. Streams are third-party and may be geo-blocked or offline.',
    });
    this.audio = null;
    this.nowPlaying = null;
  }

  async fetchPoints(ctx, signal) {
    const { lat, lon } = ctx.focus();
    const distance = Math.round(Math.min(400_000, ctx.viewRadiusMeters()));
    const query = { lat: lat.toFixed(3), lon: lon.toFixed(3), distance, limit: 180 };
    const body = await fetchJson(
      ctx.feed(
        `/api/radio?lat=${query.lat}&lon=${query.lon}&distance=${distance}&limit=180`,
        DIRECT.radio(query),
      ),
      { signal, timeoutMs: 20_000 },
    );

    const points = (Array.isArray(body) ? body : [])
      .filter((s) => Number(s.geo_lat) && Number(s.geo_long) && s.url_resolved)
      .map((s) => ({
        id: s.stationuuid,
        label: s.name?.trim().slice(0, 28) ?? '',
        sub: [s.country, s.tags?.split(',')[0]].filter(Boolean).join(' · '),
        lat: Number(s.geo_lat),
        lon: Number(s.geo_long),
        color: this.color,
        scale: Math.max(0.7, Math.min(1.5, 0.7 + (Number(s.votes) || 0) / 4000)),
        meta: {
          station: s.name?.trim(),
          country: s.country,
          language: s.language,
          tags: s.tags,
          bitrateKbps: s.bitrate,
          codec: s.codec,
          votes: s.votes,
          homepage: s.homepage,
          stream: s.url_resolved,
        },
        fixAt: Date.now(),
      }));

    return {
      points,
      // The index is crowd-maintained; it is a directory, not a live signal.
      state: FRESHNESS.PARTIAL,
      note: `${points.length} stations within ${Math.round(distance / 1000)} km`,
    };
  }

  /** Tune to a station record. Passing null stops playback. */
  tune(record) {
    this.audio?.pause();
    if (!record?.meta?.stream) {
      this.audio = null;
      this.nowPlaying = null;
      bus.emit('radio:changed', null);
      return;
    }
    this.audio = new Audio(record.meta.stream);
    this.audio.crossOrigin = 'anonymous';
    this.audio.volume = 0.7;
    this.audio.play().catch((err) => {
      bus.emit('toast', { level: 'warn', text: `${record.meta.station}: stream refused (${err.name})` });
      this.nowPlaying = null;
      bus.emit('radio:changed', null);
    });
    this.nowPlaying = record;
    bus.emit('radio:changed', record);
  }

  async onDisable() {
    this.tune(null);
  }
}
