/**
 * Where a feed's request should actually go.
 *
 * The proxy exists for caching, for upstreams that demand a real user agent,
 * and for metered keys. But the app is also meant to survive as pure static
 * hosting (GitLab Pages and friends), where there is no proxy at all. For
 * keyless upstreams that permit cross-origin reads, the browser can talk to
 * them directly; that is strictly worse — no shared cache, upstream rate
 * limits apply per visitor — but it is the difference between a working layer
 * and a dead one.
 *
 * Feeds needing a secret have no direct form and must stay unavailable.
 */
export function createFeedRouter(capabilities) {
  return function feed(proxyPath, directUrl) {
    if (capabilities.proxy && proxyPath) return proxyPath;
    if (directUrl) return directUrl;
    return null;
  };
}

/** True when we are talking to upstreams without the proxy in between. */
export const isDirect = (capabilities) => !capabilities.proxy;

/**
 * Upstream URL builders. Kept together so the direct and proxied forms of a
 * feed cannot drift apart unnoticed.
 */
export const DIRECT = {
  celestrak: (group) =>
    `https://celestrak.org/NORAD/elements/gp.php?GROUP=${encodeURIComponent(group)}&FORMAT=tle`,

  launches: (mode, limit) =>
    `https://ll.thespacedevs.com/2.2.0/launch/${mode}/?limit=${limit}&mode=list`,

  radio: ({ lat, lon, distance, limit }) =>
    `https://de1.api.radio-browser.info/json/stations/search?${new URLSearchParams({
      geo_lat: String(lat),
      geo_long: String(lon),
      geo_distance: String(distance),
      has_geo_info: 'true',
      hidebroken: 'true',
      order: 'votes',
      reverse: 'true',
      limit: String(limit),
    })}`,

  // GBFS discovery documents are already absolute operator URLs.
  gbfs: (url) => url,

  geocode: (q) =>
    `https://nominatim.openstreetmap.org/search?${new URLSearchParams({
      q,
      format: 'jsonv2',
      limit: '6',
      addressdetails: '0',
    })}`,
};
