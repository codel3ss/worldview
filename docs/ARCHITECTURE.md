# Architecture

Vanilla JavaScript, CesiumJS, Vite, and a small Express proxy. No framework.
The point is that you can open any file and understand it without learning a
component model first.

```
index.html            CESIUM_BASE_URL + the DOM shell (panels, HUD, dialogs)
src/
  main.js             App: capabilities -> viewer -> layers -> UI, and the wiring
  style.css           The whole visual language, one file
  globe/
    viewer.js         Cesium bootstrap, camera helpers, view geometry
    mapStack.js       Google 3D / ion / OSM / void, and what each one needs
    sensorModes.js    Post-process colour grades (night, thermal, CRT, noir)
  core/
    layer.js          Layer base class: lifecycle, cadence, backoff, freshness
    trackLayer.js     Moving contacts: entity diffing, dead reckoning, trails
    pointLayer.js     Static contacts: wholesale replacement each cycle
    net.js            fetch with timeouts and error classification
    selection.js      Click-to-track, follow-cam, cockpit
    shareUrl.js       Camera + layers + sensor + contact, encoded in the hash
    eventBus.js       Pub/sub
  layers/             One file per feed
  ui/ui.js            Panels, roster, contact readout, status bar, hotkeys
  util/               geo, format, icons, orientation, TLE parsing
server/
  index.js            Express + the AIS WebSocket relay
  routes/feeds.js     One route per metered or CORS-hostile upstream
  lib/cache.js        Disk cache (TTL) and an in-memory LRU for tiles
  lib/upstream.js     The only place that makes outbound calls
```

---

## The layer contract

Everything on the globe is a `Layer`. The base class owns the parts that are
easy to get subtly wrong, so a new feed only has to answer "what does this
return and what does it mean".

```js
class MyLayer extends TrackLayer {   // or PointLayer, or Layer
  constructor() {
    super({
      id, name, color, hotkey,
      cadenceMs,          // how often to poll
      viewportDriven,     // refetch when the camera settles?
      maxCameraHeight,    // stop fetching when zoomed out past this
      requiresKey,        // 'firms' | 'ais' | 'tomtom' | null
      attribution, note,  // shown in the help dialog, verbatim
    });
  }
  async fetchFixes(ctx, signal) { return { fixes, state, note }; }
}
```

The base class handles:

- **Cadence and backoff.** A failing feed backs off exponentially to a five
  minute ceiling instead of hammering a dead endpoint.
- **Zoom gating.** Layers declare the camera heights they are meaningful at.
  Bikeshare does not fetch from orbit; satellites do not vanish when you do.
- **Abort on disable.** Turning a layer off cancels its in-flight request.
- **Freshness.** Every cycle must resolve to one of `live`, `delayed`,
  `partial`, `simulated`, `error`, `unavailable`. The panel prints it.

`TrackLayer` adds entity lifecycle for things that move; `PointLayer` replaces
its entity set wholesale each cycle, which is cheaper for feeds that are small
and churn a lot.

## Interpolation, and saying so

Live feeds land every 15–30 seconds. Rendering them as-is makes tracks
teleport. So each contact carries its last fix plus its own vector, and
`Track.positionNow()` dead-reckons forward from it:

```js
const dt = Math.min(this.ageS, STALE_AFTER_S);
const [lat, lon] = deadReckon(this.lat, this.lon, this.headingDeg, this.speedMps, dt);
```

That value feeds a Cesium `CallbackProperty`, so motion is smooth at frame rate
with no per-frame work of our own. Two rules keep it honest:

1. Extrapolation stops at 120 seconds. A contact past that budget with no new
   report is removed, not frozen in place. A phantom is worse than a gap.
2. The contact panel says *"Position is dead-reckoned Ns from the last report"*
   whenever it is showing an estimate.

## World-stable icons

An aircraft glyph that spins when you orbit the camera is useless. The fix is
one line rather than per-frame screen-space maths: compute the world-space
unit vector along the contact's heading and hand it to `billboard.alignedAxis`.

```js
Transforms.eastNorthUpToFixedFrame(position, undefined, enu);
Cartesian3.fromElements(Math.sin(h), Math.cos(h), 0, local);  // ENU: x east, y north
Matrix4.multiplyByPointAsVector(enu, local, result);
```

Cesium reprojects that axis every frame, so the icon holds true heading from
any camera angle, at any latitude.

## Keys and the proxy

Two classes of credential, deliberately separated:

- **Browser-side** (`VITE_*`): Google Maps and Cesium ion. These *must* reach
  the browser — that is how those services authenticate a client. Restrict them
  by referrer.
- **Proxy-side**: FIRMS, AISStream, TomTom. These never enter the bundle. The
  browser asks `/api/health` for a boolean capability map and gets back
  `{ firms: true, ais: false, ... }` — which layers can run, never the keys.

A layer whose key is missing still appears in the panel, greyed, saying which
key it wants. Silent absence is a worse bug than an honest "no key".

The proxy also exists for upstreams the browser simply cannot talk to: those
requiring a real user agent (Nominatim, radio-browser), those without CORS, and
those whose rate limits demand a shared cache (CelesTrak, Launch Library).

### Running without the proxy

The app must also survive as pure static hosting, where there is no proxy at
all. `src/core/feedRoute.js` resolves each request: proxy path when
`capabilities.proxy` is true, upstream URL when it is not, and `null` for feeds
that need a secret and therefore cannot have a direct form.

`ctx.feed(proxyPath, directUrl)` is handed to every layer, so a layer never
decides this for itself and the two forms of a feed cannot drift apart. Direct
mode gives up the shared cache and moves rate limiting from per-deployment to
per-visitor, which is why it is the fallback rather than the default.

Assets are emitted with a relative `base`, and `CESIUM_BASE_URL` is derived
from `document.baseURI` at runtime, so one bundle works at a domain root or
under a project subpath. The smoke test serves `dist/` under `/worldview/` and
asserts both, because a wrong base path fails as a pile of 404s that is easy to
miss locally.

### SSRF

`/api/gbfs?url=` takes a URL from the client, which would be an open proxy if
left alone. The hostname is checked against the set derived from the bundled
GBFS registry, and non-HTTPS is refused. Every other route builds its own URL.

## Sensor modes

Each mode is a single `PostProcessStage` with a fragment shader — night vision
gains up shadows and adds light-dependent noise, thermal maps luminance through
an ironbow ramp, CRT does barrel distortion plus chromatic separation and
scanlines, noir crushes midtones. They run after the scene renders and touch
only colour. Nothing about the data changes; the sensor chip in the status bar
always says which grade is active.

## Share links

State lives in the URL fragment: camera pose, enabled layers, sensor, map
stack, tracked contact. The fragment is chosen over a query string so a shared
view never lands in a server log. `shareUrl.js` has no Cesium import — it reads
plain numbers off the camera — which is why it is unit-tested directly.

Restoring a tracked contact waits ~2.5 s for its layer to complete a cycle, and
says so plainly if the contact is no longer on its feed.

## Testing

- `npm test` — pure logic in Node: geodesy, formatting (including that missing
  values render as `—` rather than `0`), TLE parsing, share-link round trips.
- `npm run smoke` — the built app in headless Chromium with WebGL. It boots the
  globe, asserts the boot overlay clears, checks the panels rendered, exercises
  every sensor shader (a GLSL compile error only surfaces on apply), and fails
  on any unexpected console error. It forces the `void` map stack so it needs
  no network, and treats feed failures as expected.

## Adding a layer

1. Write `src/layers/yourthing.js` extending `TrackLayer` or `PointLayer`.
2. Fill in `attribution` and `note` honestly — they are shown to users verbatim.
3. Return the right `state`. If the feed is structurally behind, return
   `DELAYED` every time; do not claim `LIVE` because the request succeeded.
4. Register it in the array in `src/main.js` and give it a free hotkey.
5. If it needs a key or a CORS-hostile upstream, add a route in
   `server/routes/feeds.js` and a capability flag in `/api/health`.
6. Add a row to `DATA_SOURCES.md`, including where the feed goes quiet.
