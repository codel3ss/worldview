const VERSION = 1;
const deg = (rad) => (rad * 180) / Math.PI;

/**
 * Camera + layers + sensor + tracked contact, encoded in the fragment so a
 * link restores exactly what someone was looking at. Kept in the hash rather
 * than the query string so it never reaches a server log.
 */
export function encodeState({ viewer, layers, sensor, mapStack, tracked }) {
  const { camera } = viewer;
  const carto = camera.positionCartographic;
  const params = new URLSearchParams();
  params.set('v', String(VERSION));
  params.set(
    'c',
    [
      deg(carto.latitude).toFixed(5),
      deg(carto.longitude).toFixed(5),
      Math.round(carto.height),
      Math.round(deg(camera.heading)),
      Math.round(deg(camera.pitch)),
    ].join(','),
  );
  const on = layers.filter((l) => l.enabled).map((l) => l.id);
  if (on.length) params.set('l', on.join(','));
  if (sensor && sensor !== 'normal') params.set('s', sensor);
  if (mapStack) params.set('m', mapStack);
  if (tracked) params.set('t', `${tracked.layerId}:${tracked.id}`);
  return `${location.origin}${location.pathname}#${params}`;
}

export function decodeState(hash = location.hash) {
  const raw = hash.replace(/^#/, '');
  if (!raw) return null;
  const params = new URLSearchParams(raw);
  if (params.get('v') !== String(VERSION)) return null;

  const state = {};
  const c = params.get('c')?.split(',').map(Number);
  if (c?.length === 5 && c.every(Number.isFinite)) {
    state.camera = { lat: c[0], lon: c[1], height: c[2], heading: c[3], pitch: c[4] };
  }
  state.layers = params.get('l')?.split(',').filter(Boolean) ?? null;
  state.sensor = params.get('s') ?? null;
  state.mapStack = params.get('m') ?? null;
  const t = params.get('t');
  if (t?.includes(':')) {
    const [layerId, ...rest] = t.split(':');
    state.tracked = { layerId, id: rest.join(':') };
  }
  return state;
}
