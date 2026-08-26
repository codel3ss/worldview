const NBSP = ' ';

export const pad = (n, w = 2) => String(n).padStart(w, '0');

export function utcClock(d = new Date()) {
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}Z`;
}

export function utcStamp(d = new Date()) {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${utcClock(d)}`;
}

/** "12s ago" / "4m ago" / "2h ago" — for freshness readouts. */
export function ago(ms) {
  if (ms == null || !Number.isFinite(ms)) return '—';
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

export const num = (v, digits = 0) =>
  v == null || !Number.isFinite(v) ? '—' : v.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits });

export const metersToFeet = (m) => m * 3.280839895;
export const feetToMeters = (ft) => ft / 3.280839895;
export const knotsToMps = (kt) => kt * 0.514444;
export const kmToNm = (km) => km / 1.852;

export function altitude(meters) {
  if (meters == null || !Number.isFinite(meters)) return '—';
  return `${num(metersToFeet(meters))}${NBSP}ft`;
}

export function speed(mps) {
  if (mps == null || !Number.isFinite(mps)) return '—';
  return `${num(mps / 0.514444)}${NBSP}kt`;
}

export function distance(meters) {
  if (meters == null || !Number.isFinite(meters)) return '—';
  if (meters < 1000) return `${num(meters)}${NBSP}m`;
  return `${num(meters / 1000, meters < 100000 ? 1 : 0)}${NBSP}km`;
}

export function bearingLabel(deg) {
  if (deg == null || !Number.isFinite(deg)) return '—';
  const points = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const idx = Math.round((((deg % 360) + 360) % 360) / 22.5) % 16;
  return `${pad(Math.round(deg), 3)}° ${points[idx]}`;
}

export function coords(lat, lon, digits = 4) {
  if (lat == null || lon == null) return '—';
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lon >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(digits)}°${ns} ${Math.abs(lon).toFixed(digits)}°${ew}`;
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
