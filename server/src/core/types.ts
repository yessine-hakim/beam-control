// Shapes shared by the safety core, the server and (as types only) the web app.
// Positions and velocities are Earth-centred, Earth-fixed metres and m/s.

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export type Kind = 'aircraft' | 'satellite' | 'drill';
export type BeamType = 'laser' | 'microwave';

export interface TrackedObject {
  id: string;
  kind: Kind;
  label: string;
  position: Vec3;
  velocity: Vec3;
}

export interface Receiver {
  id: string;
  name: string;
  lat: number;
  lon: number;
  beamType: BeamType;
  capacityMW: number;
}

export type BeamState = 'ramping-up' | 'on' | 'ramping-down' | 'throttled';

export interface BeamOut {
  receiverId: string;
  satId: string;
  from: Vec3;
  to: Vec3;
  power: number;
  state: BeamState;
}

export interface Threat {
  receiverId: string;
  satId: string;
  objectKey: string;
  label: string;
  kind: Kind;
  timeToContactS: number;
  position: Vec3;
  contactPoint: Vec3;
}

export interface ReceiverStatus {
  id: string;
  name: string;
  deliveredMW: number;
  capacityMW: number;
  servingSatId: string | null;
}

export interface Snapshot {
  beams: BeamOut[];
  threats: Threat[];
  receivers: ReceiverStatus[];
}

export type LogType =
  | 'intrusion-predicted'
  | 'handoff'
  | 'pass-handoff'
  | 'throttle'
  | 'restore'
  | 'no-coverage';

export interface LogEntry {
  timeMs: number;
  type: LogType;
  receiverId: string;
  fromSatId?: string;
  toSatId?: string;
  objectKey?: string;
  label?: string;
  timeToContactS?: number;
}

export interface Metrics {
  intrusionsPredicted: number;
  handoffs: number;
  throttles: number;
  contacts: number;
  uptimePct: number;
}
