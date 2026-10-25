# Beam Control — fresh standalone app (design)

Date: 2026-10-25 · Pitch: 25 Oct 2026, 09:00 (Tunis time; 08:00 UK) · Author: Yessine Hakim

## Intent and why

Beam Control is "air traffic control for space-based solar power". It was first prototyped as a layer inside a large general-purpose globe app with dozens of unrelated layers, where it read as a feature rather than a product.

This project rebuilds Beam Control as **its own product from the first screen**, with an architecture that matches the claim: the safety loop runs on a **server**, around the clock, for every receiver, and every screen is only a viewer. It keeps the safety logic, the live data and the demo story, and leaves everything else behind. No code from the old app is copied, so nothing of it needs crediting. Credits list only what the new app really uses.

Success, in your words: the jury should see Beam Control as your own product. The stack should be solid and scalable, and defensible in Q&A.

## Goals

1. A fresh Beam Control app, in a new folder and a new GitHub repo with fresh history, branded **Beam Control** everywhere (title, header, README, package names).
2. **Server-authoritative safety.** A NestJS server runs the 1 Hz loop for all receivers, whether or not a browser is open, so safety never depends on a tab or the camera.
3. The same core behaviour as the current version, carried over and converted to TypeScript with its tests: beam geometry, simulated constellation, controller (predict → hand off / throttle → log), drill.
4. **Live data on the server:**
   - aircraft near the receivers: OpenSky with your account, falling back to adsb.lol;
   - live satellites: CelesTrak;
   - plus the SIMULATED power satellites.
5. **Audit trail.** Every decision is appended to a log file and served by a read-only REST endpoint (the regulator's view).
6. **Web app (React + TypeScript + Cesium) as a viewer:**
   - a globe with keyless imagery, beams, receivers, planes moving smoothly, threats and the dashboard (receivers and MW, counters, feed status, log, Fly-to);
   - it sends only two commands: **Run drill** and **Live feed on/off**.
7. It holds up in a 90-second live demo, including when the flight feed is slow, rate-limited or offline (the drill still works).
8. Honest credits: CesiumJS, satellite.js, NestJS, React, CelesTrak, OpenSky Network, adsb.lol, Esri World Imagery (on-screen attribution as Esri requires).

## Non-goals (pitched as next steps, not built)

- Database, login, user roles, multiple operators or tenants. The module layout leaves a clear place for each.
- Production deployment. A local `npm run dev` demo is enough.
- Anything from the old app beyond what Beam Control needs: voice, share links, i18n, HUD styles, other layers.
- Weather model, flight-plan prediction, lunar scenario.
- Pixel-perfect mobile layout. It must work on a laptop or projector at 1280×720 and up.

## Anti-goals (failure even if it "works")

- Any of the old app's code, text, logo or name in the new repo.
- Anything that looks like surveillance or spy UI.
- Simulated things not labelled **SIMULATED**, or recorded data shown as live. The drill is always "DRILL-n (SIMULATED)".
- Getting rate-limited or IP-banned by a provider before 09:00: CelesTrak bans repeat downloaders, adsb.lol allows 500 requests/day, anonymous OpenSky about 400.
- The safety numbers regressing: `contacts` stays 0 in every carried-over test.

## Constraints

- **Deadline.** Aim to be done by about 07:00, then rehearse. The old prototype stays untouched as the fallback demo (renamed `beam-control-prototype` on GitHub). You pick which to pitch.
- **Rules (Spec Book Part III):** credit significant external work (12.4), understand what you built (12.5), core feature works end to end live (12.3).
- **Keyless data, measured tonight:**
  - adsb.lol `GET https://api.adsb.lol/v2/point/{lat}/{lon}/{radiusNm}`: no key needed, JSON `{ac:[{hex, flight, lat, lon, alt_baro|"ground", alt_geom (ft), gs (kt), track, ...}]}`, rate limit 4/s, 60/min, 500/day (`500;w=86400`).
  - OpenSky `GET https://opensky-network.org/api/states/all?lamin&lomin&lamax&lomax`: works anonymously (about 400 credits/day; boxes under 25 square degrees cost 1). With an account, about 4,000.
  - CelesTrak `https://celestrak.org/NORAD/elements/gp.php?GROUP=…&FORMAT=tle`: works. Do not re-download a group more often than about every 2 hours.
  - Esri World Imagery `https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}`: keyless, CORS `*`. Attribution is required.
- **Pinned stack** (versions proven tonight or known to work together; not the newest majors):

  | Part | Choice |
  |---|---|
  | Runtime | Node 24 (24.12 installed) |
  | Server | NestJS 11 (`@nestjs/core`, `common`, `platform-express`, `websockets`, `platform-socket.io` 11.2.x), `@nestjs/cli` 11, `reflect-metadata`, `rxjs` 7 |
  | Web | React 19, Vite 6.4, `@vitejs/plugin-react` 4.7, `vite-plugin-cesium` 1.2.23, Cesium 1.138, `socket.io-client` 4.8 |
  | Orbits | satellite.js 6.0.2 (loads under CommonJS) |
  | Language / tests | TypeScript 5.9 everywhere, Vitest 3.2 |
  | Repo tooling | npm workspaces, `concurrently` 9 |

## How (decided)

**Repo and folder.** A new local folder `C:\Users\hakim\Desktop\Lumen\beam-control-app`, `git init`, published to a new non-fork GitHub repo named `beam-control` (after the fork is renamed). It contains npm workspaces with two packages:

- `server/`: NestJS. The safety core lives here in `server/src/core/` as plain TypeScript with no Nest imports: geometry, constellation, controller, drill and their tests.
  - My call: one copy of the core, on the server, since the server runs the loop.
  - The web app imports only **types** from it (`import type …`, erased at build), so it has no runtime dependency on server code.
- `web/`: React + Vite + Cesium.
- `npm run dev` at the root starts both: Nest on :3000, Vite on :5173. Vite proxies `/api` and `/socket.io` to Nest.

**Carried over and converted to TypeScript (our own code from tonight):** `geometry`, `constellation`, `controller`, `drill`, with all their tests including `siting`. The behaviour, constants and test cases stay unchanged; only types are added. `panel.js` and `beam-control.css` are the reference for the React dashboard's content and look.

**Server modules (NestJS):**
- **FeedsModule.**
  - Flights: a provider chain. With credentials, OpenSky via OAuth client credentials is primary (token from `POST https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token`, refreshed before expiry). Otherwise, and on 429 or error, adsb.lol; then anonymous OpenSky.
  - Each response is normalised to `{id, callsign, lat, lon, altM, speedMps, trackDeg, onGround, fixMs}`.
  - Satellites: CelesTrak TLE cached on disk for 2 hours.
  - A budget guard stops calling a provider at 0 remaining or on 429, and reports source, last update and remaining budget.
- **BeamControlModule.** A service that ticks at 1 Hz.
  - Builds objects: aircraft dead-reckoned from their last fix, live satellites by SGP4, drills.
  - Calls `controller.tick` and keeps the latest snapshot.
  - Exposes `triggerDrill()` and `setLiveFeed(on)`.
- **Polling (my call: safety stays camera-independent).**
  - One query centred between London West and Paris Nord (250 nm radius covers both), and one for Tunis.
  - Both every 15 s while the live feed is on; about 480 requests/hour.
  - Live feed is **off by default**, so building and rehearsal don't spend the pitch's budget. With it off, the dashboard says "Live feed paused" and shows no aircraft.
  - A fix is kept until two polls pass without it (about 30 s), then dropped.
  - Never run the old prototype's live flights at the same time.
- **AuditModule.** Every log entry the controller emits is appended to `server/data/audit.jsonl` (git-ignored). `GET /api/audit?limit=N` returns the newest N entries, read-only.
- **GatewayModule** (socket.io). Emits `snapshot` every tick to all clients:
  - beams, threats, receivers, metrics, the last 8 log entries, feed status;
  - aircraft positions and velocities;
  - power-satellite positions;
  - live satellites only when they are threats.

  It accepts `drill` and `liveFeed` messages. `GET /api/state` returns the same snapshot for first paint.

**Web app (React + TypeScript):**
- **`<Globe>`** mounts a plain Cesium Viewer once (no Resium wrapper):
  - no Ion token, no default widgets, Esri imagery, ellipsoid terrain;
  - entities for receivers (labelled "<name> receiver (SIMULATED)"), power satellites, beams (glow polylines: orange on, red when throttled or fading after a threat), threat paths with "⚠ CALLSIGN · N s" labels, aircraft (rotated plane icon + callsign) and drills (red point);
  - between 1 Hz snapshots, planes move smoothly by dead reckoning from position + velocity.
- **`<Dashboard>`** (left sidebar):
  - header "BEAM CONTROL" with a "SIMULATED POWER CONSTELLATION · LIVE TRAFFIC" badge;
  - per-receiver MW bar and serving satellite with **Fly to** (side-on to the serving beam, as in the prototype);
  - counters (intrusions, handoffs, throttles, contacts, uptime) and feed status with the **Live feed** switch;
  - the log, newest first, in plain words as in the prototype, and **Run drill**.
- **Top bar** with the product name and connection state. A footer shows "Data & credits", with Esri attribution.
- On load, the camera flies to London West.

## Left to the builder

- File and class names inside each module, DTO shapes beyond the snapshot fields above, and the Nest wiring style.
- How the old `panel.js` markup maps to React components. Keep its content and wording.
- Exact styling (palette from the prototype: orange `#ffa630`, red `#ff4d4d`, cyan `#4dd2ff`), plane icon artwork and label density.
- OpenSky box sizing (keep under 25 square degrees where possible) and which CelesTrak groups to load. The server tick must stay under about 200 ms.
- Tests for the new pure pieces: feed normalisation, provider fallback and budget decisions, dead reckoning, poll scheduling, audit append/read. Nest DI wiring itself needs no unit tests.
- Comment clean-ups in carried code.

## Decided with Yessine

1. **GitHub.** Rename the fork `yessine-hakim/beam-control` to `beam-control-prototype` (contents untouched). The fresh app becomes a new non-fork repo `beam-control`.
2. **Concept PDF.** Out of scope; not included in the new repo.
3. **Flight budget.** Yessine creates a free OpenSky account and puts its API client credentials in `server/.env` as `OPENSKY_CLIENT_ID` / `OPENSKY_CLIENT_SECRET`. `.env` is git-ignored; `.env.example` lists the names with empty values. Without credentials, the order is adsb.lol, then anonymous OpenSky.
4. **Stack and architecture.** NestJS server owns the safety loop; React + TypeScript web app is a viewer; TypeScript throughout.
