import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  createProviderChain,
  createTokenCache,
  fromAdsbLol,
  fromOpenSky,
  type FlightProvider,
  type PollGroup,
  type PollResult,
} from './flights';
import { loadTle, parseTle, TLE_MAX_AGE_MS, type LiveSat } from './tle';

const FETCH_TIMEOUT_MS = 8000;
const OPENSKY_TOKEN_URL = 'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token';
const OPENSKY_STATES_URL = 'https://opensky-network.org/api/states/all';
// Low-orbit crowd that can cross a beam. CelesTrak serves each group at most once
// per update (~2 h) per client, so each group has its own disk cache.
const CELESTRAK_GROUPS = ['stations', 'visual', 'starlink'];
const celestrakUrl = (group: string) => `https://celestrak.org/NORAD/elements/gp.php?GROUP=${group}&FORMAT=tle`;
const DATA_DIR = path.resolve(__dirname, '../../data');
const USER_AGENT = 'beam-control/0.1 (IEEE Lumen 2.0 demo)';

class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function getJson(url: string, headers: Record<string, string> = {}) {
  const response = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, ...headers },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new HttpError(`${new URL(url).host} HTTP ${response.status}`, response.status);
  return { json: (await response.json()) as unknown, headers: response.headers };
}

const remainingHeader = (headers: Headers, name: string): number | null => {
  const value = Number.parseInt(headers.get(name) ?? '', 10);
  return Number.isFinite(value) ? value : null;
};

const openSkyQuery = ({ box }: PollGroup) =>
  `${OPENSKY_STATES_URL}?lamin=${box.lamin}&lomin=${box.lomin}&lamax=${box.lamax}&lomax=${box.lomax}`;

@Injectable()
export class FeedsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Feeds');
  private readonly chain = createProviderChain(this.buildProviders());
  private satellites: LiveSat[] = [];
  private satelliteError: string | null = null;
  private refreshTimer: NodeJS.Timeout | null = null;

  onModuleInit() {
    // Never hold start-up on CelesTrak: the loop runs fine with zero live satellites.
    void this.refreshSatellites();
    this.refreshTimer = setInterval(() => void this.refreshSatellites(), TLE_MAX_AGE_MS);
  }

  onModuleDestroy() {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
  }

  pollFlights(group: PollGroup): Promise<PollResult> {
    return this.chain.poll(group);
  }

  liveSatellites(): LiveSat[] {
    return this.satellites;
  }

  satelliteStatus() {
    return { count: this.satellites.length, error: this.satelliteError };
  }

  private buildProviders(): FlightProvider[] {
    const providers: FlightProvider[] = [];
    const clientId = process.env.OPENSKY_CLIENT_ID?.trim();
    const clientSecret = process.env.OPENSKY_CLIENT_SECRET?.trim();
    if (clientId && clientSecret) {
      const token = createTokenCache(async () => {
        const response = await fetch(OPENSKY_TOKEN_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret }),
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
        if (!response.ok) throw new HttpError(`OpenSky token HTTP ${response.status}`, response.status);
        return (await response.json()) as { access_token: string; expires_in: number };
      });
      providers.push({
        name: 'OpenSky',
        async fetch(group) {
          const call = async () => getJson(openSkyQuery(group), { Authorization: `Bearer ${await token.get()}` });
          let result;
          try {
            result = await call();
          } catch (error) {
            if (!(error instanceof HttpError) || error.status !== 401) throw error;
            token.invalidate();
            result = await call();
          }
          return { fixes: fromOpenSky(result.json), remaining: remainingHeader(result.headers, 'x-rate-limit-remaining') };
        },
      });
    }
    providers.push({
      name: 'adsb.lol',
      async fetch({ point }) {
        const { json } = await getJson(`https://api.adsb.lol/v2/point/${point.lat}/${point.lon}/${point.radiusNm}`);
        // Its remaining header tracks the per-second window, not the daily budget.
        return { fixes: fromAdsbLol(json), remaining: null };
      },
    });
    providers.push({
      name: 'OpenSky (anonymous)',
      async fetch(group) {
        const { json, headers } = await getJson(openSkyQuery(group));
        return { fixes: fromOpenSky(json), remaining: remainingHeader(headers, 'x-rate-limit-remaining') };
      },
    });
    this.logger.log(`Flight providers: ${providers.map((p) => p.name).join(' → ')}`);
    return providers;
  }

  private async refreshSatellites() {
    const byId = new Map<string, LiveSat>();
    const errors: string[] = [];
    for (const group of CELESTRAK_GROUPS) {
      const result = await this.loadGroup(group);
      for (const sat of parseTle(result.text)) byId.set(sat.id, sat);
      if (result.error) errors.push(`${group}: ${result.error}`);
      this.logger.log(`TLE ${group}: fromCache ${result.fromCache}${result.error ? `, error: ${result.error}` : ''}`);
    }
    if (byId.size) this.satellites = [...byId.values()];
    this.satelliteError = errors.length ? errors.join('; ') : null;
    this.logger.log(`TLE: ${this.satellites.length} satellites`);
  }

  private loadGroup(group: string) {
    const file = path.join(DATA_DIR, `tle-${group}.txt`);
    return loadTle({
      fetchText: async () => {
        const response = await fetch(celestrakUrl(group), {
          headers: { 'User-Agent': USER_AGENT },
          signal: AbortSignal.timeout(30_000),
        });
        if (!response.ok) throw new HttpError(`CelesTrak HTTP ${response.status}`, response.status);
        return response.text();
      },
      readCache: () => readFile(file, 'utf8').catch(() => null),
      writeCache: async (text) => {
        await mkdir(DATA_DIR, { recursive: true });
        await writeFile(file, text);
      },
      cacheAgeMs: () =>
        stat(file)
          .then((s) => Date.now() - s.mtimeMs)
          .catch(() => null),
    });
  }
}
