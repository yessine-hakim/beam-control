import { test } from 'vitest';
import assert from 'node:assert/strict';
import { geodeticToEcf } from 'satellite.js';
import {
  RECEIVERS,
  createPowerConstellation,
  receiverEcef,
  satellitePositionEcef,
  visibleUntilMs,
} from './constellation';
import { createBeamController } from './controller';
import { enuVelocityToEcef } from './geometry';

const DEG = Math.PI / 180;
const ecef = (lat, lon, h) => {
  const e = geodeticToEcf({
    latitude: lat * DEG,
    longitude: lon * DEG,
    height: h / 1000,
  });
  return { x: e.x * 1000, y: e.y * 1000, z: e.z * 1000 };
};

/** A westbound 3° final approach to a threshold, sampled once per second. */
function arrival(lat, thresholdLon, startLon, s) {
  const kmPerDegLon = 111.32 * Math.cos(lat * DEG);
  const lon = startLon - (75 * s) / 1000 / kmPerDegLon;
  const h = Math.max(
    15,
    (lon - thresholdLon) * kmPerDegLon * 1000 * Math.tan(3 * DEG) + 15,
  );
  return {
    id: `arr-${lat}`,
    kind: 'aircraft',
    label: 'ARR',
    position: ecef(lat, lon, h),
    velocity: enuVelocityToEcef(lat, lon, 75, 270, -75 * Math.tan(3 * DEG)),
  };
}

// Real final-approach centrelines next to the demo receivers (westerly ops).
const APPROACHES = [
  { receiverId: 'london-west', lat: 51.4647, threshold: -0.4342, start: -0.1 }, // EGLL 27L
  { receiverId: 'london-west', lat: 51.4777, threshold: -0.4335, start: -0.1 }, // EGLL 27R
  { receiverId: 'paris-nord', lat: 49.0247, threshold: 2.5642, start: 2.85 }, // LFPG 27R
  { receiverId: 'paris-nord', lat: 48.9962, threshold: 2.6122, start: 2.85 }, // LFPG 26L
];

test('receivers sit beside, not under, real approaches: arrivals never drop delivery below 90%', () => {
  for (const iso of [
    '2026-10-25T08:00:00Z',
    '2026-10-25T08:40:00Z',
    '2026-10-25T09:10:00Z',
  ]) {
    const epoch = new Date(iso);
    const sats = createPowerConstellation({ epoch });
    const points = new Map(RECEIVERS.map((r) => [r.id, receiverEcef(r)]));
    for (const approach of APPROACHES) {
      const c = createBeamController({
        receivers: RECEIVERS,
        satellites: sats,
        positionAt: (s, ms) => satellitePositionEcef(s, new Date(ms)),
        visibleUntilMs: (s, r, ms) => visibleUntilMs(s, r, new Date(ms)),
        receiverPosition: (r) => points.get(r.id),
      });
      const t0 = epoch.getTime();
      for (let s = 0; s < 10; s++) c.tick(t0 + s * 1000, []);
      const r = RECEIVERS.find((x) => x.id === approach.receiverId);
      for (let s = 0; s < 240; s++) {
        const plane = arrival(
          approach.lat,
          approach.threshold,
          approach.start,
          s,
        );
        const snap = c.tick(t0 + (10 + s) * 1000, [plane]);
        const mw = snap.receivers.find((x) => x.id === r.id).deliveredMW;
        assert.ok(
          mw >= 0.9 * r.capacityMW,
          `${r.id} ${mw} MW at ${iso} +${s}s (${approach.lat})`,
        );
      }
      assert.equal(c.getMetrics().contacts, 0);
    }
  }
});
