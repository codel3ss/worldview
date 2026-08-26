import {
  Cartesian2,
  Cartesian3,
  Color,
  DistanceDisplayCondition,
  HeightReference,
  LabelStyle,
  NearFarScalar,
  VerticalOrigin,
} from 'cesium';
import { Layer } from '../core/layer.js';
import { icon } from '../util/icons.js';

/**
 * Base for layers whose contacts sit still: seismic events, fire detections,
 * dock stations, transmitters. Each cycle replaces the entity set wholesale —
 * these feeds are small and the churn is not worth diffing.
 */
export class PointLayer extends Layer {
  constructor(meta) {
    super(meta);
    this.kind = meta.kind ?? 'contact';
    this.iconSize = meta.iconSize ?? 22;
    this.groundClamped = meta.groundClamped ?? true;
    this.labelMaxDistance = meta.labelMaxDistance ?? 900_000;
    this._selectedId = null;
    this._halo = null;
  }

  /** Subclasses return `{ points, state, note }`. */
  async fetchPoints(_ctx, _signal) {
    throw new Error('fetchPoints() not implemented');
  }

  async refresh(ctx, signal) {
    const { points, state, note } = await this.fetchPoints(ctx, signal);

    this.dataSource.entities.removeAll();
    this.records.clear();
    this._halo = null;

    for (const p of points) {
      if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon)) continue;
      this.records.set(p.id, { layerId: this.id, kind: this.kind, altM: 0, ...p });
      this.#add(p);
    }

    this.count = this.records.size;
    if (this._selectedId) this.setSelected(this._selectedId);
    return { state, note };
  }

  #add(p) {
    const color = Color.fromCssColorString(p.color ?? this.color);
    const scale = p.scale ?? 1;

    this.dataSource.entities.add({
      id: `${this.id}:${p.id}`,
      position: Cartesian3.fromDegrees(p.lon, p.lat, p.altM ?? 0),
      billboard: {
        image: icon(p.icon ?? this.kind, p.color ?? this.color, 64),
        width: this.iconSize * scale,
        height: this.iconSize * scale,
        color,
        heightReference: this.groundClamped ? HeightReference.CLAMP_TO_GROUND : HeightReference.NONE,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        scaleByDistance: new NearFarScalar(1.0e3, 1.1, 6.0e6, 0.45),
      },
      label: p.label
        ? {
            text: p.label,
            font: '11px ui-monospace, SFMono-Regular, Menlo, monospace',
            fillColor: color,
            outlineColor: Color.fromCssColorString('#03080c'),
            outlineWidth: 3,
            style: LabelStyle.FILL_AND_OUTLINE,
            pixelOffset: new Cartesian2(0, -this.iconSize * scale * 0.8),
            verticalOrigin: VerticalOrigin.BOTTOM,
            heightReference: this.groundClamped ? HeightReference.CLAMP_TO_GROUND : HeightReference.NONE,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            distanceDisplayCondition: new DistanceDisplayCondition(0, p.labelMaxDistance ?? this.labelMaxDistance),
            translucencyByDistance: new NearFarScalar(1.0e4, 1.0, 1.0e6, 0.0),
          }
        : undefined,
      // Some feeds carry a meaningful radius (felt area, viewshed, dock cluster).
      ellipse: p.radiusMeters
        ? {
            semiMajorAxis: p.radiusMeters,
            semiMinorAxis: p.radiusMeters,
            material: color.withAlpha(0.12),
            outline: true,
            outlineColor: color.withAlpha(0.5),
            outlineWidth: 1,
            heightReference: HeightReference.CLAMP_TO_GROUND,
          }
        : undefined,
      properties: { trackId: p.id, layerId: this.id },
    });
  }

  setSelected(id) {
    this._selectedId = id;
  }
}
