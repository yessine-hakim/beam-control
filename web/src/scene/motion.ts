import type { Vec3 } from '../types';

const MAX_GAP_S = 5;

/** Straight-line position dtS seconds on; a long gap is capped so a stalled feed never flings a plane away. */
export function extrapolate(position: Vec3, velocity: Vec3, dtS: number): Vec3 {
  const t = Math.min(MAX_GAP_S, Math.max(0, dtS));
  return { x: position.x + velocity.x * t, y: position.y + velocity.y * t, z: position.z + velocity.z * t };
}
