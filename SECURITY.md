# Security and scope

## Reporting

Open an issue for anything non-sensitive. For a vulnerability, contact a
maintainer privately rather than filing publicly.

## Threat model

worldview is meant to run on your own machine, for you. The proxy binds to
`127.0.0.1` on purpose.

**If you expose the proxy to a network you do not control, you are handing out
your API keys.** It has no authentication — anyone who can reach it can spend
your FIRMS, AISStream and TomTom quota. Put auth in front of it first.

### Where credentials live

| Credential | Reaches the browser | Why |
|---|---|---|
| `VITE_GOOGLE_MAPS_API_KEY` | yes | Google Tiles authenticates the client directly. Restrict by HTTP referrer and set a budget alert. |
| `VITE_CESIUM_ION_TOKEN` | yes | Same — ion authenticates the browser. Scope the token to the assets you use. |
| `FIRMS_MAP_KEY` | no | Proxy only |
| `AISSTREAM_API_KEY` | no | Proxy only; the relay holds the upstream socket |
| `TOMTOM_API_KEY` | no | Proxy only; injected into tile URLs server-side |

The browser learns *which* capabilities exist from `/api/health`, which returns
booleans and never key material. Upstream errors are rewritten to strip any key
that appeared in the URL before they are returned or logged.

### Untrusted input

Callsigns, ship names, destinations and radio station names are typed in by
strangers and arrive verbatim from public feeds. Everything rendered into the
DOM goes through `escapeHtml`, which is unit-tested against a script-injection
payload for exactly this reason.

`/api/gbfs?url=` is the one route that takes a URL from the client. Its
hostname must appear in the bundled GBFS registry and the scheme must be HTTPS;
anything else is refused. Without that check it would be an open SSRF proxy.

### Cost, which is a security property here

Google Maps is metered and easy to leave running. The app defaults to
OpenStreetMap when no key is set, and the proxy caches every metered upstream
(TLEs 6 h, FIRMS 10 min, launches 30 min, traffic tiles 3 min, geocoding 24 h)
so a long session does not become a bill.

## Out of scope, permanently

This project does not and will not support:

- searching for, identifying, or tracking a named individual
- face recognition or biometric matching of any kind
- correlating tracks against personal records
- any feature whose primary use is surveilling a specific person

These are refused on purpose, not because they are hard. Pull requests adding
them will be declined.

Aggregated public signals are still capable of harm when pointed at a person.
Point it at the planet.
