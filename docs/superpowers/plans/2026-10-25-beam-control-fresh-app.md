# Beam Control (fresh app) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A standalone Beam Control product in a new repo: a NestJS server runs the beam-safety loop on live traffic around the clock, and a React + Cesium web app is the viewer and console.

**Architecture:**
- npm workspaces with `server/` (NestJS 11) and `web/` (React 19 + Vite 6 + Cesium).
- The safety core (geometry, constellation, controller, drill) is carried over from the prototype into `server/src/core/`, converted to TypeScript with its tests unchanged in substance.
- Nest modules wrap it:
  - feeds: flights and satellites, with budget guard and caches;
  - beam: a 1 Hz loop with an aircraft tracker;
  - audit: JSONL log and read-only API;
  - gateway: socket.io snapshot push plus `drill` / `liveFeed` commands.
- The web app imports only types from the server and renders each snapshot imperatively into a plain Cesium Viewer.

**Tech Stack:** Node 24, TypeScript 5.9, NestJS 11.2 (+ `@nestjs/platform-socket.io`), React 19, Vite 6.4, `@vitejs/plugin-react` 4.7, `vite-plugin-cesium` 1.2.23, Cesium 1.138, satellite.js 6.0.2, socket.io-client 4.8, Vitest 3.2, concurrently 9.

**Spec:** `docs/superpowers/specs/2026-10-25-beam-control-fresh-app-design.md` (copied into the new repo in Task 1). The prototype source to carry over is `C:\Users\hakim\Desktop\Lumen\beam-control\src\layers\beamControl\` and `src\ui\styles\beam-control.css`.

## Global Constraints

- New folder `C:\Users\hakim\Desktop\Lumen\beam-control-app`, fresh `git init`.
- Never copy any file from the prototype repo except our own `src/layers/beamControl/*` and `beam-control.css`.
- No mention of the old app's name anywhere in the new repo (code, comments, docs, package metadata, git messages). Verify with a case-insensitive `git grep` for the old product and author names → no output.
- Brand: product name **Beam Control** everywhere. Package names `beam-control` (root), `@beam-control/server`, `@beam-control/web`.
- Honesty: anything simulated is labelled **SIMULATED** on screen (power satellites `PWR-nn · SIMULATED`, receivers `<name> receiver (SIMULATED)`, drills `DRILL-n (SIMULATED)`, the header badge "SIMULATED POWER CONSTELLATION · LIVE TRAFFIC"). Recorded data is never shown as live.
- Carried-over constants are unchanged: HORIZON_S 60, STEP_S 1, RAMP_S 5, THROTTLE_LEAD_S 10, MIN_ELEVATION_DEG 15, BEAM_TYPES laser 2000 m / microwave 600 m, constellation 12×8 at 1200 km 53°, RECEIVERS london-west 51.53, −0.30, laser, 200 MW · paris-nord 49.075, 2.68, laser, 150 MW · tunis 36.87, 10.30, microwave, 100 MW.
- Feed budget: live feed **off by default**. Poll every 15 s only while on. CelesTrak at most once per 2 h (disk cache). Never run the prototype's live flights at the same time.
- Secrets: `server/.env` is git-ignored. Commit only `server/.env.example` with empty `OPENSKY_CLIENT_ID=` and `OPENSKY_CLIENT_SECRET=`.
- Ports: server 3000 (global prefix `api`), web 5173. Vite proxies `/api` → `http://localhost:3000` and `/socket.io` → same target with `ws: true`.
- Commits: no AI attribution trailer (user's global rule).
- Tests: `npm test` at the root runs `vitest run` in both workspaces. Vitest only covers pure modules; Nest DI wiring is checked by booting the server.

## Shared shapes (pinned here so every task agrees)

All positions and velocities are `Vec3 = { x: number; y: number; z: number }`, in ECEF metres and m/s.

```ts
// server/src/core/types.ts — the carried-over controller's shapes, typed
type Kind = 'aircraft' | 'satellite' | 'drill';
interface TrackedObject { id: string; kind: Kind; label: string; position: Vec3; velocity: Vec3 }
interface Receiver { id: string; name: string; lat: number; lon: number; beamType: 'laser' | 'microwave'; capacityMW: number }
interface BeamOut { receiverId: string; satId: string; from: Vec3; to: Vec3; power: number; state: 'ramping-up' | 'on' | 'ramping-down' | 'throttled' }
interface Threat { receiverId: string; satId: string; objectKey: string; label: string; kind: Kind; timeToContactS: number; position: Vec3; contactPoint: Vec3 }
interface ReceiverStatus { id: string; name: string; deliveredMW: number; capacityMW: number; servingSatId: string | null }
interface Snapshot { beams: BeamOut[]; threats: Threat[]; receivers: ReceiverStatus[] }
interface LogEntry { timeMs: number; type: 'intrusion-predicted' | 'handoff' | 'pass-handoff' | 'throttle' | 'restore' | 'no-coverage'; receiverId: string; fromSatId?: string; toSatId?: string; objectKey?: string; label?: string; timeToContactS?: number }
interface Metrics { intrusionsPredicted: number; handoffs: number; throttles: number; contacts: number; uptimePct: number }

// server/src/beam/wire.ts — what the gateway emits and GET /api/state returns
interface FeedStatus { live: boolean; source: string | null; lastUpdateMs: number | null; remaining: number | null; error: string | null; flights: number; satellites: number }
interface WireSnapshot {
  timeMs: number;
  beams: BeamOut[]; threats: Threat[];
  receivers: (ReceiverStatus & { lat: number; lon: number })[];
  metrics: Metrics; log: LogEntry[];               // log: last 8, oldest first
  feed: FeedStatus;
  aircraft: { id: string; label: string; position: Vec3; velocity: Vec3; trackDeg: number }[];
  powerSats: { id: string; name: string; position: Vec3 }[];
  drills: { id: string; label: string; position: Vec3; velocity: Vec3 }[];
}

// server/src/feeds/flights.ts — normalised aircraft fix from any provider
interface Fix { id: string; callsign: string | null; lat: number; lon: number; altM: number; speedMps: number; trackDeg: number; onGround: boolean; fixMs: number }
```

Poll groups (in `server/src/feeds/flights.ts`):

| id | receivers | adsb.lol point | OpenSky box |
|---|---|---|---|
| `europe` | london-west, paris-nord | 50.30, 1.19, 250 nm | lamin 48.3, lamax 52.6, lomin −1.5, lomax 4.2 |
| `tunis` | tunis | 36.87, 10.30, 160 nm | lamin 35.0, lamax 38.7, lomin 7.8, lomax 12.8 |

Unit conversions (pinned): 1 ft = 0.3048 m, 1 kt = 0.514444 m/s.
- adsb.lol: altitude is `alt_geom ?? alt_baro` in ft. `alt_baro === "ground"` means `onGround`. `fixMs = response.now − (ac.seen_pos ?? 0)·1000`.
- OpenSky state vector: `[0 icao24, 1 callsign, 5 lon, 6 lat, 7 baro_alt m, 8 on_ground, 9 velocity m/s, 10 true_track, 13 geo_alt m]`. Altitude is `geo_alt ?? baro_alt`. `fixMs = (s[3] ?? s[4])·1000`.
- Rows without lat/lon are dropped.

## Review Focus

1. **Feed down or rate-limited at the venue.** A provider fetch that rejects, times out (8 s `AbortSignal.timeout`), returns 429 or returns non-JSON must not crash the loop. The status shows the error, old fixes expire within about 35 s, and the drill still works. Tests are in Task 3 (`provider chain …`) and Task 4 (`tracker drops stale fixes`).
2. **OpenSky token expiry mid-demo.** The token is refreshed 60 s before `expires_in`, and a 401 triggers exactly one re-fetch. Tests are in Task 3 (`token cache …`).
3. **CelesTrak unreachable at start-up.** The server runs with zero live satellites, or the stale disk cache if one exists, and never crashes. Test in Task 3 (`tle cache …`).
4. **A tick throws** (bad TLE propagates to NaN, unexpected feed value). The loop catches it, records the error in feed status, and the next tick runs. Test in Task 4 (`safeTick …`).
5. **Browser reload or socket reconnect.** First paint comes from `GET /api/state`. The socket reconnects automatically. Entities are keyed by id and never duplicated. Checked manually in Task 7.

---

### Task 1: Repo scaffold and NestJS skeleton

**Files:**
- Create in `C:\Users\hakim\Desktop\Lumen\beam-control-app\`:
  - root `package.json` (`"name": "beam-control"`, `"private": true`, `"workspaces": ["server","web"]`, scripts `dev`: `concurrently -n server,web "npm run dev -w server" "npm run dev -w web"`, `test`: `npm test --workspaces --if-present`)
  - `.gitignore` (`node_modules/`, `dist/`, `.env`, `server/data/`, `*.log`)
  - `docs/superpowers/specs/2026-10-25-beam-control-fresh-app-design.md` and `docs/superpowers/plans/2026-10-25-beam-control-fresh-app.md` (moved from `C:\Users\hakim\Desktop\Lumen\docs\…`)
- `server/package.json` (`@beam-control/server`; deps: `@nestjs/common`, `core`, `platform-express`, `websockets`, `platform-socket.io` ^11.2.8, `reflect-metadata` ^0.2.2, `rxjs` ^7.8.2, `satellite.js` 6.0.2, `dotenv` ^16; dev: `@nestjs/cli` ^11.0.24, `typescript` ~5.9.3, `vitest` ~3.2.7, `@types/node` ^24; scripts `dev`: `nest start --watch`, `build`: `nest build`, `start`: `node dist/main.js`, `test`: `vitest run`)
- `server/nest-cli.json`, `server/tsconfig.json` (`module`/`moduleResolution` `node16`, `target` ES2022, `strict`, `experimentalDecorators`, `emitDecoratorMetadata`, `esModuleInterop`, `outDir` dist, `rootDir` src), `server/tsconfig.build.json` (excludes `**/*.test.ts`), `server/vitest.config.ts` (`include: ['src/**/*.test.ts']`)
- `server/src/main.ts`, `server/src/app.module.ts`, `server/src/health.controller.ts`, `server/.env.example`

**Interfaces:**
- Produces: `GET /api/health → { ok: true, name: 'Beam Control' }`. `main.ts` loads `dotenv/config`, sets `app.setGlobalPrefix('api')` and enables CORS for `http://localhost:5173`.

- [ ] **Step 1:** Create the folder, `git init`, the files above. Move the spec and plan in. Then `npm install` at the root. Expected: it installs with no `ERESOLVE` errors.
- [ ] **Step 2:** Start the server: `npm run dev -w server`. In another shell: `curl -s http://localhost:3000/api/health`. Expected: `{"ok":true,"name":"Beam Control"}`. Stop the server.
- [ ] **Step 3: Commit** `git add -A && git commit -m "chore: scaffold Beam Control workspace and NestJS server"`

### Task 2: Carry over the safety core as TypeScript

**Files:**
- Create: `server/src/core/types.ts` (shapes above), `server/src/core/geometry.ts`, `constellation.ts`, `controller.ts`, `drill.ts`
- Test: `server/src/core/geometry.test.ts`, `constellation.test.ts`, `controller.test.ts`, `drill.test.ts`, `siting.test.ts`

**Interfaces:**
- Produces: the same exports as the prototype modules (`distancePointToSegment`, `elevationDeg`, `predictContact`, `inBroadPhase`, `enuVelocityToEcef`, `geocentricLatLon`, `trackVelocity`; `MIN_ELEVATION_DEG`, `BEAM_TYPES`, `RECEIVERS`, `createPowerConstellation`, `satellitePositionEcef`, `receiverEcef`, `visibleUntilMs`; `HORIZON_S`, `STEP_S`, `RAMP_S`, `THROTTLE_LEAD_S`, `createBeamController`; `createDrillIntruder`), typed with `types.ts`.
- **One additive change.** `createBeamController` takes an optional `onLog?: (entry: LogEntry) => void`, called for each entry in the order `getLog()` holds them. Task 5 consumes it.

- [ ] **Step 1: Port the tests first.** Copy each prototype `*.test.mjs` to `*.test.ts`. Change only:
  - `import test from 'node:test'` → `import { test } from 'vitest'`;
  - `./x.js` imports → `./x`;
  - TS type annotations where the compiler needs them.

  Keep `node:assert/strict` and every assertion and value. Add one test to `controller.test.ts`:

```ts
test('onLog receives every log entry in log order', () => {
  const seen: LogEntry[] = [];
  const c = createBeamController({ receivers: [RECEIVER], satellites: [A, B], positionAt: (s) => s.pos,
    visibleUntilMs: (s) => s.until, receiverPosition: () => R, onLog: (e) => seen.push(e) });
  for (let t = 0; t <= 10_000; t += 1000) c.tick(t, []);
  for (let s = 0; s <= 5; s++) c.tick(11_000 + s * 1000, [crossingPlane(30, s)]);
  assert.deepEqual(seen, c.getLog());
  assert.ok(seen.some((e) => e.type === 'handoff'));
});
```

- [ ] **Step 2:** Run `npm test -w server`. Expected: FAIL (modules not found).
- [ ] **Step 3:** Port each module from `C:\Users\hakim\Desktop\Lumen\beam-control\src\layers\beamControl\` to TypeScript with the same logic and constants, plus `onLog`. Drop comments that refer to "layers" or the old app. No Cesium imports.
- [ ] **Step 4:** Run `npm test -w server`. Expected: PASS, 26 tests (25 carried + `onLog`).
- [ ] **Step 5: Commit** `feat(core): beam geometry, simulated constellation, controller and drill in TypeScript`

### Task 3: Feeds — flights provider chain, OpenSky token, CelesTrak cache

**Files:**
- Create: `server/src/feeds/flights.ts` (pure), `server/src/feeds/tle.ts` (pure), `server/src/feeds/feeds.service.ts` (Nest, does the HTTP), `server/src/feeds/feeds.module.ts`
- Test: `server/src/feeds/flights.test.ts`, `server/src/feeds/tle.test.ts`

**Interfaces:**
- Produces from `flights.ts`:
  - `POLL_GROUPS` (table above), `POLL_INTERVAL_MS = 15_000`
  - `fromAdsbLol(json, receivedMs): Fix[]`, `fromOpenSky(json): Fix[]`
  - `createTokenCache(fetchToken: () => Promise<{ access_token: string; expires_in: number }>, now: () => number) → { get(): Promise<string>; invalidate(): void }`. It caches until `expires_in − 60 s`.
  - `createProviderChain(providers: { name: string; fetch(group): Promise<{ fixes: Fix[]; remaining: number | null }> }[], now) → { poll(group): Promise<{ fixes: Fix[]; source: string | null; remaining: number | null; error: string | null }> }`:
    - tries providers in order;
    - a provider that throws, or whose error carries `status === 429`, is skipped for 60 s;
    - a provider reporting `remaining === 0` is skipped for 1 h;
    - if all fail it returns `fixes: []` plus the last error message.
- Produces from `tle.ts`:
  - `parseTle(text): { id: string; name: string; satrec }[]`, using satellite.js `twoline2satrec` and skipping malformed sets.
  - `loadTle({ fetchText, readCache, writeCache, cacheAgeMs, now, maxAgeMs = 2 h }) → Promise<{ text: string; fromCache: boolean; error: string | null }>`:
    - fresh cache: no fetch;
    - stale or absent: fetch, then write the cache;
    - fetch fails: stale cache if any, else `''`.
- Produces from `FeedsService` (Nest injectable):
  - `pollFlights(groupId): Promise<{ fixes, source, remaining, error }>`;
  - `liveSatellites(): { id, name, satrec }[]`, loaded at start-up and refreshed every 2 h.

  Providers:
  - OpenSky-with-token, only when both env vars are set;
  - adsb.lol `GET https://api.adsb.lol/v2/point/{lat}/{lon}/{radiusNm}`, `remaining` from `x-ratelimit-remaining`;
  - anonymous OpenSky.

  Every fetch uses `AbortSignal.timeout(8000)`, and a non-2xx response throws an error with `.status`. The OpenSky token comes from `POST https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token` (form `grant_type=client_credentials&client_id&client_secret`). A 401 calls `invalidate()` and retries once. The CelesTrak group is the builder's choice, keeping the Task 4 tick under 200 ms. The cache lives in `server/data/tle-<group>.txt`.

- [ ] **Step 1: Write failing tests** in `flights.test.ts`:
  - `fromAdsbLol converts ft→m, kt→m/s, "ground", fix time`: `{ now: 1_000_000, ac: [{ hex: 'abc123', flight: 'BAW1  ', lat: 51, lon: 0, alt_geom: 10000, gs: 100, track: 90, seen_pos: 2 }, { hex: 'g1', lat: 51, lon: 0, alt_baro: 'ground', gs: 0, track: 0 }, { hex: 'nopos' }] }` gives 2 fixes; the first is `altM 3048`, `speedMps ≈ 51.4444`, `callsign 'BAW1'`, `fixMs 998_000`; the second has `onGround true`, `altM 0`.
  - `fromOpenSky maps state-vector indices`: one state `['abc123','UAE242  ','UAE',1000,1001,-0.04,51.52,11277,false,305.85,103.12,0,null,11422,'2244',false,0]` gives `{ id:'abc123', callsign:'UAE242', lat:51.52, lon:-0.04, altM:11422, speedMps:305.85, trackDeg:103.12, onGround:false, fixMs:1_000_000 }`.
  - `token cache refreshes 60 s before expiry and after invalidate`: the fake fetchToken counts calls. `expires_in: 300`; get at t=0 and t=200 s gives 1 call; get at t=241 s gives 2; `invalidate()` then get gives 3.
  - `provider chain falls back on error and 429, and skips exhausted providers`:
    - A throws `Object.assign(new Error('rate'), { status: 429 })` and B returns 2 fixes: poll gives `source 'B'`, 2 fixes.
    - A second poll within 60 s does not call A.
    - B returning `remaining: 0` is skipped for 1 h.
    - All failing gives `fixes: []`, `source: null`, `error` set.

  In `tle.test.ts`:
  - `parseTle reads 3-line sets and skips junk`: the ISS set from the design doc plus a junk line gives 1 entry with `id '25544'`.
  - `tle cache: fresh cache skips fetch; stale + fetch fail serves stale; nothing + fail is empty with error`: fakes for every dependency.
- [ ] **Step 2:** Run `npm test -w server`. Expected: the new tests FAIL.
- [ ] **Step 3:** Implement `flights.ts` and `tle.ts` to pass them. Then write `FeedsService` and `FeedsModule` with the providers above.
- [ ] **Step 4:** Run `npm test -w server`. Expected: PASS. Then boot the server and check the start-up log shows `TLE: <n> satellites (fromCache …)`, with n > 0 when online.
- [ ] **Step 5: Commit** `feat(feeds): flight provider chain with budget guard, OpenSky token, CelesTrak disk cache`

### Task 4: Beam loop — aircraft tracker, tick service, state endpoint

**Files:**
- Create: `server/src/beam/tracker.ts` (pure), `server/src/beam/wire.ts` (types above), `server/src/beam/beam.service.ts`, `server/src/beam/beam.controller.ts`, `server/src/beam/beam.module.ts`
- Test: `server/src/beam/tracker.test.ts`

**Interfaces:**
- Consumes: the core (Task 2); `FeedsService.pollFlights`, `liveSatellites` (Task 3).
- Produces from `tracker.ts`:
  - `createAircraftTracker({ staleMs = 35_000 }) → { ingest(fixes: Fix[], seenMs: number): void; objects(nowMs): TrackedObject[]; aircraft(nowMs): WireSnapshot['aircraft']; size(): number }`. Fixes with `onGround` are ignored. Each object is dead-reckoned `P = ecef(fix) + v·(nowMs − fixMs)/1000`, with `v = enuVelocityToEcef(lat, lon, speedMps, trackDeg)`. A fix not seen in an ingest for more than `staleMs` is dropped. Labels are `callsign ?? id`.
  - `safeTick<T>(fn: () => T, onError: (e) => void): T | null`.
- Produces from `BeamService`:
  - Builds the controller with real constellation and `RECEIVERS`, `onLog` wired to an rxjs `Subject<LogEntry>` named `log$`.
  - `setInterval` 1000 ms tick:
    - objects = tracker objects + live satellites (SGP4 at now; velocity from the position 1 s ahead) + drills;
    - `controller.tick`;
    - builds `WireSnapshot` (last 8 log entries; live satellites appear only as threats; the feed status);
    - emits it on `snapshot$: Subject<WireSnapshot>`.
  - While live is on, each `POLL_GROUPS` group is polled every `POLL_INTERVAL_MS`.
  - `setLiveFeed(on: boolean)`. Turning it off clears the tracker and sets `feed.source = null`.
  - `triggerDrill(): boolean`, with the same beam choice as the prototype: prefer london-west's serving beam in state `on`, then any serving `on` beam, then any serving beam.
  - `latest(): WireSnapshot`.
- Produces from `BeamController` (Nest): `GET /api/state → latest()`.

- [ ] **Step 1: Write failing tests** in `tracker.test.ts`:
  - `tracker dead-reckons from the fix time`: a fix at lat 0, lon 0, 1000 m, speed 100 m/s, track 90 (east), fixMs 0, ingested at 0. At nowMs 10_000 the object's `y` is about `receiverEcef`-style ECEF y at lon 0 plus 1000 (east is +y at lon 0). Use `geodeticToEcf` for the base point and assert within 1 m.
  - `tracker ignores aircraft on the ground`.
  - `tracker drops stale fixes`: ingest at 0, objects at 36_000 gives `[]`. Re-ingest at 20_000 keeps it at 36_000.
  - `safeTick returns null and reports when fn throws`.
- [ ] **Step 2:** Run `npm test -w server`. Expected: the new tests FAIL.
- [ ] **Step 3:** Implement `tracker.ts`, then the service, controller and module. Register `BeamModule` and `FeedsModule` in `AppModule`. Wrap every tick body in `safeTick`, with the error going into `feed.error`.
- [ ] **Step 4:** Run `npm test -w server`. Expected: PASS. Boot the server and run `curl -s localhost:3000/api/state`. Expected: JSON with 3 receivers, each `deliveredMW` > 0 after about 6 s, `feed.live: false`, and 96 `powerSats`.
- [ ] **Step 5: Commit** `feat(beam): 1 Hz server-side beam loop with aircraft tracker and state endpoint`

### Task 5: Audit log

**Files:**
- Create: `server/src/audit/audit.ts` (pure), `server/src/audit/audit.service.ts`, `server/src/audit/audit.controller.ts`, `server/src/audit/audit.module.ts`
- Test: `server/src/audit/audit.test.ts`

**Interfaces:**
- Consumes: `BeamService.log$` (Task 4).
- Produces:
  - `appendEntry(filePath, entry): Promise<void>` (one JSON object per line; creates the directory if missing);
  - `readNewest(filePath, limit): Promise<LogEntry[]>` (newest first; a missing file gives `[]`; a malformed line is skipped);
  - `GET /api/audit?limit=N` with N clamped to 1–500 (default 100), read-only.

  The service subscribes to `log$` and appends to `server/data/audit.jsonl`.
- [ ] **Step 1: Write failing tests:** `audit append then read returns newest first`, `missing file reads as empty`, `malformed line is skipped`. Use a temp directory from `fs.mkdtemp`.
- [ ] **Step 2:** Run `npm test -w server`. Expected: FAIL.
- [ ] **Step 3:** Implement the module and register it.
- [ ] **Step 4:** Run `npm test -w server`. Expected: PASS. Boot the server. Within 10 s, `curl -s "localhost:3000/api/audit?limit=5"` returns no-coverage or start-up entries, or `[]`. After a drill (Task 6), it returns a handoff.
- [ ] **Step 5: Commit** `feat(audit): append-only decision log with read-only API`

### Task 6: Realtime gateway

**Files:**
- Create: `server/src/gateway/beam.gateway.ts`, `server/src/gateway/gateway.module.ts`
- Create: `server/scripts/smoke-socket.mjs` (a dev check: connects with socket.io-client, prints one snapshot's receiver MW, sends `drill`, and prints the first log entry of type `handoff` within 25 s). Add `socket.io-client` ^4.8.4 as a server devDependency.

**Interfaces:**
- Consumes: `BeamService.snapshot$`, `triggerDrill`, `setLiveFeed` (Task 4).
- Produces: a socket.io gateway (default path `/socket.io`, CORS origin `http://localhost:5173`).
  - Server → client: `snapshot` (WireSnapshot) every tick.
  - Client → server: `drill` (ack `{ ok: boolean }`), `liveFeed` with `{ on: boolean }` (ack `{ live: boolean }`).
- [ ] **Step 1:** Implement the gateway and register it.
- [ ] **Step 2:** Boot the server and run `node server/scripts/smoke-socket.mjs`. Expected: receiver MW values print, then `handoff london-west PWR-xx → PWR-yy (DRILL-1 (SIMULATED) …)` within 25 s.
- [ ] **Step 3: Commit** `feat(gateway): push snapshots over socket.io; drill and live-feed commands`

### Task 7: Web app — globe and scene

**Files:**
- Create: `web/package.json` (`@beam-control/web`; deps `react`, `react-dom` ^19, `cesium` 1.138.0, `socket.io-client` ^4.8.4; dev `vite` ~6.4.3, `@vitejs/plugin-react` ^4.7.0, `vite-plugin-cesium` 1.2.23, `typescript` ~5.9.3, `vitest` ~3.2.7, `@types/react`, `@types/react-dom` ^19; scripts `dev`: `vite`, `build`: `tsc --noEmit && vite build`, `test`: `vitest run`)
- Create: `web/vite.config.ts` (react + cesium plugins; proxy per Global Constraints), `web/tsconfig.json`, `web/index.html` (title "Beam Control")
- Create: `web/src/main.tsx`, `web/src/App.tsx`, `web/src/useSnapshot.ts`, `web/src/Globe.tsx`, `web/src/scene/render.ts`, `web/src/scene/motion.ts`, `web/src/styles.css`
- Test: `web/src/scene/motion.test.ts`

**Interfaces:**
- Consumes: `WireSnapshot` via `import type { WireSnapshot } from '../../server/src/beam/wire'`.
- Produces:
  - `useSnapshot() → { snapshot: WireSnapshot | null; connected: boolean; send(event: 'drill' | 'liveFeed', payload?) }`: first paint from `fetch('/api/state')`, then socket `snapshot` events.
  - `<Globe snapshot onViewer={(viewer) => …} />` creates one Cesium `Viewer` in a `useEffect`:
    - `baseLayer` is an `ImageryLayer` of `UrlTemplateImageryProvider` for the Esri URL, with credit `Esri, Maxar, Earthstar Geographics, and the GIS User Community`;
    - widgets off: `animation`, `timeline`, `geocoder`, `homeButton`, `sceneModePicker`, `baseLayerPicker`, `navigationHelpButton`, `fullscreenButton`, `infoBox`, `selectionIndicator`;
    - `Ion.defaultAccessToken = ''`;
    - it destroys the viewer on unmount.
  - `renderSnapshot(viewer, snapshot)` (in `render.ts`) reuses the prototype's `render()` logic and styling: receivers, power satellites, beams, threats, plus aircraft and drills. Entities are keyed by id and created once; anything not in the snapshot is removed. Labels use plain Cesium labels. Aircraft and drill positions use a `CallbackPositionProperty` from `extrapolate()` so they move smoothly between snapshots.
  - `extrapolate(position: Vec3, velocity: Vec3, dtS: number): Vec3` in `motion.ts`, with dtS clamped to [0, 5].
- [ ] **Step 1: Write the failing test:** `extrapolate moves along velocity and clamps the gap`: `(0,0,0)`, v `(10,0,0)`, dt 2 gives `(20,0,0)`; dt 30 gives `(50,0,0)`; dt −1 gives `(0,0,0)`.
- [ ] **Step 2:** Run `npm test -w web`. Expected: FAIL.
- [ ] **Step 3:** Implement the web files above.
- [ ] **Step 4:** Run `npm test -w web`. Expected: PASS. Then `npm run dev` at the root, open `http://localhost:5173`. Expected:
  - an imagery globe with no Cesium token warning;
  - receivers and 96 orange power satellites;
  - beams from the serving satellites;
  - reloading the page shows no duplicate entities.
- [ ] **Step 5: Commit** `feat(web): React + Cesium globe rendering live snapshots`

### Task 8: Web app — dashboard, Fly-to, drill, live feed, credits

**Files:**
- Create: `web/src/Dashboard.tsx`, `web/src/describeLogEntry.ts`, `web/src/flyTo.ts`, `web/src/TopBar.tsx`, `web/src/Credits.tsx`
- Modify: `web/src/App.tsx`, `web/src/styles.css` (adapt the prototype's `beam-control.css` into a left sidebar layout with a top bar and footer)
- Test: `web/src/describeLogEntry.test.ts`

**Interfaces:**
- Consumes: `useSnapshot` and the viewer from `<Globe onViewer>` (Task 7).
- Produces:
  - `describeLogEntry(entry, receiverName: (id) => string): string`, the same phrasing as the prototype's `describeLogEntry`.
  - `flyToReceiver(viewer, receiver, snapshot)`, the prototype's side-on framing: `flyToBoundingSphere`, range 80 km, pitch −8°, aimed 15 km up the serving beam.
  - `<Dashboard>` with:
    - the header and SIMULATED badge;
    - receiver rows (MW bar, serving satellite, **Fly to**);
    - counters, with contacts green at 0 and red otherwise;
    - feed status: `Live flights: N · Satellites: M · source · last update · remaining`;
    - a **Live feed** switch (sends `liveFeed`) with "Live feed paused" when off;
    - the last 8 log lines, newest first;
    - **Run drill**.

    Rows are keyed React elements. No `innerHTML`, so React escapes live callsigns.
  - `<TopBar>` shows "BEAM CONTROL" and the connection dot. `<Credits>` is the footer: CesiumJS · satellite.js · CelesTrak · OpenSky Network · adsb.lol · Esri World Imagery.
  - On first snapshot, the camera flies once to london-west.
- [ ] **Step 1: Write the failing test:** port the prototype's log phrasing cases. A handoff gives `Handoff London West PWR-02 → PWR-90 (BAW1 in 16 s)`; an intrusion gives `Predicted: BAW1 crosses PWR-02 beam in 16 s`; throttle, restore, pass-handoff and no-coverage each give one line.
- [ ] **Step 2:** Run `npm test -w web`. Expected: FAIL.
- [ ] **Step 3:** Implement the components and wire them into `App.tsx`.
- [ ] **Step 4:** Run `npm test -w web`. Expected: PASS. Manual check at 1440×900 and 1280×720:
  - the camera flies to London West with the beam visible;
  - **Run drill** shows a red path and label, then a handoff in the log, with the London West meter staying ≥ 180 MW;
  - **Live feed** on gives aircraft within about 20 s, and the status shows the source;
  - live feed off says "Live feed paused" and the aircraft disappear;
  - nothing overlaps the globe controls.
- [ ] **Step 5: Commit** `feat(web): Beam Control dashboard with fly-to, drill, live-feed switch and credits`

### Task 9: README, brand check, publish

**Files:**
- Create: `README.md` covering:
  - the pitch paragraph and the honesty rule;
  - the architecture diagram (Mermaid: web ↔ socket.io ↔ NestJS modules ↔ feeds);
  - a built-vs-borrowed table (built: everything in `server/src` and `web/src`; borrowed: CesiumJS, satellite.js, NestJS, React, Vite, socket.io, and the data from CelesTrak, OpenSky, adsb.lol, Esri);
  - the core math, run instructions including `server/.env` for OpenSky, tests, known limitations and next steps (database, roles, multi-operator, weather, flight plans, Moon).
- Create: `docs/demo-script.md`, adapted from the prototype's script to the new app's click path (Fly to → drill / live feed → log → `/api/audit` for the regulator view).

- [ ] **Step 1:** Write both files. Run the brand check (case-insensitive `git grep` for the old product and author names). Expected: no output.
- [ ] **Step 2:** Run `npm test` at the root. Expected: all tests pass in both workspaces.
- [ ] **Step 3: Commit** `docs: README with architecture, credits and demo script`
- [ ] **Step 4:** Publish (the user approved these names):
  - `gh repo rename beam-control-prototype -R yessine-hakim/beam-control --yes`
  - In `C:\Users\hakim\Desktop\Lumen\beam-control`: `git remote set-url origin https://github.com/yessine-hakim/beam-control-prototype.git`
  - In the new folder: `gh repo create yessine-hakim/beam-control --public --source . --remote origin --push --description "Beam Control: air traffic control for space-based solar power"`

  Expected: `gh repo view yessine-hakim/beam-control --json isFork,visibility` gives `{"isFork":false,"visibility":"PUBLIC"}`.
