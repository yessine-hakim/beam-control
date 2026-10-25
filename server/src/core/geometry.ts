// Beam geometry in Earth-centred, Earth-fixed metres. Plain {x, y, z} objects
// keep the safety core free of any rendering or framework dependency.
import type { Vec3 } from './types';

const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const scale = (a: Vec3, k: number): Vec3 => ({ x: a.x * k, y: a.y * k, z: a.z * k });
const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const len = (a: Vec3): number => Math.sqrt(dot(a, a));
const ZERO: Vec3 = Object.freeze({ x: 0, y: 0, z: 0 });

export interface MovingPoint {
  position: Vec3;
  velocity?: Vec3;
}

export interface BeamSegment {
  from: Vec3;
  fromVelocity?: Vec3;
  to: Vec3;
}

/** Shortest distance from point p to the segment a→b. */
export function distancePointToSegment(p: Vec3, a: Vec3, b: Vec3): number {
  const ab = sub(b, a);
  const lengthSq = dot(ab, ab);
  const t = lengthSq === 0 ? 0 : Math.min(1, Math.max(0, dot(sub(p, a), ab) / lengthSq));
  return len(sub(p, add(a, scale(ab, t))));
}

/** Angle of sat above the receiver's local horizon (spherical Earth up). */
export function elevationDeg(receiver: Vec3, sat: Vec3): number {
  const los = sub(sat, receiver);
  const sine = dot(los, receiver) / (len(los) * len(receiver));
  return (Math.asin(Math.max(-1, Math.min(1, sine))) * 180) / Math.PI;
}

/**
 * First sampled time (s) at which the object, moving in a straight line, is
 * inside radiusM of the beam, whose satellite end also moves. null = no contact.
 */
export function predictContact(
  object: MovingPoint,
  beam: BeamSegment,
  radiusM: number,
  { horizonS = 60, stepS = 1 }: { horizonS?: number; stepS?: number } = {},
): number | null {
  const velocity = object.velocity || ZERO;
  const fromVelocity = beam.fromVelocity || ZERO;
  for (let t = 0; t <= horizonS; t += stepS) {
    const p = add(object.position, scale(velocity, t));
    const from = add(beam.from, scale(fromVelocity, t));
    if (distancePointToSegment(p, from, beam.to) < radiusM) return t;
  }
  return null;
}

/** Cheap pre-filter: is the object inside the beam's bounding box grown by marginM? */
export function inBroadPhase(object: MovingPoint, beam: BeamSegment, marginM: number): boolean {
  const p = object.position;
  for (const axis of ['x', 'y', 'z'] as const) {
    const lo = Math.min(beam.from[axis], beam.to[axis]) - marginM;
    const hi = Math.max(beam.from[axis], beam.to[axis]) + marginM;
    if (p[axis] < lo || p[axis] > hi) return false;
  }
  return true;
}

/** Ground speed + track (degrees clockwise from north) to an ECEF velocity. */
export function enuVelocityToEcef(
  latDeg: number,
  lonDeg: number,
  speedMps: number,
  trackDeg: number,
  verticalMps = 0,
): Vec3 {
  const lat = (latDeg * Math.PI) / 180;
  const lon = (lonDeg * Math.PI) / 180;
  const track = (trackDeg * Math.PI) / 180;
  const e = speedMps * Math.sin(track);
  const n = speedMps * Math.cos(track);
  const u = verticalMps;
  const [sinLat, cosLat, sinLon, cosLon] = [Math.sin(lat), Math.cos(lat), Math.sin(lon), Math.cos(lon)];
  return {
    x: -sinLon * e - sinLat * cosLon * n + cosLat * cosLon * u,
    y: cosLon * e - sinLat * sinLon * n + cosLat * sinLon * u,
    z: cosLat * n + sinLat * u,
  };
}

/** Geocentric latitude/longitude of an ECEF point, in degrees. */
export function geocentricLatLon(p: Vec3): { latDeg: number; lonDeg: number } {
  return {
    latDeg: (Math.atan2(p.z, Math.hypot(p.x, p.y)) * 180) / Math.PI,
    lonDeg: (Math.atan2(p.y, p.x) * 180) / Math.PI,
  };
}

const MAX_VELOCITY_GAP_MS = 5000;

export interface VelocityTrack {
  position: Vec3;
  ms: number;
  velocity: Vec3;
}

/**
 * Velocity from successive position samples of an object whose source updates
 * on its own clock: a repeated sample keeps the last velocity, a new one is
 * divided by the time since the previous change, and a long gap resets to zero.
 */
export function trackVelocity(track: VelocityTrack | null | undefined, position: Vec3, nowMs: number): VelocityTrack {
  const p = { x: position.x, y: position.y, z: position.z };
  if (!track) return { position: p, ms: nowMs, velocity: ZERO };
  const moved = p.x !== track.position.x || p.y !== track.position.y || p.z !== track.position.z;
  if (!moved) return track;
  const dtS = (nowMs - track.ms) / 1000;
  const velocity = dtS > 0 && dtS * 1000 <= MAX_VELOCITY_GAP_MS ? scale(sub(p, track.position), 1 / dtS) : ZERO;
  return { position: p, ms: nowMs, velocity };
}
