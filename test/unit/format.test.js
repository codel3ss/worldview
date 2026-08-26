import test from 'node:test';
import assert from 'node:assert/strict';
import { altitude, bearingLabel, coords, distance, escapeHtml, speed } from '../../src/util/format.js';

test('missing values render as an em dash, never as zero', () => {
  for (const fn of [altitude, speed, distance]) {
    assert.equal(fn(null), '—');
    assert.equal(fn(undefined), '—');
    assert.equal(fn(NaN), '—');
  }
  assert.equal(bearingLabel(null), '—');
  assert.equal(coords(null, null), '—');
});

test('unit conversions', () => {
  assert.match(altitude(10_668), /35,000\u00a0ft/); // FL350
  assert.match(speed(257.2), /500\u00a0kt/);
  assert.match(distance(500), /500\u00a0m/);
  assert.match(distance(5000), /5.0\u00a0km/);
});

test('bearing labels wrap the compass correctly', () => {
  assert.match(bearingLabel(0), /^000° N$/);
  assert.match(bearingLabel(359), /N$/);
  assert.match(bearingLabel(90), /E$/);
  assert.match(bearingLabel(225), /SW$/);
});

test('coordinates carry hemisphere letters', () => {
  assert.equal(coords(-33.8688, 151.2093, 2), '33.87°S 151.21°E');
});

test('escapeHtml neutralises feed-supplied markup', () => {
  // Callsigns, ship names and radio station names are attacker-controllable.
  assert.equal(escapeHtml('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
  assert.equal(escapeHtml(null), '');
});
