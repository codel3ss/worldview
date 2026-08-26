import { CustomDataSource } from 'cesium';
import { bus } from './eventBus.js';

/**
 * Freshness vocabulary. Layers must report one of these on every cycle; the
 * UI surfaces it verbatim so a stale or modelled feed never masquerades as
 * live truth.
 */
export const FRESHNESS = {
  IDLE: 'idle',
  LIVE: 'live',
  DELAYED: 'delayed',
  PARTIAL: 'partial',
  SIMULATED: 'simulated',
  ERROR: 'error',
  UNAVAILABLE: 'unavailable',
};

let seq = 0;

/**
 * Base class for every data layer.
 *
 * Lifecycle:
 *   enable()  -> creates a CustomDataSource, starts the refresh loop
 *   refresh() -> subclass fetches and renders (called on cadence + camera move)
 *   tick()    -> called each frame for interpolation / dead reckoning
 *   disable() -> tears everything down; layers must leave no entities behind
 */
export class Layer {
  constructor(meta) {
    this.id = meta.id;
    this.name = meta.name;
    this.short = meta.short ?? meta.name;
    this.color = meta.color ?? '#50e3c2';
    this.hotkey = meta.hotkey ?? null;
    this.cadenceMs = meta.cadenceMs ?? 30_000;
    this.viewportDriven = meta.viewportDriven ?? false;
    /** Max camera height (m) above which the layer stops fetching. */
    this.maxCameraHeight = meta.maxCameraHeight ?? Infinity;
    this.minCameraHeight = meta.minCameraHeight ?? 0;
    this.requiresKey = meta.requiresKey ?? null;
    this.attribution = meta.attribution ?? { label: 'unknown', url: '#' };
    this.note = meta.note ?? '';
    this.defaultOn = meta.defaultOn ?? false;

    this.enabled = false;
    this.state = FRESHNESS.IDLE;
    this.stateNote = '';
    this.lastFetchAt = null;
    this.lastSuccessAt = null;
    this.count = 0;
    this.records = new Map();

    this.dataSource = null;
    this.ctx = null;
    this._timer = null;
    this._inflight = null;
    this._failures = 0;
    this._uid = `layer-${this.id}-${++seq}`;
  }

  /** True when the layer can run given the current key set. */
  isAvailable(ctx) {
    if (!this.requiresKey) return true;
    return Boolean(ctx.capabilities?.[this.requiresKey]);
  }

  async enable(ctx) {
    if (this.enabled) return;
    this.ctx = ctx;
    this.enabled = true;
    this.dataSource = new CustomDataSource(this._uid);
    await ctx.viewer.dataSources.add(this.dataSource);
    this.dataSource.show = true;

    if (!this.isAvailable(ctx)) {
      this.setState(FRESHNESS.UNAVAILABLE, `needs ${this.requiresKey}`);
      bus.emit('layer:changed', this);
      return;
    }

    await this.onEnable?.(ctx);
    this.#schedule(0);
    bus.emit('layer:changed', this);
  }

  async disable() {
    if (!this.enabled) return;
    this.enabled = false;
    clearTimeout(this._timer);
    this._timer = null;
    this._inflight?.abort?.('layer disabled');
    this._inflight = null;
    await this.onDisable?.();
    if (this.dataSource) {
      this.dataSource.entities.removeAll();
      this.ctx?.viewer.dataSources.remove(this.dataSource, true);
      this.dataSource = null;
    }
    this.records.clear();
    this.count = 0;
    this.setState(FRESHNESS.IDLE, '');
    bus.emit('layer:changed', this);
  }

  setState(state, note = '') {
    this.state = state;
    this.stateNote = note;
  }

  /** Called by the app when the camera settles, for viewport-driven layers. */
  onCameraSettled() {
    if (!this.enabled || !this.viewportDriven) return;
    this.#schedule(0);
  }

  /** Per-frame hook. Default is a no-op; movers override it. */
  tick() {}

  #schedule(delay) {
    clearTimeout(this._timer);
    if (!this.enabled) return;
    this._timer = setTimeout(() => this.#run(), delay);
  }

  async #run() {
    if (!this.enabled) return;

    const height = this.ctx.cameraHeight();
    if (height > this.maxCameraHeight || height < this.minCameraHeight) {
      this.setState(FRESHNESS.IDLE, height > this.maxCameraHeight ? 'zoom in to load' : 'zoom out to load');
      this.dataSource.entities.removeAll();
      this.records.clear();
      this.count = 0;
      bus.emit('layer:changed', this);
      this.#schedule(this.cadenceMs);
      return;
    }

    const ctrl = new AbortController();
    this._inflight = ctrl;
    this.lastFetchAt = Date.now();

    try {
      const result = await this.refresh(this.ctx, ctrl.signal);
      if (!this.enabled) return;
      this._failures = 0;
      this.lastSuccessAt = Date.now();
      this.count = this.records.size;
      if (result?.state) this.setState(result.state, result.note ?? '');
      else this.setState(FRESHNESS.LIVE, '');
      this.#schedule(this.cadenceMs);
    } catch (err) {
      if (!this.enabled) return;
      this._failures += 1;
      this.setState(FRESHNESS.ERROR, err?.message || 'feed failed');
      // Exponential backoff, capped, so a dead feed does not spin.
      const backoff = Math.min(this.cadenceMs * 2 ** this._failures, 5 * 60_000);
      console.warn(`[${this.id}] ${err?.message}`);
      this.#schedule(backoff);
    } finally {
      this._inflight = null;
      bus.emit('layer:changed', this);
    }
  }

  /** Subclasses implement this. Must populate `this.records`. */
  async refresh(_ctx, _signal) {
    throw new Error('refresh() not implemented');
  }
}
