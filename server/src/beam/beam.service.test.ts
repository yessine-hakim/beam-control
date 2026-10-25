import { test } from 'vitest';
import assert from 'node:assert/strict';
import { BeamService } from './beam.service';
import type { FeedsService } from '../feeds/feeds.service';

test('a failing tick shows on screen and its warning clears once ticks recover', () => {
  let calls = 1; // the first tick succeeds
  const feeds = {
    liveSatellites() {
      calls++;
      if (calls === 1) throw new Error('bad TLE');
      return [];
    },
    satelliteStatus: () => ({ count: 0, error: null }),
    pollFlights: async () => ({ fixes: [], source: null, remaining: null, error: null }),
  } as unknown as FeedsService;
  const service = new BeamService(feeds);
  const emitted: string[] = [];
  service.snapshot$.subscribe((s) => emitted.push(s.feed.error ?? 'ok'));
  const tick = () => (service as unknown as { tick(): void }).tick();

  tick(); // good: establishes a snapshot
  calls = 0; // next liveSatellites() call throws
  tick(); // fails
  assert.match(emitted.at(-1) ?? '', /tick failed: bad TLE/, 'the failure is pushed to screens');
  tick(); // recovers
  assert.equal(service.latest()?.feed.error, null);
  assert.equal(emitted.at(-1), 'ok');
});
