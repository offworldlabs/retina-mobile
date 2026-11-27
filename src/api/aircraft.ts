import { queryOptions } from '@tanstack/react-query';

import { api, type ApiClient } from './client';
import { InvalidResponseError } from './errors';

// The view frame and the account's access declare no response model, so those follow the server:
// services/viewport.py for the frame, routes/api_keys.py for /me/access. The data API's aircraft
// and history are typed in schema.gen.ts, and read as loosely as the frame is.

/** A box as south, west, north, east in degrees; west > east crosses the antimeridian. */
export type AircraftBox = readonly [south: number, west: number, north: number, east: number];

/** One aircraft as search reads it: from the public view frame, or from GET /api/v1/aircraft. */
export interface SearchAircraft {
  hex: string;
  lat: number;
  lon: number;
  /** As sent, only when a string. */
  flight?: string;
  /** Feet, or the literal 'ground'. */
  alt_baro?: number | 'ground';
  gs?: number;
  track?: number;
  seen?: number;
  position_source?: string;
  multinode?: boolean;
  n_nodes?: number;
  is_anomalous?: boolean;
  /** The view frame carries it; the data API does not. */
  target_class?: string;
  /** View frame only; never empty. */
  adsb_hex?: string;
  /** View frame only; never empty. */
  predecessor_hex?: string;
}

type Entry = Record<string, unknown>;

const STRING_FIELDS = ['flight', 'position_source', 'target_class'] as const;
const NUMBER_FIELDS = ['gs', 'track', 'n_nodes', 'seen'] as const;
const BOOLEAN_FIELDS = ['multinode', 'is_anomalous'] as const;
const KEY_FIELDS = ['adsb_hex', 'predecessor_hex'] as const;

function isRecord(value: unknown): value is Entry {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

// The rules of aircraftOf in features/map/feed.ts. A null from the data API is a missing field.
function aircraftOf(entry: unknown): SearchAircraft | null {
  if (!isRecord(entry)) return null;
  const { hex, lat, lon, alt_baro } = entry;
  if (typeof hex !== 'string' || hex === '') return null;
  if (!isFiniteNumber(lat) || !isFiniteNumber(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  // Exactly 0, 0 is the "no position" sentinel, which the web map never draws either.
  if (lat === 0 && lon === 0) return null;
  const aircraft: SearchAircraft = { hex, lat, lon };
  if (isFiniteNumber(alt_baro) || alt_baro === 'ground') aircraft.alt_baro = alt_baro;
  for (const field of STRING_FIELDS) {
    const value = entry[field];
    if (typeof value === 'string') aircraft[field] = value;
  }
  for (const field of NUMBER_FIELDS) {
    const value = entry[field];
    if (isFiniteNumber(value)) aircraft[field] = value;
  }
  for (const field of BOOLEAN_FIELDS) {
    const value = entry[field];
    if (typeof value === 'boolean') aircraft[field] = value;
  }
  for (const field of KEY_FIELDS) {
    const value = entry[field];
    if (typeof value === 'string' && value !== '') aircraft[field] = value;
  }
  return aircraft;
}

function aircraftListOf(entries: unknown[]): SearchAircraft[] {
  const aircraft: SearchAircraft[] = [];
  for (const entry of entries) {
    const parsed = aircraftOf(entry);
    if (parsed) aircraft.push(parsed);
  }
  return aircraft;
}

/** GET /api/radar/data/aircraft-live.json?bbox=s,w,n,e: public, the map's own frame for a box. */
export async function fetchViewAircraft(
  box: AircraftBox,
  signal?: AbortSignal,
  client: ApiClient = api,
): Promise<{ aircraft: SearchAircraft[]; clipped: boolean }> {
  const data: unknown = await client.get('/api/radar/data/aircraft-live.json', {
    params: { query: { bbox: box.join(',') } },
    signal,
  });
  if (!isRecord(data) || !Array.isArray(data.aircraft)) {
    throw new InvalidResponseError(
      'GET /api/radar/data/aircraft-live.json: expected { aircraft: [...] }',
    );
  }
  const { viewport } = data;
  return {
    aircraft: aircraftListOf(data.aircraft),
    clipped: isRecord(viewport) && viewport.clipped === true,
  };
}

export interface NetworkAircraftQuery {
  hex?: string;
  callsign?: string;
  alt_min?: number;
  alt_max?: number;
  gs_min?: number;
}

/** GET /api/v1/aircraft with only the keys given; an undefined key is not sent. */
export async function fetchNetworkAircraft(
  query: NetworkAircraftQuery,
  signal?: AbortSignal,
  client: ApiClient = api,
): Promise<SearchAircraft[]> {
  const sent: NetworkAircraftQuery = {};
  if (query.hex !== undefined) sent.hex = query.hex;
  if (query.callsign !== undefined) sent.callsign = query.callsign;
  if (query.alt_min !== undefined) sent.alt_min = query.alt_min;
  if (query.alt_max !== undefined) sent.alt_max = query.alt_max;
  if (query.gs_min !== undefined) sent.gs_min = query.gs_min;
  const data: unknown = await client.get('/api/v1/aircraft', {
    params: { query: sent },
    signal,
  });
  if (!isRecord(data) || !Array.isArray(data.aircraft)) {
    throw new InvalidResponseError('GET /api/v1/aircraft: expected { aircraft: [...] }');
  }
  return aircraftListOf(data.aircraft);
}

/** One recorded position of GET /api/v1/history; ts in epoch seconds. */
export interface AircraftHistoryRow {
  hex: string;
  ts: number;
  lat: number;
  lon: number;
  alt_baro: number | null;
}

export interface AircraftHistoryQuery {
  hexes: readonly string[];
  startMs: number;
  endMs: number;
  limit?: number;
}

const HISTORY_PAGE_LIMIT = 10_000;

function historyRowOf(entry: unknown): AircraftHistoryRow | null {
  if (!isRecord(entry)) return null;
  const { hex, ts, lat, lon, alt_baro } = entry;
  if (typeof hex !== 'string') return null;
  if (!isFiniteNumber(ts) || !isFiniteNumber(lat) || !isFiniteNumber(lon)) return null;
  return { hex, ts, lat, lon, alt_baro: isFiniteNumber(alt_baro) ? alt_baro : null };
}

/**
 * One page of GET /api/v1/history, oldest first. The window goes as epoch-ms strings and the
 * hexes as one lower-cased, de-duplicated comma list. Needs a session with data API access.
 */
export async function fetchAircraftHistory(
  query: AircraftHistoryQuery,
  signal?: AbortSignal,
  client: ApiClient = api,
): Promise<{ rows: AircraftHistoryRow[]; nextCursor: string | null }> {
  const hex = [...new Set(query.hexes.map((value) => value.toLowerCase()))].join(',');
  const data: unknown = await client.get('/api/v1/history', {
    params: {
      query: {
        start: String(query.startMs),
        end: String(query.endMs),
        hex,
        limit: query.limit ?? HISTORY_PAGE_LIMIT,
      },
    },
    signal,
  });
  if (!isRecord(data) || !Array.isArray(data.aircraft)) {
    throw new InvalidResponseError('GET /api/v1/history: expected { aircraft: [...] }');
  }
  const rows: AircraftHistoryRow[] = [];
  for (const entry of data.aircraft) {
    const row = historyRowOf(entry);
    if (row) rows.push(row);
  }
  return { rows, nextCursor: typeof data.next_cursor === 'string' ? data.next_cursor : null };
}

/** What the account's data API access is limited to. A null limit is none. */
export interface DataAccessLimits {
  /** The tier's name; "admin" for an administrator. */
  tier: string;
  requests_per_minute: number | null;
  max_concurrent_streams: number | null;
  /** The longest span of history one request may ask for, in seconds. */
  max_history_span_s: number | null;
}

/** The account's best node against the contributor threshold. */
export interface DataAccessContributor {
  /** Days of the window the best node reported data on. */
  active_days: number;
  window_days: number;
  /** Days a node needs to have reported on to qualify. */
  threshold_days: number;
  /** ISO 8601. While under the threshold with access still running: when it pauses. */
  grace_ends_at: string | null;
}

/** Where the account stands on the data API. Times are ISO 8601 UTC. */
export interface DataAccess {
  /** Whether keys of the account are accepted now. */
  entitled: boolean;
  /** How the access is held; null without it. An administrator needs no key. */
  kind: 'contributor' | 'customer' | 'admin' | null;
  /** Why there is no access; null while there is. */
  reason: 'not_entitled' | 'lapsed' | 'grant_ended' | null;
  limits: DataAccessLimits | null;
  /** Null for an administrator. */
  contributor: DataAccessContributor | null;
  /** When an administrator's grant ends; null for no end date or no grant. */
  grant_ends_at: string | null;
}

type Loose<T> = Partial<Record<keyof T, unknown>>;

const textOrNull = (value: unknown) => (typeof value === 'string' ? value : null);
const countOrNull = (value: unknown) => (isFiniteNumber(value) ? value : null);

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return allowed.find((item) => item === value) ?? null;
}

function limitsOf(data: unknown): DataAccessLimits | null {
  const limits = data as Loose<DataAccessLimits> | null;
  if (typeof limits?.tier !== 'string') return null;
  return {
    tier: limits.tier,
    requests_per_minute: countOrNull(limits.requests_per_minute),
    max_concurrent_streams: countOrNull(limits.max_concurrent_streams),
    max_history_span_s: countOrNull(limits.max_history_span_s),
  };
}

function contributorOf(data: unknown): DataAccessContributor | null {
  const row = data as Loose<DataAccessContributor> | null;
  const { active_days, window_days, threshold_days } = row ?? {};
  if (!isFiniteNumber(active_days) || !isFiniteNumber(window_days)) return null;
  if (!isFiniteNumber(threshold_days)) return null;
  return {
    active_days,
    window_days,
    threshold_days,
    grace_ends_at: textOrNull(row?.grace_ends_at),
  };
}

function accessOf(data: unknown): DataAccess | null {
  const access = data as Loose<DataAccess> | null;
  if (typeof access?.entitled !== 'boolean') return null;
  return {
    entitled: access.entitled,
    kind: oneOf(access.kind, ['contributor', 'customer', 'admin'] as const),
    reason: oneOf(access.reason, ['not_entitled', 'lapsed', 'grant_ended'] as const),
    limits: limitsOf(access.limits),
    contributor: contributorOf(access.contributor),
    grant_ends_at: textOrNull(access.grant_ends_at),
  };
}

/** GET /api/auth/me/access: the signed-in account's standing on the data API. */
export async function fetchDataAccess(
  signal?: AbortSignal,
  client: ApiClient = api,
): Promise<DataAccess> {
  const data: unknown = await client.get('/api/auth/me/access', { signal });
  const access = accessOf(data);
  if (!access) {
    throw new InvalidResponseError('GET /api/auth/me/access: expected { entitled: boolean, ... }');
  }
  return access;
}

/** The server caches an account's entitlement for 30 s, so a fresher read tells nothing new. */
export const dataAccessQuery = (email: string) =>
  queryOptions({
    queryKey: ['aircraft-search', 'data-access', email],
    queryFn: ({ signal }) => fetchDataAccess(signal),
    staleTime: 30_000,
  });
