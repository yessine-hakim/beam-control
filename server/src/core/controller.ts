// Beam Control's decision loop: every tick, predict which beams live objects
// will cross, hand receivers to clean satellites, throttle when there is no
// clean one, and keep an audit log and the safety/uptime numbers.
import { elevationDeg, inBroadPhase, predictContact, type BeamSegment } from './geometry';
import { BEAM_TYPES, MIN_ELEVATION_DEG } from './constellation';
import type {
  BeamOut,
  BeamState,
  BeamType,
  LogEntry,
  Metrics,
  Receiver,
  ReceiverStatus,
  Snapshot,
  Threat,
  TrackedObject,
  Vec3,
} from './types';

export const HORIZON_S = 60;
export const STEP_S = 1;
export const RAMP_S = 5;
export const THROTTLE_LEAD_S = 10;
const MAX_DT_S = 2;
const VISIBILITY_CACHE_MS = 30_000;
const LOG_LIMIT = 200;

const len = (v: Vec3) => Math.hypot(v.x, v.y, v.z);
const along = (p: Vec3, v: Vec3, t: number): Vec3 => ({ x: p.x + v.x * t, y: p.y + v.y * t, z: p.z + v.z * t });
const ZERO: Vec3 = Object.freeze({ x: 0, y: 0, z: 0 });

interface Beam {
  satId: string;
  power: number;
  target: number;
  state: BeamState;
}

interface Station {
  beams: Beam[];
  primarySatId: string | null;
  noCoverageLogged: boolean;
}

export interface BeamControllerOptions<S extends { id: string }> {
  receivers: readonly Pick<Receiver, 'id' | 'name' | 'beamType' | 'capacityMW'>[];
  satellites: readonly S[];
  positionAt: (sat: S, nowMs: number) => Vec3 | null;
  visibleUntilMs: (sat: S, receiver: Pick<Receiver, 'id'> & Partial<Receiver>, nowMs: number) => number;
  receiverPosition: (receiver: Pick<Receiver, 'id'> & Partial<Receiver>) => Vec3;
  beamTypes?: Readonly<Record<BeamType, { safetyRadiusM: number }>>;
  /** Called for every audit-log entry, in log order. */
  onLog?: (entry: LogEntry) => void;
}

export interface BeamController {
  tick(nowMs: number, objects: readonly (Omit<TrackedObject, 'velocity'> & { velocity?: Vec3 })[]): Snapshot;
  getLog(): LogEntry[];
  getMetrics(): Metrics;
}

export function createBeamController<S extends { id: string }>({
  receivers,
  satellites,
  positionAt,
  visibleUntilMs,
  receiverPosition,
  beamTypes = BEAM_TYPES,
  onLog,
}: BeamControllerOptions<S>): BeamController {
  const stations = new Map<string, Station>(
    receivers.map((r) => [r.id, { beams: [], primarySatId: null, noCoverageLogged: false }]),
  );
  const visibilityCache = new Map<string, { at: number; value: number }>();
  let loggedPairs = new Set<string>();
  let lastMs: number | null = null;
  const log: LogEntry[] = [];
  const metrics = { intrusionsPredicted: 0, handoffs: 0, throttles: 0, contacts: 0, deliveredMWs: 0, capacityMWs: 0 };

  const record = (entry: LogEntry) => {
    log.push(entry);
    if (log.length > LOG_LIMIT) log.shift();
    onLog?.(entry);
  };

  function visibleUntil(sat: S, receiver: (typeof receivers)[number], nowMs: number): number {
    const key = `${sat.id}|${receiver.id}`;
    const hit = visibilityCache.get(key);
    if (hit && nowMs - hit.at < VISIBILITY_CACHE_MS) return hit.value;
    const value = visibleUntilMs(sat, receiver, nowMs);
    visibilityCache.set(key, { at: nowMs, value });
    return value;
  }

  function tick(nowMs: number, objects: Parameters<BeamController['tick']>[1]): Snapshot {
    const decisions: LogEntry[] = [];
    const dt = lastMs === null ? 0 : Math.min(MAX_DT_S, (nowMs - lastMs) / 1000);
    lastMs = nowMs;

    // Satellite end of each beam: position now, velocity from one second ahead.
    const satState = new Map<string, { sat: S; pos: Vec3; velocity: Vec3 }>();
    for (const sat of satellites) {
      const pos = positionAt(sat, nowMs);
      if (!pos) continue;
      const next = positionAt(sat, nowMs + 1000);
      const velocity = next ? { x: next.x - pos.x, y: next.y - pos.y, z: next.z - pos.z } : ZERO;
      satState.set(sat.id, { sat, pos, velocity });
    }

    const keyed = objects.map((o) => ({ ...o, key: `${o.kind}:${o.id}`, velocity: o.velocity || ZERO }));
    const allThreats: Threat[] = [];
    const beamsOut: BeamOut[] = [];
    const receiversOut: ReceiverStatus[] = [];

    for (const receiver of receivers) {
      const station = stations.get(receiver.id)!;
      const rp = receiverPosition(receiver);
      const radius = beamTypes[receiver.beamType].safetyRadiusM;
      const threatCache = new Map<string, Threat[]>();

      const beamFor = (s: { pos: Vec3; velocity: Vec3 }): BeamSegment => ({ from: s.pos, fromVelocity: s.velocity, to: rp });
      const threatsFor = (satId: string): Threat[] => {
        const cached = threatCache.get(satId);
        if (cached) return cached;
        const s = satState.get(satId);
        const found: Threat[] = [];
        if (s) {
          const beam = beamFor(s);
          for (const o of keyed) {
            const margin = radius + len(o.velocity) * HORIZON_S;
            if (!inBroadPhase(o, beam, margin)) continue;
            const ttc = predictContact(o, beam, radius, { horizonS: HORIZON_S, stepS: STEP_S });
            if (ttc === null) continue;
            found.push({
              receiverId: receiver.id,
              satId,
              objectKey: o.key,
              label: o.label,
              kind: o.kind,
              timeToContactS: ttc,
              position: o.position,
              contactPoint: along(o.position, o.velocity, ttc),
            });
          }
        }
        threatCache.set(satId, found);
        return found;
      };

      const visible = (satId: string) => {
        const s = satState.get(satId);
        return !!s && elevationDeg(rp, s.pos) >= MIN_ELEVATION_DEG;
      };
      const setting = (satId: string) =>
        !visible(satId) || visibleUntil(satState.get(satId)!.sat, receiver, nowMs) - nowMs < 2 * RAMP_S * 1000;
      const busyElsewhere = new Set<string>();
      for (const [id, other] of stations) if (id !== receiver.id) for (const b of other.beams) busyElsewhere.add(b.satId);
      const own = new Set(station.beams.map((b) => b.satId));
      const bestClean = (): string | null => {
        let best: string | null = null;
        let bestUntil = -Infinity;
        for (const [satId, s] of satState) {
          if (busyElsewhere.has(satId) || own.has(satId)) continue;
          if (setting(satId) || threatsFor(satId).length) continue;
          const until = visibleUntil(s.sat, receiver, nowMs);
          if (until > bestUntil) [best, bestUntil] = [satId, until];
        }
        return best;
      };
      const startBeam = (satId: string) => {
        station.beams.push({ satId, power: 0, target: 1, state: 'ramping-up' });
        station.primarySatId = satId;
      };

      const primary = station.beams.find((b) => b.satId === station.primarySatId);
      if (!primary) {
        const pick = bestClean();
        if (pick) {
          startBeam(pick);
          station.noCoverageLogged = false;
        } else if (!station.noCoverageLogged) {
          decisions.push({ timeMs: nowMs, type: 'no-coverage', receiverId: receiver.id });
          station.noCoverageLogged = true;
        }
      } else {
        const threats = visible(primary.satId) ? threatsFor(primary.satId) : [];
        const leaving = setting(primary.satId);
        if (threats.length || leaving) {
          const alt = bestClean();
          const nearest = threats.reduce<Threat | null>(
            (a, b) => (!a || b.timeToContactS < a.timeToContactS ? b : a),
            null,
          );
          if (alt) {
            primary.target = 0;
            primary.state = 'ramping-down';
            startBeam(alt);
            metrics.handoffs++;
            decisions.push({
              timeMs: nowMs,
              type: nearest ? 'handoff' : 'pass-handoff',
              receiverId: receiver.id,
              fromSatId: primary.satId,
              toSatId: alt,
              ...(nearest && {
                objectKey: nearest.objectKey,
                label: nearest.label,
                timeToContactS: nearest.timeToContactS,
              }),
            });
          } else if (nearest && nearest.timeToContactS <= THROTTLE_LEAD_S && primary.state !== 'throttled') {
            primary.target = 0;
            primary.state = 'throttled';
            metrics.throttles++;
            decisions.push({
              timeMs: nowMs,
              type: 'throttle',
              receiverId: receiver.id,
              fromSatId: primary.satId,
              objectKey: nearest.objectKey,
              label: nearest.label,
              timeToContactS: nearest.timeToContactS,
            });
          } else if (!visible(primary.satId)) {
            // Lost the satellite with nowhere to go: let it go dark.
            primary.target = 0;
            primary.state = 'ramping-down';
            station.primarySatId = null;
          }
        } else if (primary.state === 'throttled') {
          primary.target = 1;
          primary.state = 'ramping-up';
          decisions.push({ timeMs: nowMs, type: 'restore', receiverId: receiver.id, toSatId: primary.satId });
        }
      }

      // Ramp, retire finished beams, then account for safety and delivery.
      const step = dt / RAMP_S;
      for (const b of station.beams) {
        b.power = b.target > b.power ? Math.min(b.target, b.power + step) : Math.max(b.target, b.power - step);
        if (b.state === 'ramping-up' && b.power >= 1) b.state = 'on';
      }
      station.beams = station.beams.filter((b) => b.power > 0 || b.target > 0 || b.satId === station.primarySatId);

      let power = 0;
      for (const b of station.beams) {
        const s = satState.get(b.satId);
        if (!s) continue;
        power += b.power;
        if (b.power > 0) {
          for (const o of keyed) {
            if (predictContact(o, beamFor(s), radius, { horizonS: 0 }) === 0) metrics.contacts++;
          }
        }
        allThreats.push(...threatsFor(b.satId));
        beamsOut.push({ receiverId: receiver.id, satId: b.satId, from: s.pos, to: rp, power: b.power, state: b.state });
      }
      const deliveredMW = Math.min(1, power) * receiver.capacityMW;
      metrics.deliveredMWs += deliveredMW * dt;
      metrics.capacityMWs += receiver.capacityMW * dt;
      receiversOut.push({
        id: receiver.id,
        name: receiver.name,
        deliveredMW,
        capacityMW: receiver.capacityMW,
        servingSatId: station.primarySatId,
      });
    }

    const pairs = new Set<string>();
    for (const t of allThreats) {
      const pair = `${t.objectKey}|${t.satId}`;
      pairs.add(pair);
      if (loggedPairs.has(pair)) continue;
      metrics.intrusionsPredicted++;
      record({
        timeMs: nowMs,
        type: 'intrusion-predicted',
        receiverId: t.receiverId,
        fromSatId: t.satId,
        objectKey: t.objectKey,
        label: t.label,
        timeToContactS: t.timeToContactS,
      });
    }
    loggedPairs = pairs;
    // Causes first, then the actions they triggered, so the log reads in order.
    for (const entry of decisions) record(entry);

    return { beams: beamsOut, threats: allThreats, receivers: receiversOut };
  }

  return {
    tick,
    getLog: () => [...log],
    getMetrics: () => ({
      intrusionsPredicted: metrics.intrusionsPredicted,
      handoffs: metrics.handoffs,
      throttles: metrics.throttles,
      contacts: metrics.contacts,
      uptimePct: metrics.capacityMWs ? (100 * metrics.deliveredMWs) / metrics.capacityMWs : 100,
    }),
  };
}
