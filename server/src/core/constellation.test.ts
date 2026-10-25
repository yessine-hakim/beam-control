import { test } from 'vitest';
import assert from 'node:assert/strict';
import { elevationDeg } from './geometry';
import {
  BEAM_TYPES,
  MIN_ELEVATION_DEG,
  RECEIVERS,
  createPowerConstellation,
  receiverEcef,
  satellitePositionEcef,
  visibleUntilMs,
} from './constellation';

const EPOCH = new Date('2026-10-25T08:00:00Z');

test('constellation has 96 uniquely named SIMULATED satellites at ~1200 km', () => {
  const sats = createPowerConstellation({ epoch: EPOCH });
  assert.equal(sats.length, 96);
  assert.equal(new Set(sats.map((s) => s.id)).size, 96);
  assert.ok(sats.every((s) => s.name.endsWith('SIMULATED')));
  const p = satellitePositionEcef(sats[0], EPOCH);
  const altKm = Math.hypot(p.x, p.y, p.z) / 1000 - 6371;
  assert.ok(altKm > 1150 && altKm < 1250, `altitude ${altKm}`);
});

test('every receiver always sees at least 2 power satellites (2 h, 30 s steps)', () => {
  const sats = createPowerConstellation({ epoch: EPOCH });
  for (const r of RECEIVERS) {
    const rp = receiverEcef(r);
    for (let s = 0; s <= 7200; s += 30) {
      const t = new Date(EPOCH.getTime() + s * 1000);
      const n = sats.filter(
        (sat) =>
          elevationDeg(rp, satellitePositionEcef(sat, t)) >= MIN_ELEVATION_DEG,
      ).length;
      assert.ok(n >= 2, `${r.id} sees ${n} at +${s}s`);
    }
  }
});

test('visibleUntilMs is in the future for a visible satellite', () => {
  const sats = createPowerConstellation({ epoch: EPOCH });
  const london = RECEIVERS.find((r) => r.id === 'london-west');
  const rp = receiverEcef(london);
  const visible = sats.find(
    (sat) =>
      elevationDeg(rp, satellitePositionEcef(sat, EPOCH)) >= MIN_ELEVATION_DEG,
  );
  const until = visibleUntilMs(visible, london, EPOCH);
  assert.ok(until > EPOCH.getTime());
  assert.ok(until <= EPOCH.getTime() + 1800 * 1000);
});

test('receivers use a known beam type and London West sits near Heathrow', () => {
  assert.ok(RECEIVERS.every((r) => BEAM_TYPES[r.beamType]));
  const london = receiverEcef(RECEIVERS[0]);
  assert.ok(Math.abs(Math.hypot(london.x, london.y, london.z) - 6365e3) < 10e3);
});
