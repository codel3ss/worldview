import { bus } from '../core/eventBus.js';
import { MAP_STACKS } from '../globe/mapStack.js';
import { SENSOR_MODES } from '../globe/sensorModes.js';
import { CAMERA_MODE } from '../core/selection.js';
import { FRESHNESS } from '../core/layer.js';
import { DIRECT } from '../core/feedRoute.js';
import { haversine, bearing } from '../util/geo.js';
import { ago, altitude, bearingLabel, coords, distance, escapeHtml, speed, utcClock } from '../util/format.js';

const $ = (sel) => document.querySelector(sel);

const STATE_LABEL = {
  [FRESHNESS.LIVE]: 'live',
  [FRESHNESS.DELAYED]: 'delayed',
  [FRESHNESS.PARTIAL]: 'partial',
  [FRESHNESS.SIMULATED]: 'simulated',
  [FRESHNESS.ERROR]: 'error',
  [FRESHNESS.UNAVAILABLE]: 'no key',
  [FRESHNESS.IDLE]: 'idle',
};

const STATE_CLASS = {
  [FRESHNESS.LIVE]: 'state-live',
  [FRESHNESS.DELAYED]: 'state-delayed',
  [FRESHNESS.PARTIAL]: 'state-delayed',
  [FRESHNESS.SIMULATED]: 'state-simulated',
  [FRESHNESS.ERROR]: 'state-error',
  [FRESHNESS.UNAVAILABLE]: 'state-error',
  [FRESHNESS.IDLE]: 'state-idle',
};

/** Roster radius — roughly what a wide-area sensor picture would cover. */
export const ROSTER_RADIUS_M = 250_000;

export class UI {
  constructor(app) {
    this.app = app;
    this._rosterTimer = null;
    this.#renderLayers();
    this.#renderMapStacks();
    this.#renderSensors();
    this.#renderHelp();
    this.#wireChrome();
    this.#wireKeys();
    this.#wireJump();

    bus.on('layer:changed', () => this.#renderLayers());
    bus.on('selection:changed', (rec) => this.renderContact(rec));
    bus.on('camera:mode', () => this.renderContact(this.app.selection.record));
    bus.on('toast', (t) => this.toast(t.text, t.level));
    bus.on('radio:changed', () => this.renderContact(this.app.selection.record));

    setInterval(() => this.#tickChrome(), 1000);
    this._rosterTimer = setInterval(() => this.renderRoster(), 3000);
  }

  // --- layers -------------------------------------------------------------
  #renderLayers() {
    const host = $('#layer-list');
    host.innerHTML = this.app.layers
      .map((layer) => {
        const available = layer.isAvailable(this.app.ctx);
        const stateKey = available ? layer.state : FRESHNESS.UNAVAILABLE;
        const detail = layer.enabled
          ? `${STATE_LABEL[stateKey]}${layer.stateNote ? ` · ${escapeHtml(layer.stateNote)}` : ''}`
          : available
            ? 'off'
            : `needs ${layer.requiresKey} key`;
        return `
          <div class="layer-row" data-layer="${layer.id}" data-on="${layer.enabled}" title="${escapeHtml(layer.note)}">
            <span class="swatch" style="background:${layer.color};color:${layer.color}"></span>
            <span class="name">
              ${escapeHtml(layer.name)}
              <small><i class="state-dot ${STATE_CLASS[stateKey]}"></i>${detail}</small>
            </span>
            <span class="count">${layer.enabled && layer.count ? layer.count : layer.hotkey ?? ''}</span>
          </div>`;
      })
      .join('');

    host.querySelectorAll('.layer-row').forEach((row) => {
      row.addEventListener('click', () => this.app.toggleLayer(row.dataset.layer));
    });
  }

  #renderMapStacks() {
    const host = $('#basemap-list');
    host.innerHTML = MAP_STACKS.map((s) => {
      const ok = this.app.mapStack.available(s.id);
      return `<button class="chip" data-stack="${s.id}" ${ok ? '' : 'disabled'} title="${escapeHtml(s.hint)}${ok ? '' : ' — key not configured'}" aria-pressed="${this.app.mapStack.current === s.id}">${s.label}</button>`;
    }).join('');
    host.querySelectorAll('[data-stack]').forEach((btn) => {
      btn.addEventListener('click', () => this.app.setMapStack(btn.dataset.stack));
    });
  }

  #renderSensors() {
    const host = $('#sensor-list');
    host.innerHTML = SENSOR_MODES.map(
      (m) => `<button class="chip" data-sensor="${m.id}" aria-pressed="${this.app.sensor.current === m.id}">${m.label}</button>`,
    ).join('');
    host.querySelectorAll('[data-sensor]').forEach((btn) => {
      btn.addEventListener('click', () => this.app.setSensor(btn.dataset.sensor));
    });
  }

  refreshChips() {
    this.#renderMapStacks();
    this.#renderSensors();
  }

  // --- contact ------------------------------------------------------------
  renderContact(record) {
    const host = $('#contact-body');
    if (!record) {
      host.className = 'empty';
      host.textContent = 'No contact selected. Click any track on the globe.';
      return;
    }
    host.className = '';

    const p = record.positionNow?.() ?? { lat: record.lat, lon: record.lon, altM: record.altM };
    const focus = this.app.ctx.focus();
    const rangeM = haversine(focus.lat, focus.lon, p.lat, p.lon);
    const layer = this.app.registry.get(record.layerId);
    const mode = this.app.selection.mode;

    const rows = [
      ['Position', coords(p.lat, p.lon)],
      ['Altitude', record.kind === 'satellite' || record.altM ? altitude(p.altM) : '—'],
      ['Range', distance(rangeM)],
      ['Bearing', bearingLabel(bearing(focus.lat, focus.lon, p.lat, p.lon))],
      record.speedMps ? ['Speed', speed(record.speedMps)] : null,
      record.headingDeg != null && record.speedMps ? ['Heading', bearingLabel(record.headingNow?.() ?? record.headingDeg)] : null,
      ['Last fix', ago(record.fixAt)],
    ].filter(Boolean);

    const metaRows = Object.entries(record.meta ?? {})
      .filter(([, v]) => v !== null && v !== undefined && v !== '')
      .slice(0, 14)
      .map(([k, v]) => [k.replace(/([A-Z])/g, ' $1').toLowerCase(), String(v)]);

    const dr = record.ageS > 3 && record.speedMps
      ? `<div class="dim" style="margin-top:8px;font-size:10.5px">Position is dead-reckoned ${Math.round(record.ageS)}s from the last report.</div>`
      : '';

    host.innerHTML = `
      <div class="contact-title">${escapeHtml(record.label ?? record.id)}</div>
      <div class="contact-sub">${escapeHtml(record.sub ?? '')} · ${escapeHtml(layer?.name ?? record.layerId)}</div>
      <dl class="kv">${[...rows, ...metaRows]
        .map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`)
        .join('')}</dl>
      ${dr}
      <div class="contact-actions">
        <button data-act="follow" aria-pressed="${mode === CAMERA_MODE.FOLLOW}">${mode === CAMERA_MODE.FOLLOW ? 'FOLLOWING' : 'FOLLOW'}</button>
        ${record.kind === 'aircraft' ? `<button data-act="cockpit" aria-pressed="${mode === CAMERA_MODE.COCKPIT}">COCKPIT</button>` : ''}
        ${record.meta?.stream ? `<button data-act="tune">${this.app.radio?.nowPlaying?.id === record.id ? 'STOP' : 'LISTEN'}</button>` : ''}
        ${record.meta?.url ? `<a href="${escapeHtml(record.meta.url)}" target="_blank" rel="noopener"><button>SOURCE</button></a>` : ''}
        <button data-act="clear">CLEAR</button>
      </div>`;

    host.querySelector('[data-act="follow"]')?.addEventListener('click', () => this.app.selection.toggleFollow());
    host.querySelector('[data-act="cockpit"]')?.addEventListener('click', () => this.app.selection.toggleCockpit());
    host.querySelector('[data-act="clear"]')?.addEventListener('click', () => this.app.selection.clear());
    host.querySelector('[data-act="tune"]')?.addEventListener('click', () => {
      const radio = this.app.radio;
      radio.tune(radio.nowPlaying?.id === record.id ? null : record);
    });
  }

  // --- roster -------------------------------------------------------------
  renderRoster() {
    const host = $('#roster-body');
    const focus = this.app.ctx.focus();
    $('#roster-range').textContent = `≤${ROSTER_RADIUS_M / 1000} km`;

    const rows = [];
    for (const layer of this.app.layers) {
      if (!layer.enabled || layer.state === FRESHNESS.UNAVAILABLE) continue;
      for (const record of layer.records.values()) {
        const p = record.positionNow?.() ?? record;
        const d = haversine(focus.lat, focus.lon, p.lat, p.lon);
        if (d > ROSTER_RADIUS_M) continue;
        rows.push({ record, layer, d });
      }
    }
    rows.sort((a, b) => a.d - b.d);

    if (!rows.length) {
      host.className = 'empty';
      host.textContent = 'No contacts within range. Enable a layer or move the camera.';
      return;
    }

    host.className = '';
    const selectedId = this.app.selection.selected?.id;
    host.innerHTML = rows
      .slice(0, 40)
      .map(
        ({ record, layer, d }) => `
        <div class="roster-item ${record.id === selectedId ? 'selected' : ''}" data-layer="${layer.id}" data-id="${escapeHtml(record.id)}">
          <span class="rk" style="color:${layer.color}">${escapeHtml(record.label ?? record.id)}</span>
          <span class="rd">${distance(d)}</span>
          <span class="rd">${escapeHtml(record.sub ?? layer.short)}</span>
          <span class="rd">${escapeHtml(layer.short)}</span>
        </div>`,
      )
      .join('');

    host.querySelectorAll('.roster-item').forEach((el) => {
      el.addEventListener('click', () => this.app.selection.select(el.dataset.layer, el.dataset.id));
    });

    if (rows.length > 40) {
      host.insertAdjacentHTML('beforeend', `<div class="dim mono" style="margin-top:6px;font-size:10px">+${rows.length - 40} more in range</div>`);
    }
  }

  // --- chrome -------------------------------------------------------------
  #tickChrome() {
    $('#clock').textContent = utcClock();
    const focus = this.app.ctx.focus();
    const live = this.app.layers.filter((l) => l.enabled && l.state === FRESHNESS.LIVE).length;
    const errored = this.app.layers.filter((l) => l.enabled && l.state === FRESHNESS.ERROR);
    const contacts = this.app.layers.reduce((n, l) => n + (l.enabled ? l.count : 0), 0);
    const radio = this.app.radio?.nowPlaying;

    $('#statusbar').innerHTML = [
      `<span>${coords(focus.lat, focus.lon, 3)}</span>`,
      `<span class="sep">|</span><span>EYE <b>${distance(this.app.ctx.cameraHeight())}</b></span>`,
      `<span class="sep">|</span><span>MAP <b>${this.app.mapStack.current}</b></span>`,
      `<span class="sep">|</span><span>SENSOR <b>${this.app.sensor.current}</b></span>`,
      `<span class="sep">|</span><span>CONTACTS <b>${contacts}</b></span>`,
      `<span class="sep">|</span><span>FEEDS <b>${live} live</b></span>`,
      errored.length ? `<span class="sep">|</span><span style="color:var(--alert)">${errored.map((l) => l.short).join(' ')} DOWN</span>` : '',
      radio ? `<span class="sep">|</span><span style="color:var(--accent)">♪ ${escapeHtml(radio.label)}</span>` : '',
    ].join('');
  }

  #wireChrome() {
    $('#btn-share').addEventListener('click', async () => {
      const url = this.app.shareUrl();
      try {
        await navigator.clipboard.writeText(url);
        this.toast('View link copied to clipboard');
      } catch {
        location.hash = new URL(url).hash;
        this.toast('Clipboard blocked — link is in the address bar', 'warn');
      }
    });
    $('#btn-help').addEventListener('click', () => $('#help-dialog').showModal());
  }

  #renderHelp() {
    $('#help-sources').innerHTML = this.app.layers
      .map(
        (l) =>
          `<div><b style="color:${l.color}">${escapeHtml(l.name)}</b> — <a href="${escapeHtml(l.attribution.url)}" target="_blank" rel="noopener">${escapeHtml(l.attribution.label)}</a><br><span style="opacity:0.75">${escapeHtml(l.note)}</span></div>`,
      )
      .join('');
  }

  #wireKeys() {
    window.addEventListener('keydown', (ev) => {
      if (ev.target instanceof HTMLInputElement || ev.metaKey || ev.ctrlKey) return;
      const layer = this.app.layers.find((l) => l.hotkey === ev.key);
      if (layer) {
        this.app.toggleLayer(layer.id);
        return;
      }
      switch (ev.key.toLowerCase()) {
        case 'l':
          document.body.classList.toggle('rails-hidden');
          break;
        case 'm':
          this.app.cycleMapStack();
          break;
        case 'v':
          this.app.setSensor(this.app.sensor.cycle());
          break;
        case 'f':
          this.app.selection.toggleFollow();
          break;
        case 'c':
          this.app.selection.toggleCockpit();
          break;
        case 't':
          // Acquire the nearest contact, or release the one we have.
          if (this.app.selection.selected) this.app.selection.clear();
          else if (!this.app.selectNearest()) this.toast('No contact in range to acquire', 'warn');
          break;
        case 'escape':
          this.app.selection.clear();
          break;
        default:
      }
    });
  }

  #wireJump() {
    const input = $('#jump-input');
    const results = $('#jump-results');
    let timer = null;

    const show = (items) => {
      results.innerHTML = items
        .map(
          (r, i) =>
            `<div class="jr ${i === 0 ? 'active' : ''}" data-lat="${r.lat}" data-lon="${r.lon}" data-h="${r.height ?? 9000}">
               <span>${escapeHtml(r.label)}</span><small>${escapeHtml(r.kind ?? '')}</small>
             </div>`,
        )
        .join('');
      results.querySelectorAll('.jr').forEach((el) => {
        el.addEventListener('click', () => {
          this.app.flyTo({ lat: Number(el.dataset.lat), lon: Number(el.dataset.lon), height: Number(el.dataset.h) });
          results.innerHTML = '';
          input.blur();
        });
      });
    };

    input.addEventListener('input', () => {
      clearTimeout(timer);
      const q = input.value.trim();
      if (q.length < 2) {
        results.innerHTML = '';
        return;
      }

      // "lat,lon" and bare ICAO hex codes resolve locally — no round trip.
      const ll = q.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
      if (ll) {
        show([{ label: `${ll[1]}, ${ll[2]}`, lat: Number(ll[1]), lon: Number(ll[2]), kind: 'coordinates', height: 6000 }]);
        return;
      }
      const hexHit = this.app.findByHex(q);
      if (hexHit) {
        const p = hexHit.record.positionNow?.() ?? hexHit.record;
        show([{ label: `${hexHit.record.label} (${hexHit.layer.name})`, lat: p.lat, lon: p.lon, kind: 'contact', height: Math.max(4000, p.altM + 3000) }]);
        return;
      }

      timer = setTimeout(async () => {
        try {
          const url = this.app.ctx.feed(`/api/geocode?q=${encodeURIComponent(q)}`, DIRECT.geocode(q));
          const res = await fetch(url);
          if (!res.ok) throw new Error(String(res.status));
          const rows = await res.json();
          show(rows.map((r) => ({ ...r, height: 14_000 })));
        } catch {
          results.innerHTML = '<div class="jr"><span class="dim">place search unavailable — try lat,lon instead</span></div>';
        }
      }, 320);
    });

    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') results.querySelector('.jr.active, .jr')?.click();
      if (ev.key === 'Escape') {
        results.innerHTML = '';
        input.blur();
      }
    });
  }

  toast(text, level = 'info') {
    const el = document.createElement('div');
    el.className = `toast ${level}`;
    el.textContent = text;
    $('#toasts').append(el);
    setTimeout(() => el.remove(), 5200);
  }

  boot(line) {
    const log = $('#boot-log');
    if (!log) return;
    log.innerHTML = `${log.innerHTML}${line}<br>`.split('<br>').slice(-3).join('<br>');
  }

  bootDone() {
    document.getElementById('boot')?.classList.add('done');
    setTimeout(() => document.getElementById('boot')?.remove(), 700);
  }
}
