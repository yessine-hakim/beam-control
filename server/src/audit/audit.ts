// Append-only audit trail: one JSON decision per line, so regulators can read
// every intervention back and nothing is ever rewritten.
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { LogEntry } from '../core/types';

export async function appendEntry(filePath: string, entry: LogEntry): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await appendFile(filePath, `${JSON.stringify(entry)}\n`);
}

/** Newest first; a missing file reads as empty and a malformed line is skipped. */
export async function readNewest(filePath: string, limit: number): Promise<LogEntry[]> {
  let text: string;
  try {
    text = await readFile(filePath, 'utf8');
  } catch {
    return [];
  }
  const entries: LogEntry[] = [];
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0 && entries.length < limit; i--) {
    if (!lines[i].trim()) continue;
    try {
      entries.push(JSON.parse(lines[i]) as LogEntry);
    } catch {
      // skip a torn or corrupted line
    }
  }
  return entries;
}
