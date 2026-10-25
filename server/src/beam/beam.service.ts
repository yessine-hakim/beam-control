import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Subject } from 'rxjs';
import {
  createPowerConstellation,
  RECEIVERS,
  receiverEcef,
  satellitePositionEcef,
  visibleUntilMs,
} from '../core/constellation';
import { createBeamController, type BeamController } from '../core/controller';
import { createDrillIntruder, type DrillIntruder } from '../core/drill';
import type { LogEntry, Snapshot, TrackedObject, Vec3 } from '../core/types';
import { POLL_GROUPS, POLL_INTERVAL_MS } from '../feeds/flights';
import { FeedsService } from '../feeds/feeds.service';
import { createAircraftTracker, safeTick } from './tracker';
import type { FeedStatus, WireSnapshot } from './wire';

const TICK_MS = 1000;
const DEMO_RECEIVER_ID = 'london-west';
const ZERO: Vec3 = { x: 0, y: 0, z: 0 };

/** The server owns the truth: one safety loop for every receiver, whether or not anyone is watching. */
@Injectable()
export class BeamService implements OnModuleInit, OnModuleDestroy {
  readonly snapshot$ = new Subject<WireSnapshot>();
  readonly log$ = new Subject<LogEntry>();
  private readonly logger = new Logger('Beam');
  private readonly constellation = createPowerConstellation({ epoch: new Date() });
  private readonly receiverPoints = new Map(RECEIVERS.map((r) => [r.id, receiverEcef(r)]));
  private readonly controller: BeamController;
  private readonly tracker = createAircraftTracker();
  private readonly drills: DrillIntruder[] = [];
  private feed: FeedStatus = { live: false, source: null, lastUpdateMs: null, remaining: null, error: null, flights: 0, satellites: 0 };
  private tickError: string | null = null;
  private snapshot: Snapshot = { beams: [], threats: [], receivers: [] };
  private wire: WireSnapshot | null = null;
  private tickTimer: NodeJS.Timeout | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private polling = false;

  constructor(private readonly feeds: FeedsService) {
    this.controller = createBeamController({
      receivers: RECEIVERS,
      satellites: this.constellation,
      positionAt: (sat, ms) => satellitePositionEcef(sat, new Date(ms)),
      visibleUntilMs: (sat, r, ms) => visibleUntilMs(sat, r as (typeof RECEIVERS)[number], new Date(ms)),
      receiverPosition: (r) => this.receiverPoints.get(r.id)!,
      onLog: (entry) => this.log$.next(entry),
    });
  }

  onModuleInit() {
    this.tick();
    this.tickTimer = setInterval(() => this.tick(), TICK_MS);
  }

  onModuleDestroy() {
    if (this.tickTimer) clearInterval(this.tickTimer);
    this.stopPolling();
  }

  latest(): WireSnapshot | null {
    return this.wire;
  }

  setLiveFeed(on: boolean): boolean {
    if (on === this.feed.live) return this.feed.live;
    this.feed = { ...this.feed, live: on, source: null, error: null };
    if (on) {
      void this.pollAll();
      this.pollTimer = setInterval(() => void this.pollAll(), POLL_INTERVAL_MS);
    } else {
      this.stopPolling();
      this.tracker.clear();
    }
    this.logger.log(`Live feed ${on ? 'on' : 'off'}`);
    return this.feed.live;
  }

  /** Send a SIMULATED intruder across a powered serving beam, London West first. */
  triggerDrill(): boolean {
    const serving = (b: Snapshot['beams'][number]) =>
      this.snapshot.receivers.find((r) => r.id === b.receiverId)?.servingSatId === b.satId;
    const demo = (b: Snapshot['beams'][number]) => b.receiverId === DEMO_RECEIVER_ID && serving(b);
    const beams = this.snapshot.beams;
    const beam =
      beams.find((b) => demo(b) && b.state === 'on') ||
      beams.find((b) => serving(b) && b.state === 'on') ||
      beams.find(demo) ||
      beams.find(serving);
    if (!beam) return false;
    this.drills.push(createDrillIntruder({ from: beam.from, fromVelocity: ZERO, to: beam.to }, Date.now()));
    return true;
  }

  private stopPolling() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  private async pollAll() {
    if (this.polling || !this.feed.live) return;
    this.polling = true;
    try {
      for (const group of POLL_GROUPS) {
        const result = await this.feeds.pollFlights(group);
        if (!this.feed.live) return;
        this.tracker.ingest(result.fixes, Date.now());
        this.feed = {
          ...this.feed,
          source: result.source ?? this.feed.source,
          remaining: result.remaining ?? this.feed.remaining,
          error: result.error,
          lastUpdateMs: result.source ? Date.now() : this.feed.lastUpdateMs,
        };
      }
    } finally {
      this.polling = false;
    }
  }

  private liveSatelliteObjects(nowMs: number): TrackedObject[] {
    const now = new Date(nowMs);
    const next = new Date(nowMs + 1000);
    const objects: TrackedObject[] = [];
    for (const sat of this.feeds.liveSatellites()) {
      const position = satellitePositionEcef(sat, now);
      const ahead = position && satellitePositionEcef(sat, next);
      if (!position || !ahead) continue;
      objects.push({
        id: sat.id,
        kind: 'satellite',
        label: sat.name,
        position,
        velocity: { x: ahead.x - position.x, y: ahead.y - position.y, z: ahead.z - position.z },
      });
    }
    return objects;
  }

  private tick() {
    safeTick(
      () => {
        const nowMs = Date.now();
        for (let i = this.drills.length - 1; i >= 0; i--) if (this.drills[i].expiresMs <= nowMs) this.drills.splice(i, 1);
        const drills = this.drills.map((d) => ({ id: d.id, label: d.label, position: d.positionAt(nowMs), velocity: d.velocity }));
        const aircraft = this.feed.live ? this.tracker.objects(nowMs) : [];
        const satellites = this.liveSatelliteObjects(nowMs);
        const objects: TrackedObject[] = [...aircraft, ...satellites, ...drills.map((d) => ({ ...d, kind: 'drill' as const }))];
        this.snapshot = this.controller.tick(nowMs, objects);
        this.tickError = null;
        this.wire = {
          timeMs: nowMs,
          beams: this.snapshot.beams,
          threats: this.snapshot.threats,
          receivers: this.snapshot.receivers.map((r) => {
            const site = RECEIVERS.find((x) => x.id === r.id)!;
            return { ...r, lat: site.lat, lon: site.lon };
          }),
          metrics: this.controller.getMetrics(),
          log: this.controller.getLog().slice(-8),
          feed: { ...this.feed, flights: aircraft.length, satellites: satellites.length },
          aircraft: this.feed.live ? this.tracker.aircraft(nowMs) : [],
          powerSats: this.constellation.flatMap((s) => {
            const position = satellitePositionEcef(s, new Date(nowMs));
            return position ? [{ id: s.id, name: s.name, position }] : [];
          }),
          drills,
        };
        this.snapshot$.next(this.wire);
      },
      (error) => {
        this.tickError = error instanceof Error ? error.message : String(error);
        this.logger.error(`Tick failed: ${this.tickError}`);
        // Screens must not look healthy while frozen: re-send the last state flagged.
        if (this.wire) this.snapshot$.next({ ...this.wire, feed: { ...this.wire.feed, error: `tick failed: ${this.tickError}` } });
      },
    );
  }
}
