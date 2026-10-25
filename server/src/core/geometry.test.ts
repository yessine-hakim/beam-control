import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  distancePointToSegment,
  elevationDeg,
  predictContact,
  inBroadPhase,
  enuVelocityToEcef,
  geocentricLatLon,
  trackVelocity,
} from './geometry';

const BEAM = Object.freeze({
  from: { x: 0, y: 0, z: 1e6 },
  fromVelocity: { x: 0, y: 0, z: 0 },
  to: { x: 0, y: 0, z: 0 },
});

test('distance to segment: interior, beyond each end', () => {
  const a = { x: 0, y: 0, z: 0 };
  const b = { x: 10, y: 0, z: 0 };
  assert.equal(distancePointToSegment({ x: 5, y: 3, z: 0 }, a, b), 3);
  assert.equal(distancePointToSegment({ x: -4, y: 3, z: 0 }, a, b), 5);
  assert.equal(distancePointToSegment({ x: 14, y: 0, z: 3 }, a, b), 5);
});

test('elevation: zenith is 90, horizon is ~0', () => {
  const r = { x: 6371e3, y: 0, z: 0 };
  assert.ok(Math.abs(elevationDeg(r, { x: 7571e3, y: 0, z: 0 }) - 90) < 1e-9);
  assert.ok(Math.abs(elevationDeg(r, { x: 6371e3, y: 1e6, z: 0 })) < 1e-9);
});

test('predictContact finds first crossing time and ignores misses', () => {
  const plane = {
    position: { x: -5000, y: 0, z: 3000 },
    velocity: { x: 250, y: 0, z: 0 },
  };
  // Exactly 2000 m at t = 12 s; strictly inside from t = 13 s.
  assert.equal(predictContact(plane, BEAM, 2000), 13);
  assert.equal(
    predictContact(
      { ...plane, position: { x: -5000, y: 5000, z: 3000 } },
      BEAM,
      2000,
    ),
    null,
  );
  assert.equal(
    predictContact(
      { position: { x: 0, y: 100, z: 3000 }, velocity: { x: 0, y: 0, z: 0 } },
      BEAM,
      2000,
    ),
    0,
  );
});

test('predictContact follows the moving satellite end of the beam', () => {
  // Satellite end moves 2 km/s, so the beam's midpoint sweeps 1 km/s toward an
  // object 5 km off-axis: 2 km (minus the beam's slight tilt) at t = 3 s.
  const beam = { ...BEAM, fromVelocity: { x: 2000, y: 0, z: 0 } };
  const parked = {
    position: { x: 5000, y: 0, z: 500e3 },
    velocity: { x: 0, y: 0, z: 0 },
  };
  assert.equal(predictContact(parked, BEAM, 2000), null);
  assert.equal(predictContact(parked, beam, 2000), 3);
});

test('broad phase keeps near objects and drops far ones', () => {
  assert.equal(
    inBroadPhase({ position: { x: 10e3, y: 0, z: 5e3 } }, BEAM, 20e3),
    true,
  );
  assert.equal(
    inBroadPhase({ position: { x: 500e3, y: 0, z: 5e3 } }, BEAM, 20e3),
    false,
  );
});

test('ENU velocity: due east at the equator/prime meridian is +y', () => {
  const v = enuVelocityToEcef(0, 0, 100, 90);
  assert.ok(Math.abs(v.y - 100) < 1e-9);
  assert.ok(Math.abs(v.x) < 1e-9 && Math.abs(v.z) < 1e-9);
  const north = enuVelocityToEcef(0, 0, 100, 0);
  assert.ok(Math.abs(north.z - 100) < 1e-9);
});

test('geocentric lat/lon round-trips simple axes', () => {
  const { latDeg, lonDeg } = geocentricLatLon({ x: 0, y: 6371e3, z: 0 });
  assert.ok(Math.abs(latDeg) < 1e-9 && Math.abs(lonDeg - 90) < 1e-9);
});

test('trackVelocity ignores unchanged samples and divides by time since the last change', () => {
  // The satellites layer re-propagates on its own ~1 s clock, so a 1 Hz reader
  // sometimes sees the same position twice, then two seconds of motion.
  let track = trackVelocity(null, { x: 0, y: 0, z: 0 }, 0);
  assert.deepEqual(track.velocity, { x: 0, y: 0, z: 0 });
  track = trackVelocity(track, { x: 7000, y: 0, z: 0 }, 1000);
  assert.equal(track.velocity.x, 7000);
  track = trackVelocity(track, { x: 7000, y: 0, z: 0 }, 2000);
  assert.equal(
    track.velocity.x,
    7000,
    'unchanged sample keeps the last velocity',
  );
  track = trackVelocity(track, { x: 21000, y: 0, z: 0 }, 3000);
  assert.equal(
    track.velocity.x,
    7000,
    'two seconds of motion over two seconds',
  );
  track = trackVelocity(track, { x: 99e6, y: 0, z: 0 }, 60_000);
  assert.deepEqual(
    track.velocity,
    { x: 0, y: 0, z: 0 },
    'a long gap is not trusted',
  );
});
