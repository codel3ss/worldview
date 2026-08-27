import test from 'node:test';
import assert from 'node:assert/strict';
import { DIRECT, createFeedRouter, isDirect } from '../../src/core/feedRoute.js';

test('the proxy wins when it is available', () => {
  const feed = createFeedRouter({ proxy: true });
  assert.equal(feed('/api/celestrak?group=stations', DIRECT.celestrak('stations')), '/api/celestrak?group=stations');
});

test('without a proxy the request goes straight upstream', () => {
  const feed = createFeedRouter({ proxy: false });
  const url = feed('/api/celestrak?group=stations', DIRECT.celestrak('stations'));
  assert.match(url, /^https:\/\/celestrak\.org\//);
  assert.match(url, /GROUP=stations/);
});

test('a feed with no direct form resolves to null rather than a bad URL', () => {
  // Fires, vessels and traffic need a secret; on static hosting they must stay
  // unavailable instead of silently calling an endpoint that cannot exist.
  const feed = createFeedRouter({ proxy: false });
  assert.equal(feed('/api/firms?area=1,2,3,4', null), null);
});

test('isDirect reflects proxy availability', () => {
  assert.equal(isDirect({ proxy: false }), true);
  assert.equal(isDirect({ proxy: true }), false);
});

test('direct URL builders encode their inputs', () => {
  assert.match(DIRECT.celestrak('gps-ops'), /GROUP=gps-ops/);
  assert.match(DIRECT.launches('upcoming', 40), /launch\/upcoming\/\?limit=40/);

  const radio = DIRECT.radio({ lat: 51.5, lon: -0.12, distance: 200000, limit: 180 });
  assert.match(radio, /geo_lat=51\.5/);
  assert.match(radio, /geo_long=-0\.12/);
  assert.match(radio, /hidebroken=true/);

  // A query with characters that would break a URL must survive intact.
  const geo = DIRECT.geocode('Saint-Étienne & co');
  assert.ok(!geo.includes(' '), geo);
  assert.equal(new URL(geo).searchParams.get('q'), 'Saint-Étienne & co');

  assert.equal(DIRECT.gbfs('https://example.test/gbfs.json'), 'https://example.test/gbfs.json');
});
