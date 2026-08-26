# Data sources

Every feed used by worldview, what it actually measures, how far behind it is,
and where it goes quiet. The layer panel shows a condensed version of this at
runtime; this file is the long form.

None of these are affiliated with this project. Respect their terms and rate
limits — the proxy caches aggressively for exactly that reason.

---

## Aircraft — adsb.lol

- **Endpoint:** `https://api.adsb.lol/v2/lat/{lat}/lon/{lon}/dist/{nm}` (250 NM cap)
- **Refresh:** every 15 s while the layer is on
- **What it is:** ADS-B transponder broadcasts relayed by volunteer ground
  receivers. Aircraft report their own position from onboard GNSS.
- **Where it breaks:** coverage follows the receiver network, so oceans, deserts
  and mountain shadows are thin or empty. Aircraft can request removal from
  aggregators. Some state aircraft never broadcast. `alt_baro` is pressure
  altitude, not height above ground.
- **Reported as:** `live`, or `delayed` when the feed's own timestamp is more
  than 60 s old.

## Military air — adsb.lol military feed

- **Endpoint:** `https://api.adsb.lol/v2/mil` (worldwide)
- **Refresh:** every 20 s
- **What it is:** the same ADS-B data, filtered to airframes the aggregator has
  flagged as military.
- **Where it breaks:** the flag is heuristic — registry prefixes and known hex
  ranges. Expect both false positives and, far more often, absence: aircraft
  doing anything sensitive are not broadcasting.

## Satellites — CelesTrak

- **Endpoint:** `https://celestrak.org/NORAD/elements/gp.php` (proxied, disk-cached 6 h)
- **Refresh:** element sets every 6 h; positions recomputed every frame
- **What it is:** two-line element sets, propagated in the browser with SGP4
  (`satellite.js`). GMST is recomputed at each propagation instant so orbit
  rings stay locked to their satellites instead of drifting over a session.
- **Where it breaks:** these are *predictions*, not observations. Accuracy
  decays with element age — roughly a few kilometres for LEO within a day of
  epoch, worse after a manoeuvre. The layer reports the age of the oldest
  element set it loaded, and flags `delayed` past 7 days.
- **Groups loaded:** stations and brightest, by default. GPS, weather and
  geostationary are available. "Active" (~11,000 objects) is deliberately not
  offered — it costs a lot of frame time to draw a cloud you cannot read.

## Seismic — USGS

- **Endpoint:** `https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/`
- **Refresh:** every 5 min
- **What it is:** automatic and reviewed hypocentre solutions from the global
  seismic network. Colour encodes depth, glyph size encodes magnitude, and
  events at M4.5+ get a rough felt-radius ring.
- **Where it breaks:** automatic solutions publish within minutes and are
  revised — magnitude and depth for a recent event can move substantially.
  `status: automatic` means no human has looked at it yet.

## Active fire — NASA FIRMS

- **Endpoint:** `https://firms.modaps.eosdis.nasa.gov/api/area/csv/...` (proxied, needs `FIRMS_MAP_KEY`)
- **Refresh:** every 10 min, viewport-scoped, 24 h lookback, VIIRS NOAA-20 NRT
- **What it is:** thermal anomalies detected from orbit — pixels significantly
  hotter than their surroundings.
- **Where it breaks:** an anomaly is not a fire. Gas flares, furnaces, hot
  roofs and even bright sunglint trigger detections. Each satellite passes only
  a few times a day, so a gap means "not observed", never "not burning".
- **Reported as:** always `delayed`. It is structurally hours behind and saying
  otherwise would be a lie.

## Vessels — AISStream

- **Endpoint:** `wss://stream.aisstream.io/v0/stream` (relayed, needs `AISSTREAM_API_KEY`)
- **Refresh:** pushed; folded into tracks every 4 s
- **What it is:** AIS transponder broadcasts. Position and course come from the
  vessel's own equipment; name, destination and draught are typed in by crew.
- **Where it breaks:** this is terrestrial AIS — coverage drops off past roughly
  40 NM from shore. Transponders can be switched off. Identity fields are
  self-reported and are sometimes wrong, stale, or deliberately false.
- **Relay note:** AISStream permits one connection per key, so the proxy holds
  exactly one upstream socket, subscribes to the union of all clients' boxes,
  and fans each report out only to clients whose box contains it.

## Launches — Launch Library 2 (The Space Devs)

- **Endpoint:** `https://ll.thespacedevs.com/2.2.0/launch/` (proxied, cached 30 min)
- **Refresh:** every 30 min; ±30 days shown
- **What it is:** a curated launch schedule with exact pad coordinates.
- **Where it breaks:** pad positions are solid; times are not. `net` is
  "no earlier than" and slips constantly. Anonymous access is rate limited —
  the proxy's cache is what keeps you under it.

## Bikeshare — operator GBFS feeds

- **Endpoint:** each operator's own `gbfs.json` (proxied, allowlisted, cached 45 s)
- **Refresh:** every 60 s when zoomed in past 120 km
- **What it is:** the General Bikeshare Feed Specification — dock locations and
  live availability, published by the operators themselves.
- **Where it breaks:** a bike counted as available can be broken or already
  claimed. Feeds move and shut down; a dead feed reports `partial`, not silence.
- **Registry:** `src/data/local_data/gbfs-systems.json` bundles 14 systems with
  approximate service-area centres, because the official MobilityData registry
  carries no coordinates and cannot be filtered by viewport without fetching
  every feed on Earth. Station coordinates themselves come live and are exact.
  The file documents its own provenance and how to extend it.

## Radio — radio-browser.info

- **Endpoint:** `https://de1.api.radio-browser.info/json/stations/search` (proxied, cached 10 min)
- **Refresh:** every 10 min, viewport-scoped
- **What it is:** a community-maintained index of internet radio streams with
  self-declared geographic coordinates.
- **Where it breaks:** positions are usually a studio or city centre, not a
  transmitter site. Streams are third-party: they go offline, get geo-blocked,
  or refuse cross-origin playback. The layer reports `partial` because it is a
  directory, not a live signal.

## Traffic flow — TomTom

- **Endpoint:** `https://api.tomtom.com/traffic/map/4/tile/flow/...` (proxied, needs `TOMTOM_API_KEY`)
- **Refresh:** tiles, cached 3 min in the proxy
- **What it is:** observed speed relative to free-flow, aggregated from probe
  vehicles, drawn as a raster overlay rather than as contacts.
- **Where it breaks:** typically 1–3 minutes behind, and thin on minor roads
  where there are too few probes to be confident. Rendered as tiles rather than
  point queries specifically so the free tier survives a session.

## Basemaps

- **Google Photorealistic 3D Tiles** — metered, browser-side key. This is the
  layer that costs money; restrict it by referrer and set a budget alert.
- **Cesium ion** — world imagery and world terrain, free tier, browser-side token.
- **OpenStreetMap** — raster tiles, no key. Please do not point a heavy
  deployment at `tile.openstreetmap.org`; it is donated infrastructure.
- **Void** — a bare graticule globe with no imagery at all. Useful when the
  tracks are the point, and the only mode that needs no network whatsoever.

## Place search — Nominatim

Proxied, cached 24 h, capped at 6 results. Their usage policy requires a real
user agent and a low request rate, neither of which a browser can promise —
hence the proxy. Typing `lat,lon` or a contact's hex ID resolves locally with
no request at all.
