# Beam Control: pitch and demo script

Five minutes, demo included. Then five minutes of Q&A.

## Before you go on stage

1. `npm run dev` in the repo, open http://localhost:5173 in a fresh window, full screen (F11).
2. Wait for **Connected** (top right) and the fly-in to London West, with an orange beam rising from the receiver.
3. Keep **Live feed** off until just before your demo slot; the free feeds have a daily limit.
4. If the venue Wi-Fi drops, the drill still works: the server runs locally.
5. Backup: a screen recording of one live handoff on the laptop.

## Pitch beats (about 3 min talk + 90 s demo)

| Beat | Say | Show |
|---|---|---|
| The future | By the 2040s, satellites beam solar power to the ground. Caltech already did it from orbit in 2023, startups are building it, and launch costs keep falling. | Title slide |
| The problem | Low-orbit beams move, hand off every few minutes, and cross a sky full of planes and satellites. Today's answer is manual: laser "do not fire" windows and airspace closures, built for a handful of fixed beams. Closing the airspace around thousands of moving beams means closing the sky. | Problem slide |
| The users | Power-beaming operators (the console, SaaS licence), aviation and space regulators (read-only audit trail), grid operators (delivery and uptime). | — |
| The solution | Beam Control is air traffic control for power beams: predict, hand off or dim before contact, log everything. | Switch to the app |
| Demo 1 | "This is London West, a simulated receiver in busy London airspace. The orange line is its beam from simulated power satellite PWR-xx. The server is watching all three receivers, live, every second." | Globe + Receivers card |
| Demo 2 | "Switch the live feed on: these are real aircraft right now." | **Live feed** on |
| Demo 3 | "Operators rehearse with a drill, a simulated intruder clearly labelled as such. The path turns red, with a countdown to contact." | **Run drill** |
| Demo 4 | "Beam Control has already handed the receiver to another satellite. The meter stays at 200 MW." | Meter, log |
| Demo 5 | "Every decision is in an append-only audit log a regulator can read. Contacts: zero." | Safety card; optionally `/api/audit` |
| The technology | Server-authoritative NestJS loop, SGP4 orbits, a 60 s straight-line look-ahead with a broad phase, a simple handoff rule. React + Cesium console. | Architecture diagram |
| The impact | Planes stay out of the "wires", satellites aren't blinded, and the city keeps its power. | Closing slide |

## What is simulated (say it before they ask)

- Power satellites PWR-01…96 (12 planes × 8 at 1,200 km, 53°, real SGP4 propagation).
- Receivers London West, Paris Nord, Tunis.
- Drill intruders DRILL-n (SIMULATED).

Everything they avoid is real: live aircraft (OpenSky / adsb.lol) and live satellites (CelesTrak).

## Jury questions

| Question | Answer |
|---|---|
| Aren't these beams low-intensity? | Many microwave designs are; laser and high-power ones are not. The safety radius is per beam type (laser 2 km, microwave 600 m in our config), and regulators would set those numbers. |
| Isn't the constellation fake? | Yes. It doesn't exist yet, so it's labelled SIMULATED. Everything it avoids is real live data. |
| Why not close the airspace? | Thousands of moving beams would mean closing the sky. |
| What did you build vs. use? | We built the safety core, the server modules and the console. We use CesiumJS, satellite.js, NestJS, React and socket.io, plus data from CelesTrak, OpenSky, adsb.lol and Esri. |
| Why a server and NestJS? | Safety can't depend on someone having a browser tab open. The server runs the loop for every receiver around the clock, and screens only view it. NestJS gives one module per job (feeds, beam loop, audit, gateway) and clear places for a database, login and roles next. |
| How does prediction work? | P(t) = P₀ + v·t, sampled each second up to 60 s, against a beam whose satellite end also moves. The first sample inside the safety radius is the time to contact. |
| How do you pick the handoff satellite? | It must be above 15° elevation, have no predicted intrusion, not be serving another receiver and not be about to set. Among those, the longest remaining pass wins. It crossfades over 5 s, so power stays flat. |
| What if no clean satellite exists? | Hold power until 10 s before contact, ramp to zero over 5 s, and restore when clear. Safety beats delivery. |
| Why isn't the receiver under the airport approach? | Every beam ends at the receiver, so an aircraft right over it threatens all of them and only throttling helps. Real receivers would sit in a small restricted zone off the approach paths, and ours are sited that way. |
| How do you know it's safe? | `contacts` counts every tick an object is inside a powered beam. It must stay 0, and the unit tests assert it. |
| Does it scale? | A bounding-box broad phase runs before the exact test, and the loop is independent per receiver, so it parallelises. Today: 3 receivers × ~170 live satellites + hundreds of aircraft at 1 Hz on a laptop. |
| What about the data feeds' limits? | The provider chain falls back between OpenSky and adsb.lol and backs off on rate limits, and satellites are cached for 2 hours. Production would use a licensed feed. |
| Weather? | Not yet. Clouds block lasers, so a weather layer feeding the handoff rule is next. |
| Did you use AI? | Yes, as a coding assistant. We can walk through every module and the tests (`npm test`). |
