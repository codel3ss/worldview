import {
  ArcType,
  CallbackProperty,
  Cartesian2,
  Cartesian3,
  Color,
  DistanceDisplayCondition,
  JulianDate,
  LabelStyle,
  Math as CMath,
  NearFarScalar,
  VerticalOrigin,
} from 'cesium';
import { degreesLat, degreesLong, eciToGeodetic, gstime, propagate } from 'satellite.js';
import { FRESHNESS, Layer } from '../core/layer.js';
import { fetchText } from '../core/net.js';
import { icon } from '../util/icons.js';
import { parseTle } from '../util/tle.js';

/**
 * CelesTrak groups. Kept deliberately small: "active" is ~11k objects and
 * propagating that every frame buys nothing you can actually see.
 */
export const SAT_GROUPS = [
  { id: 'stations', label: 'Stations', note: 'ISS, CSS and crewed vehicles' },
  { id: 'visual', label: 'Brightest', note: '~160 naked-eye objects' },
  { id: 'gps-ops', label: 'GPS', note: 'Operational GPS constellation' },
  { id: 'weather', label: 'Weather', note: 'Civil weather satellites' },
  { id: 'geo', label: 'Geostationary', note: 'GEO belt' },
];

const DEFAULT_GROUPS = ['stations', 'visual'];

/**
 * Geodetic position from SGP4 at a wall-clock instant.
 *
 * GMST is recomputed for the same instant used for propagation — reusing a
 * stale sidereal angle is what makes orbit rings visibly drift off their
 * satellites over a session.
 */
function geodeticAt(satrec, date) {
  const pv = propagate(satrec, date);
  if (!pv?.position) return null;
  const gmst = gstime(date);
  const gd = eciToGeodetic(pv.position, gmst);
  if (!Number.isFinite(gd.height)) return null;
  return {
    lat: degreesLat(gd.latitude),
    lon: degreesLong(gd.longitude),
    altM: gd.height * 1000,
    velocity: pv.velocity,
  };
}

export class SatelliteLayer extends Layer {
  constructor() {
    super({
      id: 'satellites',
      name: 'Satellites',
      short: 'SAT',
      kind: 'satellite',
      color: '#9d7bff',
      hotkey: '3',
      // Element sets are good for days; the proxy caches them on disk.
      cadenceMs: 6 * 60 * 60 * 1000,
      attribution: { label: 'CelesTrak GP element sets', url: 'https://celestrak.org/NORAD/elements/' },
      note: 'Positions are SGP4 propagations of published two-line element sets, not observations. Accuracy decays with element age — typically a few km for LEO within a day of epoch.',
    });
    this.groups = new Set(DEFAULT_GROUPS);
    this._sats = [];
    this._orbitEntity = null;
    this._selectedId = null;
  }

  setGroups(groups) {
    this.groups = new Set(groups.length ? groups : DEFAULT_GROUPS);
    if (this.enabled) this.onCameraSettled();
  }

  async refresh(ctx, signal) {
    const groups = [...this.groups];
    const sets = await Promise.all(
      groups.map(async (group) => {
        const text = await fetchText(`/api/celestrak?group=${encodeURIComponent(group)}`, {
          signal,
          timeoutMs: 25_000,
        });
        return parseTle(text).map((s) => ({ ...s, group }));
      }),
    );

    this._sats = sets.flat();
    this.dataSource.entities.removeAll();
    this.records.clear();

    const now = new Date();
    let oldestEpochDays = 0;

    for (const sat of this._sats) {
      const fix = geodeticAt(sat.satrec, now);
      if (!fix) continue;

      const record = {
        id: sat.noradId,
        layerId: this.id,
        kind: 'satellite',
        label: sat.name,
        sub: `NORAD ${sat.noradId} · ${sat.group}`,
        get lat() { return geodeticAt(sat.satrec, new Date())?.lat ?? 0; },
        get lon() { return geodeticAt(sat.satrec, new Date())?.lon ?? 0; },
        get altM() { return geodeticAt(sat.satrec, new Date())?.altM ?? 0; },
        headingDeg: 0,
        speedMps: 0,
        fixAt: Date.now(),
        satrec: sat.satrec,
        meta: {
          noradId: sat.noradId,
          group: sat.group,
          inclinationDeg: CMath.toDegrees(sat.satrec.inclo),
          // Mean motion is radians/minute, so one revolution is 2*pi/no minutes.
          periodMin: sat.periodMin,
          epoch: new Date(sat.epochMs).toISOString(),
        },
        positionNow() {
          return geodeticAt(sat.satrec, new Date()) ?? { lat: 0, lon: 0, altM: 0 };
        },
      };
      const epochAgeDays = (Date.now() - Date.parse(record.meta.epoch)) / 86_400_000;
      oldestEpochDays = Math.max(oldestEpochDays, epochAgeDays);

      this.records.set(record.id, record);
      this.#addEntity(record, sat);
    }

    this.count = this.records.size;
    const state = oldestEpochDays > 7 ? FRESHNESS.DELAYED : FRESHNESS.LIVE;
    return {
      state,
      note: `${this.count} objects · oldest element set ${oldestEpochDays.toFixed(1)}d old`,
    };
  }

  #addEntity(record, sat) {
    const color = Color.fromCssColorString(this.color);
    const scratch = new Cartesian3();

    this.dataSource.entities.add({
      id: `${this.id}:${record.id}`,
      position: new CallbackProperty((time) => {
        const date = JulianDate.toDate(time);
        const fix = geodeticAt(sat.satrec, date);
        if (!fix) return undefined;
        return Cartesian3.fromDegrees(fix.lon, fix.lat, fix.altM, undefined, scratch);
      }, false),
      billboard: {
        image: icon('satellite', this.color, 64),
        width: 24,
        height: 24,
        color,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        scaleByDistance: new NearFarScalar(1.0e6, 1.2, 4.0e7, 0.5),
      },
      label: {
        text: record.label,
        font: '11px ui-monospace, SFMono-Regular, Menlo, monospace',
        fillColor: color,
        outlineColor: Color.fromCssColorString('#03080c'),
        outlineWidth: 3,
        style: LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cartesian2(0, -16),
        verticalOrigin: VerticalOrigin.BOTTOM,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        distanceDisplayCondition: new DistanceDisplayCondition(0, 2.5e7),
        translucencyByDistance: new NearFarScalar(1.0e6, 1.0, 2.0e7, 0.0),
      },
      properties: { trackId: record.id, layerId: this.id },
    });
  }

  /** Draw one full revolution for the selected object. */
  setSelected(id) {
    this._selectedId = id;
    if (this._orbitEntity) {
      this.dataSource.entities.remove(this._orbitEntity);
      this._orbitEntity = null;
    }
    if (!id) return;
    const record = this.records.get(id);
    if (!record) return;

    const periodMin = record.meta.periodMin || 95;
    const steps = 180;
    const start = Date.now();
    const positions = [];
    for (let i = 0; i <= steps; i += 1) {
      const t = new Date(start + (i / steps) * periodMin * 60_000);
      const fix = geodeticAt(record.satrec, t);
      if (fix) positions.push(Cartesian3.fromDegrees(fix.lon, fix.lat, fix.altM));
    }
    if (positions.length < 2) return;

    this._orbitEntity = this.dataSource.entities.add({
      id: `${this.id}:orbit`,
      polyline: {
        positions,
        width: 1.4,
        material: Color.fromCssColorString(this.color).withAlpha(0.6),
        arcType: ArcType.NONE,
      },
    });
  }

  async onDisable() {
    this._sats = [];
    this._orbitEntity = null;
  }
}
