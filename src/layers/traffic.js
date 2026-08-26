import { ImageryLayer, UrlTemplateImageryProvider } from 'cesium';
import { FRESHNESS, Layer } from '../core/layer.js';

/**
 * Traffic renders as a raster overlay rather than as contacts. Point-by-point
 * flow queries would burn the free quota in minutes; tiles are one request per
 * screenful and the proxy caches them.
 */
export class TrafficLayer extends Layer {
  constructor() {
    super({
      id: 'traffic',
      name: 'Traffic flow',
      short: 'TRF',
      kind: 'traffic',
      color: '#ff9a3c',
      hotkey: '0',
      cadenceMs: 5 * 60_000,
      maxCameraHeight: 900_000,
      requiresKey: 'tomtom',
      attribution: { label: 'TomTom Traffic Flow tiles', url: 'https://developer.tomtom.com/traffic-api' },
      note: 'Relative speed against free-flow, aggregated from probe vehicles. Typically 1–3 minutes behind and thin on minor roads.',
    });
    this._imagery = null;
  }

  async onEnable(ctx) {
    this._imagery = new ImageryLayer(
      new UrlTemplateImageryProvider({
        url: '/api/tomtom/flow/{z}/{x}/{y}',
        maximumLevel: 18,
        credit: 'Traffic © TomTom',
      }),
      { alpha: 0.85 },
    );
    ctx.viewer.imageryLayers.add(this._imagery);
  }

  async onDisable() {
    if (this._imagery) {
      this.ctx?.viewer.imageryLayers.remove(this._imagery, true);
      this._imagery = null;
    }
  }

  async refresh() {
    // Tiles refresh themselves through the provider; this cycle exists only so
    // the panel can show an honest freshness line.
    if (this._imagery) this._imagery.show = true;
    return { state: FRESHNESS.DELAYED, note: 'raster overlay · ~1-3 min behind' };
  }
}
