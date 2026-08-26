import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTle } from '../../src/util/tle.js';

const ISS = `ISS (ZARYA)
1 25544U 98067A   24001.50000000  .00016717  00000-0  30777-3 0  9993
2 25544  51.6416 247.4627 0006703 130.5360 325.0288 15.49725782 20000`;

test('parses a three-line element set', () => {
  const [sat] = parseTle(ISS);
  assert.equal(sat.name, 'ISS (ZARYA)');
  assert.equal(sat.noradId, '25544');
  // LEO at ~15.5 revs/day is a ~93 minute orbit.
  assert.ok(sat.periodMin > 88 && sat.periodMin < 96, `got ${sat.periodMin} min`);
  assert.equal(new Date(sat.epochMs).getUTCFullYear(), 2024);
});

test('skips junk without losing the good entries', () => {
  const mixed = `GARBAGE
not a line 1
not a line 2
${ISS}`;
  const sats = parseTle(mixed);
  assert.equal(sats.length, 1);
  assert.equal(sats[0].noradId, '25544');
});

test('empty and whitespace input yield no satellites', () => {
  assert.deepEqual(parseTle(''), []);
  assert.deepEqual(parseTle('\n\n\n'), []);
});
