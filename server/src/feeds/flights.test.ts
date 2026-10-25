import { test } from 'vitest';
import assert from 'node:assert/strict';
import { createProviderChain, createTokenCache, fromAdsbLol, fromOpenSky, POLL_GROUPS, type Fix } from './flights';

test('fromAdsbLol converts ft→m, kt→m/s, "ground", fix time', () => {
  const fixes = fromAdsbLol({
    now: 1_000_000,
    ac: [
      { hex: 'abc123', flight: 'BAW1  ', lat: 51, lon: 0, alt_geom: 10000, gs: 100, track: 90, seen_pos: 2 },
      { hex: 'g1', lat: 51, lon: 0, alt_baro: 'ground', gs: 0, track: 0 },
      { hex: 'nopos' },
    ],
  });
  assert.equal(fixes.length, 2);
  assert.equal(fixes[0].altM, 3048);
  assert.ok(Math.abs(fixes[0].speedMps - 51.4444) < 1e-3);
  assert.equal(fixes[0].callsign, 'BAW1');
  assert.equal(fixes[0].fixMs, 998_000);
  assert.equal(fixes[1].onGround, true);
  assert.equal(fixes[1].altM, 0);
});

test('fromOpenSky maps state-vector indices', () => {
  const [fix] = fromOpenSky({
    time: 1001,
    states: [['abc123', 'UAE242  ', 'UAE', 1000, 1001, -0.04, 51.52, 11277, false, 305.85, 103.12, 0, null, 11422, '2244', false, 0]],
  });
  assert.deepEqual(fix, {
    id: 'abc123',
    callsign: 'UAE242',
    lat: 51.52,
    lon: -0.04,
    altM: 11422,
    speedMps: 305.85,
    trackDeg: 103.12,
    onGround: false,
    fixMs: 1_000_000,
  });
});

test('token cache refreshes 60 s before expiry and after invalidate', async () => {
  let now = 0;
  let calls = 0;
  const cache = createTokenCache(async () => {
    calls++;
    return { access_token: `t${calls}`, expires_in: 300 };
  }, () => now);
  assert.equal(await cache.get(), 't1');
  now = 200_000;
  assert.equal(await cache.get(), 't1');
  assert.equal(calls, 1);
  now = 241_000;
  assert.equal(await cache.get(), 't2');
  cache.invalidate();
  assert.equal(await cache.get(), 't3');
});

test('provider chain falls back on error and 429, and skips exhausted providers', async () => {
  let now = 0;
  const calls: string[] = [];
  const fix = (id: string): Fix => ({ id, callsign: null, lat: 0, lon: 0, altM: 0, speedMps: 0, trackDeg: 0, onGround: false, fixMs: 0 });
  let bRemaining: number | null = 10;
  let bFails = false;
  const chain = createProviderChain(
    [
      {
        name: 'A',
        async fetch() {
          calls.push('A');
          throw Object.assign(new Error('rate'), { status: 429 });
        },
      },
      {
        name: 'B',
        async fetch() {
          calls.push('B');
          if (bFails) throw new Error('down');
          return { fixes: [fix('1'), fix('2')], remaining: bRemaining };
        },
      },
    ],
    () => now,
  );
  const group = POLL_GROUPS[0];
  const first = await chain.poll(group);
  assert.equal(first.source, 'B');
  assert.equal(first.fixes.length, 2);
  assert.equal(first.remaining, 10);

  now = 30_000;
  await chain.poll(group);
  assert.deepEqual(calls, ['A', 'B', 'B'], 'A is skipped for 60 s after a 429');

  bRemaining = 0;
  now = 40_000;
  await chain.poll(group);
  now = 50_000;
  const exhausted = await chain.poll(group);
  assert.equal(exhausted.source, null, 'B reported 0 remaining, A still cooling down');
  assert.equal(exhausted.fixes.length, 0);
  assert.ok(exhausted.error);

  now = 100_000;
  bFails = true;
  calls.length = 0;
  const allDown = await chain.poll(group);
  assert.deepEqual(calls, ['A'], 'B stays skipped for an hour after reporting 0 remaining');
  assert.equal(allDown.source, null);
  assert.match(allDown.error ?? '', /rate/);
});
