// The SIMULATED half of Beam Control: power satellites and ground receivers
// that do not exist yet. Orbits still run through real SGP4 (satellite.js),
// the same propagator used for the live CelesTrak catalogue.
import { eciToEcf, geodeticToEcf, gstime, json2satrec, propagate, type SatRec } from 'satellite.js';
import { elevationDeg } from './geometry';
import type { BeamType, Receiver, Vec3 } from './types';

export const MIN_ELEVATION_DEG = 15;

/** Safety radius per beam type; regulators would own these numbers. */
export const BEAM_TYPES: Readonly<Record<BeamType, { safetyRadiusM: number }>> = Object.freeze({
  laser: Object.freeze({ safetyRadiusM: 2000 }),
  microwave: Object.freeze({ safetyRadiusM: 600 }),
});

export const RECEIVERS: readonly Receiver[] = Object.freeze([
  // ~6 km beside the Heathrow and CDG final approaches: real arrivals cross
  // the slanted beams at altitude, where they diverge and a clean one exists.
  // Under the centreline every beam converges on the aircraft at once.
  Object.freeze({ id: 'london-west', name: 'London West', lat: 51.53, lon: -0.3, beamType: 'laser', capacityMW: 200 } as Receiver),
  Object.freeze({ id: 'paris-nord', name: 'Paris Nord', lat: 49.075, lon: 2.68, beamType: 'laser', capacityMW: 150 } as Receiver),
  // East of Tunis-Carthage's north–south runway, clear of its approaches.
  Object.freeze({ id: 'tunis', name: 'Tunis', lat: 36.87, lon: 10.3, beamType: 'microwave', capacityMW: 100 } as Receiver),
]);

export interface PowerSat {
  id: string;
  name: string;
  satrec: SatRec;
}

const EARTH_RADIUS_KM = 6378.137;
const MU_KM3_S2 = 398600.4418;
const DEG = Math.PI / 180;

/** Walker-delta constellation of SIMULATED power satellites. */
export function createPowerConstellation({
  epoch = new Date(),
  planes = 12,
  perPlane = 8,
  altitudeKm = 1200,
  inclinationDeg = 53,
}: { epoch?: Date; planes?: number; perPlane?: number; altitudeKm?: number; inclinationDeg?: number } = {}): PowerSat[] {
  const a = EARTH_RADIUS_KM + altitudeKm;
  const revPerDay = 86400 / (2 * Math.PI * Math.sqrt(a ** 3 / MU_KM3_S2));
  const total = planes * perPlane;
  const sats: PowerSat[] = [];
  for (let plane = 0; plane < planes; plane++) {
    for (let slot = 0; slot < perPlane; slot++) {
      const index = plane * perPlane + slot;
      const id = `PWR-${String(index + 1).padStart(2, '0')}`;
      const satrec = json2satrec({
        OBJECT_NAME: id,
        OBJECT_ID: id,
        NORAD_CAT_ID: 90001 + index,
        EPOCH: epoch.toISOString(),
        MEAN_MOTION: revPerDay,
        ECCENTRICITY: 0.0001,
        INCLINATION: inclinationDeg,
        RA_OF_ASC_NODE: (plane * 360) / planes,
        ARG_OF_PERICENTER: 0,
        MEAN_ANOMALY: ((slot * 360) / perPlane + (plane * 360) / total) % 360,
        BSTAR: 0,
        MEAN_MOTION_DOT: 0,
        MEAN_MOTION_DDOT: 0,
        EPHEMERIS_TYPE: 0,
        CLASSIFICATION_TYPE: 'U',
        ELEMENT_SET_NO: 999,
        REV_AT_EPOCH: 0,
      } as unknown as Parameters<typeof json2satrec>[0]);
      sats.push({ id, name: `${id} · SIMULATED`, satrec });
    }
  }
  return sats;
}

/** SGP4 position of any satrec holder in ECEF metres, or null if propagation fails. */
export function satellitePositionEcef(sat: { satrec: SatRec }, date: Date): Vec3 | null {
  const result = propagate(sat.satrec, date) as { position?: unknown } | null;
  const position = result?.position;
  if (!position || typeof position !== 'object') return null;
  const ecf = eciToEcf(position as Parameters<typeof eciToEcf>[0], gstime(date));
  if (!Number.isFinite(ecf.x)) return null;
  return { x: ecf.x * 1000, y: ecf.y * 1000, z: ecf.z * 1000 };
}

/** WGS84 ground point (or a point at heightM) in ECEF metres. */
export function geodeticEcef(latDeg: number, lonDeg: number, heightM = 0): Vec3 {
  const ecf = geodeticToEcf({ latitude: latDeg * DEG, longitude: lonDeg * DEG, height: heightM / 1000 } as Parameters<typeof geodeticToEcf>[0]);
  return { x: ecf.x * 1000, y: ecf.y * 1000, z: ecf.z * 1000 };
}

/** WGS84 ground point of a receiver in ECEF metres. */
export function receiverEcef(receiver: Pick<Receiver, 'lat' | 'lon'>): Vec3 {
  return geodeticEcef(receiver.lat, receiver.lon, 0);
}

/** Epoch ms when sat first drops below MIN_ELEVATION_DEG for this receiver. */
export function visibleUntilMs(
  sat: { satrec: SatRec },
  receiver: Pick<Receiver, 'lat' | 'lon'>,
  date: Date,
  { stepS = 10, maxS = 1800 }: { stepS?: number; maxS?: number } = {},
): number {
  const rp = receiverEcef(receiver);
  const start = date.getTime();
  for (let s = 0; s <= maxS; s += stepS) {
    const p = satellitePositionEcef(sat, new Date(start + s * 1000));
    if (!p || elevationDeg(rp, p) < MIN_ELEVATION_DEG) return start + s * 1000;
  }
  return start + maxS * 1000;
}
