# worldview

A god's-eye view of the planet, in a browser tab. Aircraft, satellites, ships,
seismic events, fires and other public signals, drawn on a 3D globe in as close
to real time as their feeds allow.

Nothing here is classified, scraped or reverse-engineered. Every track comes
from a feed its operator publishes deliberately — transponder aggregators,
orbital element catalogues, seismic networks, transit APIs. The interesting
part is not the data; it is what happens when you put all of it in the same
place, in three dimensions, at the same instant.

Inspired by [bilawalsidhu/gods-eye-view](https://github.com/bilawalsidhu/gods-eye-view).

---

## Run it

```bash
cp .env.example .env      # optional — see "Keys" below
npm install
npm run dev
```

Open <http://localhost:4173>.

`npm run dev` starts two processes: Vite for the app, and a small Node proxy
that holds any metered API keys so they never reach the browser. The app works
with the proxy down — you just lose the layers that need it.

**With zero keys and no `.env` at all**, you get: the globe on OpenStreetMap
imagery, live aircraft, military aircraft, satellites, earthquakes, launches,
bikeshare and radio. That is 7 of the 10 layers.

## Keys

| Key | Unlocks | Cost | Where it lives |
|---|---|---|---|
| `VITE_GOOGLE_MAPS_API_KEY` | Photorealistic 3D Tiles — real buildings and terrain | **metered** | browser |
| `VITE_CESIUM_ION_TOKEN` | Cesium ion imagery + world terrain | free tier | browser |
| `FIRMS_MAP_KEY` | NASA active fire detections | free | proxy only |
| `AISSTREAM_API_KEY` | Live vessel positions | free | proxy only |
| `TOMTOM_API_KEY` | Road traffic flow overlay | free tier | proxy only |

Google Maps is the only one that will bill you, and it is the one that makes
the planet look like a planet. **Restrict it by HTTP referrer and set a budget
alert before you use it.** The other four are free-tier signups.

Keys marked "proxy only" are read by `server/index.js` from `.env` and never
appear in the bundle. `VITE_`-prefixed keys are compiled into the JavaScript by
design — that is how Cesium and Google Tiles authenticate from the browser, and
it is why referrer restrictions matter.

## Layers

| Layer | Source | Key | Notes |
|---|---|---|---|
| Aircraft | adsb.lol | — | Around the current view, 250 NM cap |
| Military air | adsb.lol military feed | — | Worldwide |
| Satellites | CelesTrak GP element sets | — | SGP4 propagated client-side |
| Seismic | USGS | — | Coloured by depth, sized by magnitude |
| Active fire | NASA FIRMS | `FIRMS_MAP_KEY` | Thermal anomalies, hours behind |
| Vessels | AISStream | `AISSTREAM_API_KEY` | Pushed over a WebSocket relay |
| Launches | Launch Library 2 | — | Pads, ±30 days |
| Bikeshare | Operator GBFS feeds | — | 14 systems bundled, extensible |
| Radio | radio-browser.info | — | Click a transmitter to listen |
| Traffic flow | TomTom | `TOMTOM_API_KEY` | Raster overlay, not contacts |

## What you can do with it

- **Click any track** for a full contact readout: position, altitude, range and
  bearing from where you are looking, plus everything the feed reported.
- **Follow** a contact and the camera chases it; **cockpit** puts you on the
  nose of an aircraft looking down its own heading.
- **Sensor modes** (`V`) re-grade the scene: night vision, thermal ironbow,
  CRT, noir. They change how it reads, never what it says.
- **Map stack** (`M`) switches between Google 3D, Cesium ion, OSM and a bare
  graticule globe with nothing but tracks on it.
- **Share** copies a link that restores your exact camera, layers, sensor mode
  and tracked contact. It is all in the URL fragment, so it never hits a server.
- **Roster** lists every contact within 250 km of where you are looking,
  nearest first.

Keyboard: `1`–`0` toggle layers, `L` hides the panels, `M` map stack, `V`
sensor, `F` follow, `C` cockpit, `Esc` clears.

## Honesty about the data

Feeds lie, lag and go dark. Rather than hide that, every layer reports its own
state in the panel — `live`, `delayed`, `partial`, `error`, or `no key` — with
a note saying why. Contacts between position reports are **dead-reckoned**
along their last known vector, and the contact panel says so explicitly when it
is extrapolating.

**Do not use this for navigation, emergency response, or any decision where
being wrong matters.** Verify against authoritative sources.

This project does not do named-person search, face recognition, or tracking of
individuals, and pull requests adding them will be declined.

See [DATA_SOURCES.md](DATA_SOURCES.md) for per-feed provenance, refresh rates
and known gaps, and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how it is
put together.

## Development

```bash
npm test        # unit tests — geometry, formatting, TLE parsing, share URLs
npm run lint
npm run build
npm run smoke   # boots the built app in headless Chromium and checks for errors
```

`npm run smoke` runs the whole app in a real browser with WebGL, compiles every
sensor shader, and fails on any unexpected console error. It needs no network:
it forces the zero-network `void` globe and treats feed failures as expected.

Requires Node 20.11+.

## Licence

MIT — see [LICENSE](LICENSE). Bundled datasets and upstream feeds carry their
own terms; see [DATA_SOURCES.md](DATA_SOURCES.md).
