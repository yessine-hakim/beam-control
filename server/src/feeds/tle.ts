// Live satellites from CelesTrak TLE text, behind a disk cache so restarts and
// reloads never re-download a group more often than CelesTrak allows.
import { twoline2satrec, type SatRec } from 'satellite.js';

export interface LiveSat {
  id: string;
  name: string;
  satrec: SatRec;
}

/** Parse 3-line TLE sets (name, line 1, line 2); malformed sets are skipped. */
export function parseTle(text: string): LiveSat[] {
  const lines = text.split(/\r?\n/).map((l) => l.trimEnd());
  const sats: LiveSat[] = [];
  for (let i = 0; i + 2 < lines.length + 1; i++) {
    const [name, l1, l2] = [lines[i], lines[i + 1], lines[i + 2]];
    if (!l1?.startsWith('1 ') || !l2?.startsWith('2 ') || !name) continue;
    try {
      const satrec = twoline2satrec(l1, l2);
      if (satrec.error) continue;
      sats.push({ id: l1.slice(2, 7).trim(), name: name.trim(), satrec });
      i += 2;
    } catch {
      // skip a malformed set
    }
  }
  return sats;
}

export const TLE_MAX_AGE_MS = 2 * 3_600_000;

export interface TleSources {
  fetchText: () => Promise<string>;
  readCache: () => Promise<string | null>;
  writeCache: (text: string) => Promise<void>;
  cacheAgeMs: () => Promise<number | null>;
  now?: () => number;
  maxAgeMs?: number;
}

/** Fresh cache wins; otherwise fetch and cache; if fetching fails, fall back to any stale cache. */
export async function loadTle({ fetchText, readCache, writeCache, cacheAgeMs, maxAgeMs = TLE_MAX_AGE_MS }: TleSources) {
  const age = await cacheAgeMs();
  if (age !== null && age < maxAgeMs) {
    const cached = await readCache();
    // An empty cache is a remembered failure: wait for the next update window.
    if (cached !== null) return { text: cached, fromCache: true, error: null as string | null };
  }
  try {
    const text = await fetchText();
    // A 200 that isn't TLE (captive portal, error page) must not replace a good cache.
    if (!parseTle(text).length) throw new Error('response held no TLE sets');
    await writeCache(text);
    return { text, fromCache: false, error: null as string | null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const stale = await readCache();
    if (stale) return { text: stale, fromCache: true, error: message };
    await writeCache('').catch(() => {});
    return { text: '', fromCache: false, error: message };
  }
}
