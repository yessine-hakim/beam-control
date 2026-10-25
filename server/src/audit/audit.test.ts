import { test } from 'vitest';
import assert from 'node:assert/strict';
import { appendFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { LogEntry } from '../core/types';
import { appendEntry, readNewest } from './audit';

const entry = (timeMs: number, type: LogEntry['type'] = 'handoff'): LogEntry => ({ timeMs, type, receiverId: 'london-west' });

test('audit append then read returns newest first', async () => {
  const file = path.join(await mkdtemp(path.join(tmpdir(), 'bc-audit-')), 'nested', 'audit.jsonl');
  await appendEntry(file, entry(1));
  await appendEntry(file, entry(2, 'throttle'));
  await appendEntry(file, entry(3, 'restore'));
  assert.deepEqual((await readNewest(file, 2)).map((e) => e.timeMs), [3, 2]);
  assert.equal((await readNewest(file, 10)).length, 3);
});

test('missing file reads as empty', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'bc-audit-'));
  assert.deepEqual(await readNewest(path.join(dir, 'none.jsonl'), 5), []);
});

test('malformed line is skipped', async () => {
  const file = path.join(await mkdtemp(path.join(tmpdir(), 'bc-audit-')), 'audit.jsonl');
  await appendEntry(file, entry(1));
  await appendFile(file, '{not json\n');
  await appendEntry(file, entry(2));
  assert.deepEqual((await readNewest(file, 10)).map((e) => e.timeMs), [2, 1]);
});
