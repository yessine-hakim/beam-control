// A clearly labelled SIMULATED intruder for rehearsals and offline demos: it
// flies straight across a live beam so the full predict → hand off path runs
// even when no real aircraft happens to cross.
import type { BeamSegment } from './geometry';
import type { Vec3 } from './types';

const DRILL_LIFETIME_MS = 60_000;
let drillCount = 0;

const unit = (v: Vec3): Vec3 => {
  const n = Math.hypot(v.x, v.y, v.z);
  return { x: v.x / n, y: v.y / n, z: v.z / n };
};
const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});

export interface DrillIntruder {
  id: string;
  kind: 'drill';
  label: string;
  velocity: Vec3;
  expiresMs: number;
  positionAt(ms: number): Vec3;
}

export function createDrillIntruder(
  beam: BeamSegment,
  nowMs: number,
  { leadS = 25, speedMps = 220, altitudeM = 3000 }: { leadS?: number; speedMps?: number; altitudeM?: number } = {},
): DrillIntruder {
  const up = unit(beam.to);
  const span = { x: beam.from.x - beam.to.x, y: beam.from.y - beam.to.y, z: beam.from.z - beam.to.z };
  // Point on the beam altitudeM above the receiver.
  const s = altitudeM / (span.x * up.x + span.y * up.y + span.z * up.z);
  const crossing = { x: beam.to.x + span.x * s, y: beam.to.y + span.y * s, z: beam.to.z + span.z * s };
  // Fly level and square to the beam; a vertical beam falls back to east.
  let heading = cross(unit(span), up);
  if (Math.hypot(heading.x, heading.y, heading.z) < 1e-6) heading = cross({ x: 0, y: 0, z: 1 }, up);
  heading = unit(heading);
  const velocity = { x: heading.x * speedMps, y: heading.y * speedMps, z: heading.z * speedMps };
  const start = {
    x: crossing.x - velocity.x * leadS,
    y: crossing.y - velocity.y * leadS,
    z: crossing.z - velocity.z * leadS,
  };
  const n = ++drillCount;
  return {
    id: `drill-${n}`,
    kind: 'drill',
    label: `DRILL-${n} (SIMULATED)`,
    velocity,
    expiresMs: nowMs + DRILL_LIFETIME_MS,
    positionAt(ms: number) {
      const t = (ms - nowMs) / 1000;
      return { x: start.x + velocity.x * t, y: start.y + velocity.y * t, z: start.z + velocity.z * t };
    },
  };
}
