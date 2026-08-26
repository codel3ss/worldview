import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeState, encodeState } from '../../src/core/shareUrl.js';

/** Stand-in for the bits of the Cesium camera encodeState actually reads. */
const fakeViewer = (lat, lon, height, headingDeg, pitchDeg) => ({
  camera: {
    positionCartographic: {
      latitude: (lat * Math.PI) / 180,
      longitude: (lon * Math.PI) / 180,
      height,
    },
    heading: (headingDeg * Math.PI) / 180,
    pitch: (pitchDeg * Math.PI) / 180,
  },
});

const layers = [
  { id: 'aircraft', enabled: true },
  { id: 'quakes', enabled: true },
  { id: 'radio', enabled: false },
];

test('a shared view round-trips', () => {
  globalThis.location = { origin: 'https://example.test', pathname: '/' };
  const url = encodeState({
    viewer: fakeViewer(51.5074, -0.1278, 12_345, 30, -40),
    layers,
    sensor: 'thermal',
    mapStack: 'google3d',
    tracked: { layerId: 'aircraft', id: 'a1b2c3' },
  });

  const state = decodeState(new URL(url).hash);
  assert.ok(Math.abs(state.camera.lat - 51.5074) < 1e-4);
  assert.ok(Math.abs(state.camera.lon - -0.1278) < 1e-4);
  assert.equal(state.camera.height, 12_345);
  assert.equal(state.camera.heading, 30);
  assert.equal(state.camera.pitch, -40);
  assert.deepEqual(state.layers, ['aircraft', 'quakes']);
  assert.equal(state.sensor, 'thermal');
  assert.equal(state.mapStack, 'google3d');
  assert.deepEqual(state.tracked, { layerId: 'aircraft', id: 'a1b2c3' });
});

test('the default sensor is omitted rather than encoded', () => {
  globalThis.location = { origin: 'https://example.test', pathname: '/' };
  const url = encodeState({
    viewer: fakeViewer(0, 0, 1000, 0, -90),
    layers: [],
    sensor: 'normal',
    mapStack: 'osm',
    tracked: null,
  });
  assert.ok(!url.includes('s='), url);
  assert.ok(!url.includes('l='), url);
  assert.ok(!url.includes('t='), url);
});

test('unknown or absent state decodes to null instead of throwing', () => {
  assert.equal(decodeState(''), null);
  assert.equal(decodeState('#'), null);
  assert.equal(decodeState('#v=99&c=1,2,3,4,5'), null);
});

test('a malformed camera tuple is dropped, not half-applied', () => {
  const state = decodeState('#v=1&c=notanumber&l=aircraft');
  assert.equal(state.camera, undefined);
  assert.deepEqual(state.layers, ['aircraft']);
});
