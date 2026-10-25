// Live aircraft: provider responses normalised to one Fix shape, an OpenSky
// token cache, and a provider chain that respects each provider's budget.

export interface Fix {
  id: string;
  callsign: string | null;
  lat: number;
  lon: number;
  altM: number;
  speedMps: number;
  trackDeg: number;
  onGround: boolean;
  fixMs: number;
}

export interface PollGroup {
  id: string;
  receiverIds: string[];
  point: { lat: number; lon: number; radiusNm: number };
  box: { lamin: number; lamax: number; lomin: number; lomax: number };
}

export const POLL_INTERVAL_MS = 15_000;

/** London West + Paris Nord share one query; Tunis has its own. */
export const POLL_GROUPS: readonly PollGroup[] = Object.freeze([
  {
    id: 'europe',
    receiverIds: ['london-west', 'paris-nord'],
    point: { lat: 50.3, lon: 1.19, radiusNm: 250 },
    box: { lamin: 47.0, lamax: 53.5, lomin: -3.5, lomax: 5.0 },
  },
  {
    id: 'tunis',
    receiverIds: ['tunis'],
    point: { lat: 36.87, lon: 10.3, radiusNm: 160 },
    box: { lamin: 35.0, lamax: 38.7, lomin: 7.8, lomax: 12.8 },
  },
]);

const FT_TO_M = 0.3048;
const KT_TO_MPS = 0.514444;
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** adsb.lol `/v2/point` response → fixes. */
export function fromAdsbLol(json: any): Fix[] {
  const now = num(json?.now) ?? Date.now();
  const fixes: Fix[] = [];
  for (const ac of Array.isArray(json?.ac) ? json.ac : []) {
    const lat = num(ac?.lat);
    const lon = num(ac?.lon);
    const id = text(ac?.hex);
    if (lat === null || lon === null || !id) continue;
    const onGround = ac.alt_baro === 'ground';
    const altFt = onGround ? 0 : (num(ac.alt_geom) ?? num(ac.alt_baro) ?? 0);
    fixes.push({
      id,
      callsign: text(ac.flight),
      lat,
      lon,
      altM: altFt * FT_TO_M,
      speedMps: (num(ac.gs) ?? 0) * KT_TO_MPS,
      trackDeg: num(ac.track) ?? 0,
      onGround,
      fixMs: now - (num(ac.seen_pos) ?? 0) * 1000,
    });
  }
  return fixes;
}

/** OpenSky `/states/all` response → fixes. */
export function fromOpenSky(json: any): Fix[] {
  const fixes: Fix[] = [];
  for (const s of Array.isArray(json?.states) ? json.states : []) {
    const lat = num(s?.[6]);
    const lon = num(s?.[5]);
    const id = text(s?.[0]);
    if (lat === null || lon === null || !id) continue;
    const onGround = s[8] === true;
    fixes.push({
      id,
      callsign: text(s[1]),
      lat,
      lon,
      altM: onGround ? 0 : (num(s[13]) ?? num(s[7]) ?? 0),
      speedMps: num(s[9]) ?? 0,
      trackDeg: num(s[10]) ?? 0,
      onGround,
      fixMs: (num(s[3]) ?? num(s[4]) ?? num(json?.time) ?? 0) * 1000,
    });
  }
  return fixes;
}

const TOKEN_EARLY_REFRESH_MS = 60_000;

/** Caches an OAuth access token until 60 s before it expires. */
export function createTokenCache(
  fetchToken: () => Promise<{ access_token: string; expires_in: number }>,
  now: () => number = Date.now,
) {
  let token: string | null = null;
  let refreshAt = 0;
  return {
    async get(): Promise<string> {
      if (token && now() < refreshAt) return token;
      const fresh = await fetchToken();
      token = fresh.access_token;
      refreshAt = now() + fresh.expires_in * 1000 - TOKEN_EARLY_REFRESH_MS;
      return token;
    },
    invalidate() {
      token = null;
    },
  };
}

export interface FlightProvider {
  name: string;
  fetch(group: PollGroup): Promise<{ fixes: Fix[]; remaining: number | null }>;
}

export interface PollResult {
  fixes: Fix[];
  source: string | null;
  remaining: number | null;
  error: string | null;
}

const ERROR_COOLDOWN_MS = 60_000;
const EXHAUSTED_COOLDOWN_MS = 3_600_000;

/**
 * Try providers in order. One that errors (including HTTP 429) rests for a
 * minute; one that reports no budget left rests for an hour, so the pitch never
 * spends requests a provider is about to refuse.
 */
export function createProviderChain(providers: FlightProvider[], now: () => number = Date.now) {
  const restUntil = new Map<string, number>();
  return {
    async poll(group: PollGroup): Promise<PollResult> {
      let lastError: string | null = null;
      for (const provider of providers) {
        if ((restUntil.get(provider.name) ?? 0) > now()) continue;
        try {
          const { fixes, remaining } = await provider.fetch(group);
          if (remaining === 0) restUntil.set(provider.name, now() + EXHAUSTED_COOLDOWN_MS);
          return { fixes, source: provider.name, remaining, error: null };
        } catch (error) {
          restUntil.set(provider.name, now() + ERROR_COOLDOWN_MS);
          lastError = error instanceof Error ? error.message : String(error);
        }
      }
      return {
        fixes: [],
        source: null,
        remaining: null,
        error: lastError ?? 'all flight feeds are resting after errors or exhausted budgets',
      };
    },
  };
}
