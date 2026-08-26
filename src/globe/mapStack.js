import {
  Cesium3DTileset,
  Color,
  EllipsoidTerrainProvider,
  GoogleMaps,
  GridImageryProvider,
  ImageryLayer,
  OpenStreetMapImageryProvider,
  createGooglePhotorealistic3DTileset,
  createWorldImageryAsync,
  createWorldTerrainAsync,
} from 'cesium';

/**
 * The map stack decides what the planet is made of. Each option declares what
 * it needs; anything whose key is missing is offered but disabled, rather than
 * silently absent, so it is obvious why the pretty one is not available.
 */
export const MAP_STACKS = [
  {
    id: 'google3d',
    label: 'Google 3D',
    hint: 'Photorealistic 3D Tiles — real buildings and terrain mesh',
    requires: 'googleMaps',
  },
  {
    id: 'ion',
    label: 'Ion imagery',
    hint: 'Cesium ion world imagery over world terrain',
    requires: 'cesiumIon',
  },
  {
    id: 'osm',
    label: 'OSM',
    hint: 'OpenStreetMap raster — no key required',
    requires: null,
  },
  {
    id: 'void',
    label: 'Void',
    hint: 'Unlit graticule globe — tracks only',
    requires: null,
  },
];

export class MapStackController {
  constructor(viewer, capabilities) {
    this.viewer = viewer;
    this.capabilities = capabilities;
    this.current = null;
    this._tileset = null;
    this._imagery = null;
    this._worldTerrain = null;
  }

  available(id) {
    const stack = MAP_STACKS.find((s) => s.id === id);
    if (!stack) return false;
    return !stack.requires || Boolean(this.capabilities[stack.requires]);
  }

  /** First stack we can actually render, best first. */
  bestAvailable() {
    return MAP_STACKS.find((s) => this.available(s.id))?.id ?? 'void';
  }

  async apply(id) {
    if (!this.available(id)) throw new Error(`map stack "${id}" needs a key it does not have`);
    if (this.current === id) return id;

    this.#teardown();
    const { viewer } = this;

    switch (id) {
      case 'google3d': {
        GoogleMaps.defaultApiKey = this.capabilities.googleMapsKey;
        this._tileset = await createGooglePhotorealistic3DTileset(
          {},
          {
            maximumScreenSpaceError: 16,
            // Google's mesh already bakes in terrain; the ellipsoid globe
            // underneath would z-fight with it.
            skipLevelOfDetail: false,
          },
        );
        viewer.scene.primitives.add(this._tileset);
        viewer.scene.globe.show = false;
        viewer.terrainProvider = new EllipsoidTerrainProvider();
        break;
      }
      case 'ion': {
        viewer.scene.globe.show = true;
        this._worldTerrain ??= await createWorldTerrainAsync({ requestVertexNormals: true });
        viewer.terrainProvider = this._worldTerrain;
        this._imagery = ImageryLayer.fromProviderAsync(createWorldImageryAsync());
        viewer.imageryLayers.add(this._imagery);
        break;
      }
      case 'osm': {
        viewer.scene.globe.show = true;
        viewer.terrainProvider = new EllipsoidTerrainProvider();
        this._imagery = new ImageryLayer(
          new OpenStreetMapImageryProvider({ url: 'https://tile.openstreetmap.org/' }),
        );
        viewer.imageryLayers.add(this._imagery);
        break;
      }
      case 'void': {
        viewer.scene.globe.show = true;
        viewer.terrainProvider = new EllipsoidTerrainProvider();
        this._imagery = new ImageryLayer(
          new GridImageryProvider({
            color: Color.fromCssColorString('#1c3a3a'),
            glowColor: Color.fromCssColorString('#0b1a1a'),
            backgroundColor: Color.fromCssColorString('#040709'),
            cells: 4,
          }),
        );
        viewer.imageryLayers.add(this._imagery);
        break;
      }
      default:
        throw new Error(`unknown map stack "${id}"`);
    }

    this.current = id;
    return id;
  }

  /** Terrain sampling target — Google's mesh is a tileset, not a terrain provider. */
  get hasMeshTerrain() {
    return this.current === 'google3d';
  }

  #teardown() {
    const { viewer } = this;
    if (this._tileset) {
      viewer.scene.primitives.remove(this._tileset);
      this._tileset = null;
    }
    if (this._imagery) {
      viewer.imageryLayers.remove(this._imagery, true);
      this._imagery = null;
    }
    viewer.scene.globe.show = true;
  }
}

export { Cesium3DTileset };
