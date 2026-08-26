import { FRESHNESS } from '../core/layer.js';
import { fetchJson } from '../core/net.js';
import { TrackLayer } from './trackLayer.js';
import { feetToMeters, kmToNm, knotsToMps } from '../util/format.js';

const EMERGENCY_SQUAWKS = { 7500: 'HIJACK', 7600: 'RADIO FAIL', 7700: 'EMERGENCY' };

/** adsb.lol serves a 250 NM cap per point query. */
const MAX_RADIUS_NM = 250;

function normalise(ac, nowMs) {
  const onGround = ac.alt_baro === 'ground';
  const altFt = onGround ? 0 : Number(ac.alt_baro ?? ac.alt_geom);
  const callsign = (ac.flight ?? '').trim();
  const squawk = String(ac.squawk ?? '');
  const emergency = EMERGENCY_SQUAWKS[squawk] ?? (ac.emergency && ac.emergency !== 'none' ? String(ac.emergency).toUpperCase() : null);

  return {
    id: ac.hex,
    label: callsign || ac.r || ac.hex.toUpperCase(),
    sub: [ac.t, ac.r].filter(Boolean).join(' · '),
    lat: Number(ac.lat),
    lon: Number(ac.lon),
    altM: Number.isFinite(altFt) ? feetToMeters(altFt) : 0,
    headingDeg: Number(ac.track ?? ac.true_heading ?? ac.mag_heading ?? 0),
    speedMps: Number.isFinite(Number(ac.gs)) ? knotsToMps(Number(ac.gs)) : 0,
    verticalRateMps: Number.isFinite(Number(ac.baro_rate)) ? feetToMeters(Number(ac.baro_rate)) / 60 : 0,
    // seen_pos is seconds since the position was last updated.
    fixAt: nowMs - (Number(ac.seen_pos ?? 0) * 1000),
    meta: {
      hex: ac.hex?.toUpperCase(),
      callsign: callsign || null,
      registration: ac.r ?? null,
      typeCode: ac.t ?? null,
      category: ac.category ?? null,
      squawk: squawk || null,
      emergency,
      onGround,
      altitudeFt: onGround ? 'ground' : altFt,
      groundSpeedKt: ac.gs ?? null,
      rssi: ac.rssi ?? null,
      messages: ac.messages ?? null,
    },
  };
}

/** Civil + military ADS-B around the current view. */
export class AircraftLayer extends TrackLayer {
  constructor() {
    super({
      id: 'aircraft',
      name: 'Aircraft',
      short: 'AIR',
      kind: 'aircraft',
      color: '#50e3c2',
      hotkey: '1',
      cadenceMs: 15_000,
      viewportDriven: true,
      maxCameraHeight: 2_600_000,
      iconSize: 26,
      defaultOn: true,
      attribution: { label: 'adsb.lol (community ADS-B)', url: 'https://api.adsb.lol/docs' },
      note: 'Positions are transponder reports relayed by volunteer receivers. Coverage is patchy over oceans and remote terrain, and aircraft can opt out of aggregation.',
    });
  }

  async fetchFixes(ctx, signal) {
    const { lat, lon } = ctx.focus();
    const radiusNm = Math.min(MAX_RADIUS_NM, Math.max(20, Math.round(kmToNm(ctx.viewRadiusMeters() / 1000))));
    const url = `https://api.adsb.lol/v2/lat/${lat.toFixed(3)}/lon/${lon.toFixed(3)}/dist/${radiusNm}`;

    const body = await fetchJson(url, { signal, timeoutMs: 12_000 });
    const nowMs = Number(body.now) || Date.now();
    const list = Array.isArray(body.ac) ? body.ac : [];
    const fixes = list
      .filter((ac) => Number.isFinite(Number(ac.lat)) && Number.isFinite(Number(ac.lon)))
      .map((ac) => normalise(ac, nowMs));

    // A feed that is minutes behind is not "live" — say which.
    const lag = (Date.now() - nowMs) / 1000;
    const state = lag > 60 ? FRESHNESS.DELAYED : FRESHNESS.LIVE;
    const note = `${fixes.length} within ${radiusNm} NM`;

    this.lastRadiusNm = radiusNm;
    return { fixes, state, note };
  }
}

/** Global military ADS-B — a small enough set to render worldwide. */
export class MilitaryAircraftLayer extends TrackLayer {
  constructor() {
    super({
      id: 'aircraft-mil',
      name: 'Military air',
      short: 'MIL',
      kind: 'aircraft',
      color: '#ffb648',
      hotkey: '2',
      cadenceMs: 20_000,
      viewportDriven: false,
      iconSize: 28,
      attribution: { label: 'adsb.lol military feed', url: 'https://api.adsb.lol/docs' },
      note: 'Aircraft flagged as military by the aggregator, worldwide. Flag assignment is heuristic and many state aircraft never broadcast at all.',
    });
  }

  async fetchFixes(ctx, signal) {
    const body = await fetchJson('https://api.adsb.lol/v2/mil', { signal, timeoutMs: 15_000 });
    const nowMs = Number(body.now) || Date.now();
    const fixes = (Array.isArray(body.ac) ? body.ac : [])
      .filter((ac) => Number.isFinite(Number(ac.lat)) && Number.isFinite(Number(ac.lon)))
      .map((ac) => normalise(ac, nowMs));
    return { fixes, state: FRESHNESS.LIVE, note: `${fixes.length} worldwide` };
  }
}
