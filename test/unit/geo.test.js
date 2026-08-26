import test from 'node:test';
import assert from 'node:assert/strict';
import { angleDelta, bearing, boundingBox, deadReckon, destination, haversine, lerpHeading } from '../../src/util/geo.js';

test('haversine matches known great-circle distances', () => {
  // JFK -> LHR, ~5540 km.
  const d = haversine(40.6413, -73.7781, 51.4700, -0.4543) / 1000;
  assert.ok(Math.abs(d - 5540) < 25, `expected ~5540 km, got ${d.toFixed(0)}`);
  assert.equal(haversine(10, 20, 10, 20), 0);
});

test('bearing is initial course, not final', () => {
  assert.ok(Math.abs(bearing(0, 0, 10, 0) - 0) < 1e-6);
  assert.ok(Math.abs(bearing(0, 0, 0, 10) - 90) < 1e-6);
  assert.ok(Math.abs(bearing(0, 0, -10, 0) - 180) < 1e-6);
});

test('destination round-trips through haversine', () => {
  const [lat, lon] = destination(48.8566, 2.3522, 42, 120_000);
  const back = haversine(48.8566, 2.3522, lat, lon);
  assert.ok(Math.abs(back - 120_000) < 50, `expected 120 km, got ${back.toFixed(0)} m`);
  assert.ok(Math.abs(bearing(48.8566, 2.3522, lat, lon) - 42) < 0.01);
});

test('dead reckoning advances along the reported vector', () => {
  // 500 kt for 30 s is about 7.7 km.
  const [lat, lon] = deadReckon(51.5, -0.12, 90, 257, 30);
  assert.ok(Math.abs(haversine(51.5, -0.12, lat, lon) - 7710) < 60);
  assert.ok(lon > -0.12, 'heading 090 must move east');
});

test('dead reckoning is a no-op without a usable vector', () => {
  assert.deepEqual(deadReckon(10, 20, NaN, 100, 30), [10, 20]);
  assert.deepEqual(deadReckon(10, 20, 90, 0, 30), [10, 20]);
});

test('heading interpolation takes the short way round', () => {
  assert.equal(angleDelta(350, 10), 20);
  assert.equal(angleDelta(10, 350), -20);
  assert.ok(Math.abs(lerpHeading(350, 10, 0.5) - 0) < 1e-9);
  assert.ok(Math.abs(lerpHeading(10, 350, 0.5) - 0) < 1e-9);
});

test('bounding box clamps at the poles', () => {
  const box = boundingBox(89.9, 0, 500_000);
  assert.equal(box.maxLat, 90);
  assert.ok(box.minLat < 89.9);
});
