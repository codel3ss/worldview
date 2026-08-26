import './style.css';
import { bus } from './core/eventBus.js';
import { MapStackController, MAP_STACKS } from './globe/mapStack.js';
import { SensorController } from './globe/sensorModes.js';
import { SelectionController } from './core/selection.js';
import { ROSTER_RADIUS_M, UI } from './ui/ui.js';
import { haversine } from './util/geo.js';
import {
  applyCamera,
  cameraFocus,
  cameraHeight,
  createViewer,
  flyTo,
  viewRadiusMeters,
  viewRectangle,
} from './globe/viewer.js';
import { decodeState, encodeState } from './core/shareUrl.js';

import { AircraftLayer, MilitaryAircraftLayer } from './layers/aircraft.js';
import { SatelliteLayer } from './layers/satellites.js';
import { EarthquakeLayer } from './layers/earthquakes.js';
import { FireLayer } from './layers/fires.js';
import { VesselLayer } from './layers/vessels.js';
import { LaunchLayer } from './layers/launches.js';
import { BikeshareLayer } from './layers/bikeshare.js';
import { RadioLayer } from './layers/radio.js';
import { TrafficLayer } from './layers/traffic.js';

/** Somewhere with dense traffic in most feeds, for a first-run view. */
const DEFAULT_VIEW = { lat: 40.6892, lon: -74.0221, height: 9_000, heading: 25, pitch: -35 };

class App {
  constructor() {
    this.layers = [
      new AircraftLayer(),
      new MilitaryAircraftLayer(),
      new SatelliteLayer(),
      new EarthquakeLayer(),
      new FireLayer(),
      new VesselLayer(),
      new LaunchLayer(),
      new BikeshareLayer(),
      new RadioLayer(),
      new TrafficLayer(),
    ];
    this.registry = new Map(this.layers.map((l) => [l.id, l]));
    this.radio = this.registry.get('radio');
  }

  async start() {
    const boot = (line) => this.ui?.boot(line) ?? console.info(line);

    const capabilities = await this.#loadCapabilities();
    this.capabilities = capabilities;

    this.viewer = createViewer('globe', { ionToken: capabilities.cesiumIonToken });
    this.ctx = {
      viewer: this.viewer,
      capabilities,
      focus: () => cameraFocus(this.viewer),
      cameraHeight: () => cameraHeight(this.viewer),
      viewRadiusMeters: () => viewRadiusMeters(this.viewer),
      viewBox: () => viewRectangle(this.viewer),
    };

    this.mapStack = new MapStackController(this.viewer, capabilities);
    this.sensor = new SensorController(this.viewer);
    this.selection = new SelectionController(this.viewer, this.registry);
    this.ui = new UI(this);

    const restored = decodeState();

    // Camera before imagery: Google's tileset streams around wherever we are
    // pointing, so setting the view first avoids pulling tiles over the
    // Atlantic and throwing them away.
    applyCamera(this.viewer, restored?.camera ?? DEFAULT_VIEW);

    const stackId = restored?.mapStack && this.mapStack.available(restored.mapStack)
      ? restored.mapStack
      : this.mapStack.bestAvailable();
    boot(`map stack: ${stackId}`);
    try {
      await this.mapStack.apply(stackId);
    } catch (err) {
      console.error(err);
      await this.mapStack.apply('void');
      this.ui.toast(`Map stack failed (${err.message}) — falling back to void globe`, 'error');
    }
    this.ui.refreshChips();

    if (restored?.sensor) this.setSensor(restored.sensor);

    const wanted = restored?.layers ?? this.layers.filter((l) => l.defaultOn).map((l) => l.id);
    boot(`layers: ${wanted.join(', ') || 'none'}`);
    await Promise.all(wanted.map((id) => this.registry.get(id)?.enable(this.ctx)));

    this.#wireCamera();
    this.ui.renderRoster();
    this.ui.bootDone();

    if (restored?.tracked) {
      // The contact only exists once its layer has had a cycle to load.
      setTimeout(() => {
        const hit = this.selection.select(restored.tracked.layerId, restored.tracked.id);
        if (!hit) this.ui.toast('Shared contact is no longer on its feed', 'warn');
      }, 2500);
    }

    if (!capabilities.googleMaps) {
      this.ui.toast('No Google Maps key — running on OSM imagery. See .env.example.', 'warn');
    }

    bus.emit('app:ready', this);
  }

  async #loadCapabilities() {
    const googleMapsKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';
    const cesiumIonToken = import.meta.env.VITE_CESIUM_ION_TOKEN || '';
    const caps = {
      googleMaps: Boolean(googleMapsKey),
      googleMapsKey,
      cesiumIon: Boolean(cesiumIonToken),
      cesiumIonToken,
      firms: false,
      ais: false,
      tomtom: false,
      proxy: false,
    };
    try {
      const res = await fetch('/api/health', { signal: AbortSignal.timeout(4000) });
      if (res.ok) {
        const body = await res.json();
        Object.assign(caps, body.capabilities, { proxy: true });
      }
    } catch {
      // The proxy is optional for the browser-direct layers; say so rather than
      // pretending the keyed layers are merely "off".
      console.warn('[worldview] proxy not reachable — keyed and proxied layers are unavailable');
    }
    return caps;
  }

  #wireCamera() {
    let timer = null;
    const settle = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        for (const layer of this.layers) layer.onCameraSettled();
        this.ui.renderRoster();
      }, 450);
    };
    this.viewer.camera.moveEnd.addEventListener(settle);
  }

  async toggleLayer(id) {
    const layer = this.registry.get(id);
    if (!layer) return;
    if (layer.enabled) {
      await layer.disable();
      return;
    }
    if (!layer.isAvailable(this.ctx)) {
      this.ui.toast(
        `${layer.name} needs a ${layer.requiresKey} key on the proxy. See .env.example.`,
        'warn',
      );
      return;
    }
    await layer.enable(this.ctx);
  }

  async setMapStack(id) {
    try {
      await this.mapStack.apply(id);
    } catch (err) {
      this.ui.toast(err.message, 'error');
      return;
    }
    this.ui.refreshChips();
  }

  cycleMapStack() {
    const usable = MAP_STACKS.filter((s) => this.mapStack.available(s.id));
    const idx = usable.findIndex((s) => s.id === this.mapStack.current);
    this.setMapStack(usable[(idx + 1) % usable.length].id);
  }

  setSensor(id) {
    this.sensor.apply(id);
    this.ui.refreshChips();
  }

  flyTo(target) {
    this.selection.setMode('free');
    return flyTo(this.viewer, target);
  }

  /** Acquire the contact closest to where the camera is looking. */
  selectNearest() {
    const focus = this.ctx.focus();
    let best = null;
    for (const layer of this.layers) {
      if (!layer.enabled) continue;
      for (const record of layer.records.values()) {
        const p = record.positionNow?.() ?? record;
        const d = haversine(focus.lat, focus.lon, p.lat, p.lon);
        if (d > ROSTER_RADIUS_M) continue;
        if (!best || d < best.d) best = { d, layerId: layer.id, id: record.id };
      }
    }
    return best ? this.selection.select(best.layerId, best.id) : null;
  }

  /** Resolve a typed ICAO hex / MMSI / NORAD id against loaded contacts. */
  findByHex(query) {
    const q = query.trim().toLowerCase();
    for (const layer of this.layers) {
      if (!layer.enabled) continue;
      for (const record of layer.records.values()) {
        if (record.id?.toLowerCase() === q || record.meta?.hex?.toLowerCase() === q) {
          return { layer, record };
        }
      }
    }
    return null;
  }

  shareUrl() {
    return encodeState({
      viewer: this.viewer,
      layers: this.layers,
      sensor: this.sensor.current,
      mapStack: this.mapStack.current,
      tracked: this.selection.selected
        ? { layerId: this.selection.selected.layerId, id: this.selection.selected.id }
        : null,
    });
  }
}

const app = new App();
window.worldview = app;
app.start().catch((err) => {
  console.error(err);
  const log = document.getElementById('boot-log');
  if (log) log.innerHTML = `<span style="color:#ff5c5c">startup failed: ${err.message}</span>`;
});
