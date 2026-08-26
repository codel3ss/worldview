import {
  ArcType,
  Cartesian2,
  Cartesian3,
  CallbackProperty,
  Color,
  DistanceDisplayCondition,
  HeightReference,
  HorizontalOrigin,
  JulianDate,
  LabelStyle,
  NearFarScalar,
  VerticalOrigin,
} from 'cesium';
import { Layer } from '../core/layer.js';
import { icon } from '../util/icons.js';
import { headingVector } from '../util/orientation.js';
import { deadReckon, lerpHeading } from '../util/geo.js';

const MAX_HISTORY = 240;
/** Stop extrapolating a contact this long after its last fix. */
const STALE_AFTER_S = 120;

/**
 * A contact as the rest of the app sees it. Layers push these in; the UI,
 * roster and selection machinery only ever read this shape.
 */
export class Track {
  constructor(id, layerId, kind) {
    this.id = id;
    this.layerId = layerId;
    this.kind = kind;
    this.label = id;
    this.sub = '';
    this.lat = 0;
    this.lon = 0;
    this.altM = 0;
    this.headingDeg = 0;
    this.speedMps = 0;
    this.verticalRateMps = 0;
    this.fixAt = Date.now();
    this.seenAt = Date.now();
    this.meta = {};
    this.history = [];
    /** Previous fix, so we can ease between two reported positions. */
    this.prev = null;
  }

  update(fix) {
    const now = Date.now();
    if (Number.isFinite(this.lat) && this.history.at(-1)?.[0] !== this.fixAt) {
      this.history.push([this.fixAt, this.lat, this.lon, this.altM]);
      if (this.history.length > MAX_HISTORY) this.history.shift();
    }
    this.prev = { lat: this.lat, lon: this.lon, altM: this.altM, headingDeg: this.headingDeg, at: this.fixAt };
    Object.assign(this, fix);
    this.fixAt = fix.fixAt ?? now;
    this.seenAt = now;
  }

  get ageS() {
    return (Date.now() - this.fixAt) / 1000;
  }

  get isStale() {
    return this.ageS > STALE_AFTER_S;
  }

  /**
   * Where the contact is *now*. Feeds land every 15-30 s, so we run one fix
   * behind and dead-reckon along the contact's own vector in between. This is
   * an estimate and the HUD says so.
   */
  positionNow() {
    const dt = Math.min(this.ageS, STALE_AFTER_S);
    const [lat, lon] = deadReckon(this.lat, this.lon, this.headingDeg, this.speedMps, dt);
    const alt = this.altM + this.verticalRateMps * dt;
    return { lat, lon, altM: alt };
  }

  headingNow() {
    if (!this.prev) return this.headingDeg;
    const t = Math.min(1, this.ageS / 4);
    return lerpHeading(this.prev.headingDeg ?? this.headingDeg, this.headingDeg, t);
  }
}

/**
 * Base for layers whose contacts move. Handles entity lifecycle, the
 * dead-reckoned position callback, world-stable heading and history trails so
 * each concrete layer only has to fetch and map its feed.
 */
export class TrackLayer extends Layer {
  constructor(meta) {
    super(meta);
    this.kind = meta.kind ?? 'contact';
    this.labelMinPixels = meta.labelMinPixels ?? 0;
    this.iconSize = meta.iconSize ?? 30;
    this.showTrail = meta.showTrail ?? true;
    this._entities = new Map();
    this._selectedId = null;
  }

  /** Subclasses return an array of plain fix objects; we diff them into tracks. */
  async fetchFixes(_ctx, _signal) {
    throw new Error('fetchFixes() not implemented');
  }

  async refresh(ctx, signal) {
    const { fixes, state, note } = await this.fetchFixes(ctx, signal);
    const seen = new Set();

    for (const fix of fixes) {
      if (!Number.isFinite(fix.lat) || !Number.isFinite(fix.lon)) continue;
      seen.add(fix.id);
      let track = this.records.get(fix.id);
      if (!track) {
        track = new Track(fix.id, this.id, this.kind);
        Object.assign(track, fix);
        track.fixAt = fix.fixAt ?? Date.now();
        this.records.set(fix.id, track);
        this.#createEntity(track);
      } else {
        track.update(fix);
      }
    }

    // Drop contacts that dropped off the feed and are past their extrapolation
    // budget. Keeping a phantom on screen is worse than losing it.
    for (const [id, track] of this.records) {
      if (seen.has(id)) continue;
      if (track.ageS > STALE_AFTER_S) {
        this.#removeEntity(id);
        this.records.delete(id);
      }
    }

    return { state, note };
  }

  setSelected(id) {
    const prev = this._selectedId;
    this._selectedId = id;
    for (const key of [prev, id]) {
      if (!key) continue;
      const entity = this._entities.get(key);
      if (!entity) continue;
      const selected = key === this._selectedId;
      entity.billboard.color = selected
        ? Color.WHITE
        : Color.fromCssColorString(this.color);
      entity.billboard.scale = selected ? 1.35 : 1.0;
      if (entity.polyline) entity.polyline.show = selected || this.showTrailAlways === true;
    }
  }

  #createEntity(track) {
    const layerColor = Color.fromCssColorString(this.color);
    const scratch = new Cartesian3();

    const positionProperty = new CallbackProperty(() => {
      const p = track.positionNow();
      return Cartesian3.fromDegrees(p.lon, p.lat, p.altM, undefined, scratch);
    }, false);

    const options = {
      id: `${this.id}:${track.id}`,
      position: positionProperty,
      billboard: {
        image: icon(this.kind, this.color, 64),
        width: this.iconSize,
        height: this.iconSize,
        color: layerColor,
        alignedAxis: new CallbackProperty((time, result) => {
          const p = track.positionNow();
          const pos = Cartesian3.fromDegrees(p.lon, p.lat, p.altM);
          return headingVector(pos, track.headingNow(), result ?? new Cartesian3());
        }, false),
        heightReference: this.groundClamped ? HeightReference.CLAMP_TO_GROUND : HeightReference.NONE,
        disableDepthTestDistance: this.groundClamped ? 0 : Number.POSITIVE_INFINITY,
        scaleByDistance: new NearFarScalar(1.0e3, 1.15, 3.0e6, 0.55),
        translucencyByDistance: new NearFarScalar(1.0e3, 1.0, 8.0e6, 0.35),
      },
      label: {
        text: new CallbackProperty(() => track.label, false),
        font: '11px ui-monospace, SFMono-Regular, Menlo, monospace',
        fillColor: layerColor,
        outlineColor: Color.fromCssColorString('#03080c'),
        outlineWidth: 3,
        style: LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cartesian2(0, -this.iconSize * 0.78),
        horizontalOrigin: HorizontalOrigin.CENTER,
        verticalOrigin: VerticalOrigin.BOTTOM,
        distanceDisplayCondition: new DistanceDisplayCondition(0, this.labelMaxDistance ?? 400_000),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        translucencyByDistance: new NearFarScalar(1.0e4, 1.0, 4.0e5, 0.0),
      },
      properties: { trackId: track.id, layerId: this.id },
    };

    if (this.showTrail) {
      options.polyline = {
        positions: new CallbackProperty(() => {
          const pts = track.history.map(([, lat, lon, alt]) => Cartesian3.fromDegrees(lon, lat, alt));
          const p = track.positionNow();
          pts.push(Cartesian3.fromDegrees(p.lon, p.lat, p.altM));
          return pts.length > 1 ? pts : [];
        }, false),
        width: 1.6,
        material: layerColor.withAlpha(0.55),
        arcType: ArcType.NONE,
        show: false,
      };
    }

    const entity = this.dataSource.entities.add(options);

    this._entities.set(track.id, entity);
  }

  #removeEntity(id) {
    const entity = this._entities.get(id);
    if (entity) this.dataSource.entities.remove(entity);
    this._entities.delete(id);
  }

  async onDisable() {
    this._entities.clear();
    this._selectedId = null;
  }
}

export { JulianDate };
