import { test } from 'vitest';
import assert from 'node:assert/strict';
import { geodeticEcef } from '../core/constellation';
import type { Fix } from '../feeds/flights';
import { createAircraftTracker, safeTick } from './tracker';

const fix = (over: Partial<Fix> = {}): Fix => ({
  id: 'abc123',
  callsign: 'BAW1',
  lat: 0,
  lon: 0,
  altM: 1000,
  speedMps: 100,
  trackDeg: 90,
  onGround: false,
  fixMs: 0,
  ...over,
});

test('tracker dead-reckons from the fix time', () => {
  const tracker = createAircraftTracker();
  tracker.ingest([fix()], 0);
  const [plane] = tracker.objects(10_000);
  const base = geodeticEcef(0, 0, 1000);
  // Due east at lon 0 is +y: 100 m/s for 10 s.
  assert.ok(Math.abs(plane.position.y - (base.y + 1000)) < 1, `y ${plane.position.y}`);
  assert.ok(Math.abs(plane.position.x - base.x) < 1);
  assert.equal(plane.kind, 'aircraft');
  assert.equal(plane.label, 'BAW1');
  assert.equal(tracker.aircraft(10_000)[0].trackDeg, 90);
});

test('tracker ignores aircraft on the ground', () => {
  const tracker = createAircraftTracker();
  tracker.ingest([fix({ onGround: true })], 0);
  assert.equal(tracker.size(), 0);
});

test('tracker drops stale fixes', () => {
  const tracker = createAircraftTracker();
  tracker.ingest([fix()], 0);
  assert.deepEqual(tracker.objects(36_000), []);

  const kept = createAircraftTracker();
  kept.ingest([fix()], 0);
  kept.ingest([fix({ fixMs: 20_000 })], 20_000);
  assert.equal(kept.objects(36_000).length, 1);
});

test('tracker labels by ICAO id when there is no callsign', () => {
  const tracker = createAircraftTracker();
  tracker.ingest([fix({ callsign: null })], 0);
  assert.equal(tracker.objects(0)[0].label, 'abc123');
});

test('safeTick returns null and reports when fn throws', () => {
  const errors: unknown[] = [];
  assert.equal(
    safeTick(() => {
      throw new Error('bad TLE');
    }, (e) => errors.push(e)),
    null,
  );
  assert.equal(errors.length, 1);
  assert.equal(safeTick(() => 42, () => {}), 42);
});
