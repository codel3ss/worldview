# Contributing

## Before you open a PR

```bash
npm run lint
npm test
npm run build && npm run smoke
```

The smoke test needs no network. If it fails, the app is broken in a browser
even when the unit tests pass.

## House style

- **Vanilla JS.** No framework, no TypeScript, no build magic beyond Vite. If a
  file needs a diagram to explain, it is too clever.
- **Be honest about data.** Every layer reports a freshness state and an
  attribution note that users read verbatim. If a feed is structurally hours
  behind, return `DELAYED` every cycle — do not report `LIVE` because the HTTP
  request happened to succeed. Never render an unknown value as `0`.
- **Comments explain why.** The code already says what.
- **Escape everything from a feed.** Callsigns and vessel names are attacker
  controlled.

## Adding a data layer

See "Adding a layer" in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). In short:
extend `TrackLayer` or `PointLayer`, fill in `attribution` and `note`, register
it in `src/main.js`, add a proxy route if it needs a key, and document where
the feed goes quiet in `DATA_SOURCES.md`.

Respect upstream rate limits. If a feed asks you to cache, cache it in
`server/lib/cache.js` — that is what the disk cache is for.

## What will not be merged

Anything for searching, identifying or tracking a named individual, face
recognition, or correlating tracks against personal records. See
[SECURITY.md](SECURITY.md).
