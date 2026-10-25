import { test } from 'vitest';
import assert from 'node:assert/strict';
import { createDrillIntruder } from './drill';
import { predictContact } from './geometry';

const VERTICAL = Object.freeze({
  from: { x: 7571e3, y: 0, z: 0 },
  fromVelocity: { x: 0, y: 0, z: 0 },
  to: { x: 6371e3, y: 0, z: 0 },
});

test('drill intruder crosses the beam about leadS seconds out', () => {
  const d = createDrillIntruder(VERTICAL, 0);
  const ttc = predictContact(
    { position: d.positionAt(0), velocity: d.velocity },
    VERTICAL,
    2000,
  );
  assert.ok(ttc >= 15 && ttc <= 25, `ttc ${ttc}`);
  assert.match(d.label, /^DRILL-\d+ \(SIMULATED\)$/);
  assert.equal(d.kind, 'drill');
  assert.equal(d.expiresMs, 60_000);
});

test('drill intruder flies at the requested height on a slanted beam', () => {
  const slanted = { ...VERTICAL, from: { x: 6971e3, y: 1000e3, z: 0 } };
  const d = createDrillIntruder(slanted, 1000);
  const p = d.positionAt(1000);
  assert.ok(Math.abs(Math.hypot(p.x, p.y, p.z) - 6371e3 - 3000) < 200);
  const later = d.positionAt(11_000);
  const moved = Math.hypot(later.x - p.x, later.y - p.y, later.z - p.z);
  assert.ok(Math.abs(moved - 2200) < 1e-6);
});

test('each drill gets a distinct id', () => {
  const a = createDrillIntruder(VERTICAL, 0);
  const b = createDrillIntruder(VERTICAL, 0);
  assert.notEqual(a.id, b.id);
});
