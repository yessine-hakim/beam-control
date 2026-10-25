import { test } from 'vitest';
import assert from 'node:assert/strict';
import { createBeamController, RAMP_S } from './controller';
import type { LogEntry } from './types';

// Receiver on the x axis. A is straight overhead; B is 31° up toward +y, far
// enough off A's beam that a plane crossing A near the ground stays clear of B.
const R = Object.freeze({ x: 6371e3, y: 0, z: 0 });
const RECEIVER = Object.freeze({
  id: 'r1',
  name: 'R1',
  beamType: 'laser',
  capacityMW: 100,
});
const A = { id: 'A', pos: { x: 7571e3, y: 0, z: 0 }, until: 600_000 };
const B = { id: 'B', pos: { x: 6971e3, y: 1000e3, z: 0 }, until: 300_000 };

function makeController(satellites = [A, B]) {
  return createBeamController({
    receivers: [RECEIVER],
    satellites,
    positionAt: (sat) => sat.pos,
    visibleUntilMs: (sat) => sat.until,
    receiverPosition: () => R,
  });
}

/** A plane 3 km up crossing A's beam: inside 2 km of it from `ttcS` seconds on. */
function crossingPlane(ttcS, elapsedS = 0, kind = 'aircraft', id = 'BAW1') {
  const z0 = -(1900 + 250 * ttcS);
  return {
    id,
    kind,
    label: id,
    position: { x: 6374e3, y: 0, z: z0 + 250 * elapsedS },
    velocity: { x: 0, y: 0, z: 250 },
  };
}

const served = (snap) => snap.receivers[0].servingSatId;
const delivered = (snap) => snap.receivers[0].deliveredMW;

function warmUp(controller, untilMs = 10_000) {
  let snap;
  for (let t = 0; t <= untilMs; t += 1000) snap = controller.tick(t, []);
  return snap;
}

test('serves the clean satellite with the longest visibility', () => {
  const snap = warmUp(makeController());
  assert.equal(served(snap), 'A');
  assert.equal(delivered(snap), 100);
});

test('hands off before a predicted crossing; delivered never dips below 90%', () => {
  const c = makeController();
  warmUp(c);
  for (let s = 0; s <= 40; s++) {
    const snap = c.tick(11_000 + s * 1000, [crossingPlane(30, s)]);
    assert.ok(delivered(snap) >= 90, `delivered ${delivered(snap)} at +${s}s`);
    if (s === 0) assert.equal(snap.threats[0].timeToContactS, 30);
  }
  assert.equal(c.getMetrics().handoffs, 1);
  assert.equal(c.getMetrics().contacts, 0);
  assert.equal(c.getLog().filter((e) => e.type === 'handoff').length, 1);
  // The audit log reads cause → action: the prediction precedes the handoff.
  const types = c.getLog().map((e) => e.type);
  assert.ok(
    types.indexOf('intrusion-predicted') < types.indexOf('handoff'),
    types.join(','),
  );
  assert.equal(served(c.tick(52_000, [])), 'B');
});

test('throttles at THROTTLE_LEAD_S when no clean satellite exists, then restores', () => {
  const c = makeController([A]);
  warmUp(c);
  const at = (s) => c.tick(11_000 + s * 1000, [crossingPlane(30, s)]);
  let snap;
  for (let s = 0; s <= 15; s++) snap = at(s);
  assert.equal(snap.beams[0].state, 'on');
  for (let s = 16; s <= 20; s++) snap = at(s);
  assert.equal(snap.beams[0].state, 'throttled');
  for (let s = 21; s <= 30; s++) snap = at(s);
  assert.equal(snap.beams[0].power, 0);
  for (let s = 31; s <= 60; s++) snap = at(s);
  assert.equal(snap.beams[0].power, 1);
  const types = c.getLog().map((e) => e.type);
  assert.ok(types.includes('throttle') && types.includes('restore'));
  assert.equal(c.getMetrics().contacts, 0);
  assert.equal(c.getMetrics().throttles, 1);
});

test('pass handoff when the serving satellite is setting', () => {
  // B rises after A is already serving; A sets at 400 s.
  const setting = { ...A, until: 400_000 };
  const rising = { ...B, pos: { x: 6271e3, y: 2000e3, z: 0 }, until: 900_000 };
  const c = makeController([setting, rising]);
  let snap = c.tick(380_000, []);
  assert.equal(served(snap), 'A');
  rising.pos = B.pos;
  for (let t = 381_000; t <= 395_000; t += 1000) snap = c.tick(t, []);
  assert.equal(served(snap), 'B');
  assert.equal(c.getLog().filter((e) => e.type === 'pass-handoff').length, 1);
});

test('logs one intrusion per object per beam', () => {
  const c = makeController([A]);
  warmUp(c);
  for (let s = 0; s < 20; s++)
    c.tick(11_000 + s * 1000, [crossingPlane(50, s)]);
  const intrusions = c.getLog().filter((e) => e.type === 'intrusion-predicted');
  assert.equal(intrusions.length, 1);
  assert.equal(intrusions[0].objectKey, 'aircraft:BAW1');
  assert.equal(c.getMetrics().intrusionsPredicted, 1);
});

test('no coverage: zero delivery, logged once, no throw', () => {
  const below = { id: 'C', pos: { x: 6271e3, y: 2000e3, z: 0 }, until: 1 };
  const c = makeController([below]);
  let snap;
  for (let t = 0; t <= 5000; t += 1000) snap = c.tick(t, []);
  assert.equal(delivered(snap), 0);
  assert.equal(served(snap), null);
  assert.equal(c.getLog().filter((e) => e.type === 'no-coverage').length, 1);
});

test('empty object list is fine', () => {
  const snap = makeController().tick(0, []);
  assert.equal(snap.beams.length, 1);
  assert.equal(snap.threats.length, 0);
});

test('dt is capped at 2 s after a long gap', () => {
  const c = makeController();
  c.tick(0, []);
  const snap = c.tick(60_000, []);
  assert.ok(snap.beams[0].power <= 2 / RAMP_S + 1e-9);
});

test('same id across kinds stays distinct', () => {
  const c = makeController([A]);
  warmUp(c);
  const snap = c.tick(11_000, [
    crossingPlane(30, 0, 'aircraft', '123'),
    crossingPlane(40, 0, 'satellite', '123'),
  ]);
  assert.deepEqual(snap.threats.map((t) => t.objectKey).sort(), [
    'aircraft:123',
    'satellite:123',
  ]);
});

test('onLog receives every log entry in log order', () => {
  const seen: LogEntry[] = [];
  const c = createBeamController({
    receivers: [RECEIVER],
    satellites: [A, B],
    positionAt: (s: typeof A) => s.pos,
    visibleUntilMs: (s: typeof A) => s.until,
    receiverPosition: () => R,
    onLog: (e: LogEntry) => seen.push(e),
  });
  for (let t = 0; t <= 10_000; t += 1000) c.tick(t, []);
  for (let s = 0; s <= 5; s++) c.tick(11_000 + s * 1000, [crossingPlane(30, s)]);
  assert.deepEqual(seen, c.getLog());
  assert.ok(seen.some((e) => e.type === 'handoff'));
});
