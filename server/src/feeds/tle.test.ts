import { test } from 'vitest';
import assert from 'node:assert/strict';
import { loadTle, parseTle } from './tle';

const ISS = [
  'ISS (ZARYA)             ',
  '1 25544U 98067A   26297.20915682  .00007800  00000+0  14938-3 0  9991',
  '2 25544  51.6335  21.6229 0006884 302.9098  57.1228 15.49030149591752',
].join('\n');

test('parseTle reads 3-line sets and skips junk', () => {
  const sats = parseTle(`${ISS}\nthis is not a TLE\n`);
  assert.equal(sats.length, 1);
  assert.equal(sats[0].id, '25544');
  assert.equal(sats[0].name, 'ISS (ZARYA)');
});

test('tle cache: fresh cache skips fetch; stale + fetch fail serves stale; nothing + fail is empty with error', async () => {
  let fetches = 0;
  let written: string | null = null;
  const base = {
    now: () => 10 * 3600_000,
    readCache: async () => 'CACHED',
    writeCache: async (text: string) => {
      written = text;
    },
  };

  const fresh = await loadTle({
    ...base,
    cacheAgeMs: async () => 60_000,
    fetchText: async () => {
      fetches++;
      return 'NEW';
    },
  });
  assert.deepEqual(fresh, { text: 'CACHED', fromCache: true, error: null });
  assert.equal(fetches, 0);

  const refreshed = await loadTle({ ...base, cacheAgeMs: async () => 3 * 3600_000, fetchText: async () => ISS });
  assert.deepEqual(refreshed, { text: ISS, fromCache: false, error: null });
  assert.equal(written, ISS);

  const stale = await loadTle({
    ...base,
    cacheAgeMs: async () => 3 * 3600_000,
    fetchText: async () => {
      throw new Error('offline');
    },
  });
  assert.equal(stale.text, 'CACHED');
  assert.equal(stale.fromCache, true);
  assert.match(stale.error ?? '', /offline/);

  const nothing = await loadTle({
    ...base,
    readCache: async () => null,
    cacheAgeMs: async () => null,
    fetchText: async () => {
      throw new Error('offline');
    },
  });
  assert.deepEqual(nothing, { text: '', fromCache: false, error: 'offline' });
});

test('tle cache remembers a failed download so restarts do not re-ask CelesTrak', async () => {
  let cache: string | null = null;
  let ageMs: number | null = null;
  let fetches = 0;
  const sources = {
    readCache: async () => cache,
    writeCache: async (text: string) => {
      cache = text;
      ageMs = 0;
    },
    cacheAgeMs: async () => ageMs,
    fetchText: async () => {
      fetches++;
      throw new Error('CelesTrak HTTP 403');
    },
  };
  const first = await loadTle(sources);
  assert.equal(first.text, '');
  const second = await loadTle(sources);
  assert.equal(fetches, 1, 'the second start within 2 h does not fetch again');
  assert.equal(second.text, '');
});

test('a 200 response without TLE sets (captive portal) keeps the stale cache', async () => {
  let cache: string | null = ISS;
  const result = await loadTle({
    readCache: async () => cache,
    writeCache: async (text: string) => {
      cache = text;
    },
    cacheAgeMs: async () => 3 * 3600_000,
    fetchText: async () => '<html><body>Please sign in to the venue Wi-Fi</body></html>',
  });
  assert.equal(result.text, ISS);
  assert.equal(result.fromCache, true);
  assert.match(result.error ?? '', /no TLE/);
  assert.equal(cache, ISS, 'the good cache is not overwritten');
});
