// What the server sends to every screen, once per tick. The web app imports
// these as types only.
import type { BeamOut, LogEntry, Metrics, ReceiverStatus, Threat, Vec3 } from '../core/types';
import type { WireAircraft } from './tracker';

export type { BeamOut, LogEntry, Metrics, ReceiverStatus, Threat, Vec3, WireAircraft };

export interface FeedStatus {
  live: boolean;
  source: string | null;
  lastUpdateMs: number | null;
  remaining: number | null;
  error: string | null;
  flights: number;
  satellites: number;
}

export interface WireSnapshot {
  timeMs: number;
  beams: BeamOut[];
  threats: Threat[];
  receivers: (ReceiverStatus & { lat: number; lon: number })[];
  metrics: Metrics;
  /** Last 8 entries, oldest first. */
  log: LogEntry[];
  feed: FeedStatus;
  aircraft: WireAircraft[];
  powerSats: { id: string; name: string; position: Vec3 }[];
  drills: { id: string; label: string; position: Vec3; velocity: Vec3 }[];
}
