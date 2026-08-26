const R = 6371008.8; // mean Earth radius, metres
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

/** Great-circle distance in metres. */
export function haversine(lat1, lon1, lat2, lon2) {
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Initial bearing from point 1 to point 2, degrees clockwise from north. */
export function bearing(lat1, lon1, lat2, lon2) {
  const dLon = rad(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(rad(lat2));
  const x =
    Math.cos(rad(lat1)) * Math.sin(rad(lat2)) -
    Math.sin(rad(lat1)) * Math.cos(rad(lat2)) * Math.cos(dLon);
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

/** Project a point along a bearing. Returns [lat, lon]. */
export function destination(lat, lon, bearingDeg, meters) {
  const d = meters / R;
  const br = rad(bearingDeg);
  const lat1 = rad(lat);
  const lon1 = rad(lon);
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(br));
  const lon2 =
    lon1 + Math.atan2(Math.sin(br) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  return [deg(lat2), ((deg(lon2) + 540) % 360) - 180];
}

/**
 * Dead-reckon a contact forward from its last fix. Live feeds land every
 * 15-30 s; between fixes we advance the track along its own vector so motion
 * reads as motion rather than as teleporting.
 */
export function deadReckon(lat, lon, headingDeg, groundSpeedMps, seconds) {
  if (!Number.isFinite(groundSpeedMps) || !Number.isFinite(headingDeg) || groundSpeedMps <= 0) {
    return [lat, lon];
  }
  return destination(lat, lon, headingDeg, groundSpeedMps * seconds);
}

/** Shortest signed angular difference a -> b in degrees, within (-180, 180]. */
export function angleDelta(a, b) {
  return ((((b - a) % 360) + 540) % 360) - 180;
}

/** Interpolate a heading the short way round the compass. */
export function lerpHeading(a, b, t) {
  return (a + angleDelta(a, b) * t + 360) % 360;
}

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function boundingBox(lat, lon, radiusMeters) {
  const dLat = deg(radiusMeters / R);
  const dLon = deg(radiusMeters / (R * Math.cos(rad(lat)) || 1e-6));
  return {
    minLat: clamp(lat - dLat, -90, 90),
    maxLat: clamp(lat + dLat, -90, 90),
    minLon: lon - dLon,
    maxLon: lon + dLon,
  };
}
