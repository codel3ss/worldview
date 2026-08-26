import { FRESHNESS } from '../core/layer.js';
import { TrackLayer } from './trackLayer.js';
import { knotsToMps } from '../util/format.js';

const SHIP_TYPE = (code) => {
  const n = Number(code);
  if (n >= 80 && n <= 89) return 'tanker';
  if (n >= 70 && n <= 79) return 'cargo';
  if (n >= 60 && n <= 69) return 'passenger';
  if (n >= 50 && n <= 59) return 'special';
  if (n >= 40 && n <= 49) return 'high-speed';
  if (n >= 30 && n <= 39) return 'fishing/tug';
  return 'other';
};

/**
 * AIS positions arrive as a push stream. The proxy holds the upstream
 * AISStream socket (the key never reaches the browser) and relays reports for
 * whatever box we are looking at; we buffer them and let the normal refresh
 * cadence fold them into tracks.
 */
export class VesselLayer extends TrackLayer {
  constructor() {
    super({
      id: 'vessels',
      name: 'Vessels',
      short: 'SEA',
      kind: 'vessel',
      color: '#4fa8ff',
      hotkey: '6',
      cadenceMs: 4_000,
      viewportDriven: true,
      maxCameraHeight: 4_000_000,
      iconSize: 22,
      requiresKey: 'ais',
      attribution: { label: 'AISStream.io', url: 'https://aisstream.io/' },
      note: 'Terrestrial AIS only — coverage falls away past roughly 40 NM offshore. Transponders can be switched off, and identity fields are self-reported.',
    });
    this._socket = null;
    this._buffer = new Map();
    this._connected = false;
    this._lastBox = null;
  }

  async onEnable() {
    this.#connect();
  }

  async onDisable() {
    this._socket?.close(1000, 'layer disabled');
    this._socket = null;
    this._connected = false;
    this._buffer.clear();
    await super.onDisable();
  }

  #connect() {
    const url = new URL('/api/ais', location.href);
    url.protocol = url.protocol.replace('http', 'ws');
    const socket = new WebSocket(url);
    this._socket = socket;

    socket.addEventListener('open', () => {
      this._connected = true;
      this.#sendBox();
    });
    socket.addEventListener('message', (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'position') this.#ingest(msg.data);
        else if (msg.type === 'error') this.setState(FRESHNESS.ERROR, msg.message);
      } catch {
        /* ignore malformed frames */
      }
    });
    socket.addEventListener('close', () => {
      this._connected = false;
      if (this.enabled) setTimeout(() => this.enabled && this.#connect(), 5_000);
    });
    socket.addEventListener('error', () => {
      this.setState(FRESHNESS.ERROR, 'AIS relay unreachable');
    });
  }

  #sendBox() {
    if (!this._connected || !this._lastBox) return;
    const b = this._lastBox;
    this._socket.send(
      JSON.stringify({
        type: 'subscribe',
        boxes: [[[b.minLat, b.minLon], [b.maxLat, b.maxLon]]],
      }),
    );
  }

  #ingest(v) {
    if (!Number.isFinite(v.lat) || !Number.isFinite(v.lon)) return;
    const id = String(v.mmsi);
    const prev = this._buffer.get(id) ?? {};
    this._buffer.set(id, {
      id,
      label: v.name?.trim() || prev.label || id,
      sub: v.callSign ?? prev.sub ?? '',
      lat: v.lat,
      lon: v.lon,
      altM: 0,
      headingDeg: Number.isFinite(v.cog) ? v.cog : (v.heading ?? prev.headingDeg ?? 0),
      speedMps: Number.isFinite(v.sog) ? knotsToMps(v.sog) : 0,
      verticalRateMps: 0,
      fixAt: v.at ?? Date.now(),
      meta: {
        ...prev.meta,
        mmsi: id,
        imo: v.imo ?? prev.meta?.imo ?? null,
        name: v.name?.trim() ?? prev.meta?.name ?? null,
        callSign: v.callSign ?? null,
        shipType: v.shipType != null ? `${v.shipType} (${SHIP_TYPE(v.shipType)})` : (prev.meta?.shipType ?? null),
        destination: v.destination?.trim() || prev.meta?.destination || null,
        navStatus: v.navStatus ?? prev.meta?.navStatus ?? null,
        sogKt: v.sog ?? null,
        cogDeg: v.cog ?? null,
        draughtM: v.draught ?? prev.meta?.draughtM ?? null,
      },
    });
  }

  async fetchFixes(ctx) {
    const box = ctx.viewBox();
    const changed =
      box &&
      (!this._lastBox ||
        Math.abs(box.minLat - this._lastBox.minLat) > 0.05 ||
        Math.abs(box.minLon - this._lastBox.minLon) > 0.05 ||
        Math.abs(box.maxLat - this._lastBox.maxLat) > 0.05 ||
        Math.abs(box.maxLon - this._lastBox.maxLon) > 0.05);
    if (changed) {
      this._lastBox = box;
      this.#sendBox();
      // A fresh box means the previous contacts are out of area.
      this._buffer.clear();
    }

    const fixes = [...this._buffer.values()];
    if (!this._connected) {
      return { fixes, state: FRESHNESS.ERROR, note: 'AIS relay disconnected — retrying' };
    }
    return {
      fixes,
      state: fixes.length ? FRESHNESS.LIVE : FRESHNESS.PARTIAL,
      note: fixes.length ? `${fixes.length} in area` : 'connected · awaiting reports',
    };
  }
}
