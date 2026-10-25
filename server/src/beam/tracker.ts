// Live aircraft between feed polls: keep the latest fix per aircraft and
// dead-reckon it along its ground track, the same straight-line model the
// controller uses for prediction. Fixes that stop arriving expire.
import { geodeticEcef } from '../core/constellation';
import { enuVelocityToEcef } from '../core/geometry';
import type { TrackedObject, Vec3 } from '../core/types';
import type { Fix } from '../feeds/flights';

interface Track {
  fix: Fix;
  seenMs: number;
  position: Vec3;
  velocity: Vec3;
}

export interface WireAircraft {
  id: string;
  label: string;
  position: Vec3;
  velocity: Vec3;
  trackDeg: number;
}

export function createAircraftTracker({ staleMs = 35_000 }: { staleMs?: number } = {}) {
  const tracks = new Map<string, Track>();

  const prune = (nowMs: number) => {
    for (const [id, t] of tracks) if (nowMs - t.seenMs > staleMs) tracks.delete(id);
  };
  const at = (t: Track, nowMs: number): Vec3 => {
    const dt = (nowMs - t.fix.fixMs) / 1000;
    return { x: t.position.x + t.velocity.x * dt, y: t.position.y + t.velocity.y * dt, z: t.position.z + t.velocity.z * dt };
  };

  return {
    ingest(fixes: Fix[], seenMs: number) {
      for (const fix of fixes) {
        if (fix.onGround) continue;
        tracks.set(fix.id, {
          fix,
          seenMs,
          position: geodeticEcef(fix.lat, fix.lon, fix.altM),
          velocity: enuVelocityToEcef(fix.lat, fix.lon, fix.speedMps, fix.trackDeg),
        });
      }
    },
    objects(nowMs: number): TrackedObject[] {
      prune(nowMs);
      return [...tracks.values()].map((t) => ({
        id: t.fix.id,
        kind: 'aircraft' as const,
        label: t.fix.callsign ?? t.fix.id,
        position: at(t, nowMs),
        velocity: t.velocity,
      }));
    },
    aircraft(nowMs: number): WireAircraft[] {
      prune(nowMs);
      return [...tracks.values()].map((t) => ({
        id: t.fix.id,
        label: t.fix.callsign ?? t.fix.id,
        position: at(t, nowMs),
        velocity: t.velocity,
        trackDeg: t.fix.trackDeg,
      }));
    },
    clear() {
      tracks.clear();
    },
    size: () => tracks.size,
  };
}

/** Run one loop iteration; a throw is reported and the loop carries on. */
export function safeTick<T>(fn: () => T, onError: (error: unknown) => void): T | null {
  try {
    return fn();
  } catch (error) {
    onError(error);
    return null;
  }
}
