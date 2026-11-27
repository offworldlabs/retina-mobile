import { queryOptions } from '@tanstack/react-query';

import {
  isRecord,
  numberOrNull,
  ownerNodeOf,
  readForAccount,
  stringOrNull,
  type OwnerNode,
} from './auth';
import { api, type ApiClient } from './client';
import { InvalidResponseError } from './errors';
import type { RangeBound, RankStatus, SystemConstantBound } from './leaderboard';

// The owner routes (backend/routes/owner.py) declare no response models, so these types follow
// the server's views (services/owner_views.py, performance_views.py, snr_series.py) and the
// web's dashboard/src/types.ts. A 404 on a route about one node means it is not, or no longer,
// on the caller's account.

/** Every owner query key starts with this, so invalidating it refreshes all of them. */
export const OWNER_QUERY_ROOT = ['auth', 'me'] as const;

/** Unfuzzed analytics of one of the account's nodes. The blocks not typed here are read as they come. */
export interface OwnerSummary {
  node_id: string;
  node_ref: string | null;
  trust: { trust_score?: number | null; [key: string]: unknown };
  detection_area: { n_detections?: number | null; [key: string]: unknown };
  metrics: {
    total_detections?: number | null;
    total_frames?: number | null;
    total_tracks?: number | null;
    avg_snr?: number | null;
    max_snr?: number | null;
    availability_7d?: number | null;
    availability_24h?: number | null;
    [key: string]: unknown;
  };
  reputation: Record<string, unknown>;
  coverage_map: Record<string, unknown> | null;
  empirical_coverage: Record<string, unknown> | null;
  node_bias: Record<string, unknown> | null;
  /** Null when there is no performance file for the node. */
  performance?: NodePerformance | null;
}

/** One node's analytics, with its measured performance; null when no file covers the account's time with it. */
export type OwnerNodeAnalytics = OwnerSummary & { performance: NodePerformance | null };

/** Every one of the account's nodes that has analytics, private ones included, keyed by node_ref. */
export interface OwnerAnalytics {
  nodes: Record<string, OwnerSummary>;
}

export type TowerStatus = 'matched' | 'frequency_mismatch' | 'not_found' | 'unsupported_region';

/** The transmitter a node listens to, as far as it is known. */
export interface NodeTower {
  callsign: string | null;
  eirp_dbm: number | null;
  status: TowerStatus | null;
}

/** What filled the delay residual: the node's own tags, or its claims when it has too few tags. */
export type DelayResidualSource = 'tags' | 'claims';

/** One node's measured performance. Aircraft classes and altitudes key the nested records. */
export interface NodePerformance {
  schema: number;
  window: [string, string];
  opportunities: number;
  detections: number;
  detections_claims: number;
  detections_tags: number;
  denominator: 'aggregator' | 'node';
  numerator: 'claims' | 'tags';
  system_constant_db: number | null;
  system_constant_sigma_db: number | null;
  system_constant_bound: SystemConstantBound | null;
  threshold_db: number | null;
  pd_ceiling: number | null;
  pd_by_class_range_alt: Record<string, Record<string, Record<string, number | null>>>;
  evidence_by_class_range_alt: Record<string, Record<string, Record<string, number>>>;
  /** 72 bins of 5 degrees, null where nothing was measured. */
  pd_by_bearing?: (number | null)[];
  tag_delay_residual_mad_us: number | null;
  delay_residual_source: DelayResidualSource | null;
  range_50pct_km: Record<string, number | null>;
  range_50pct_bound: Record<string, RangeBound>;
  classes_with_evidence: string[];
  tower: NodeTower;
  rank_status: RankStatus | null;
  rank: number | null;
}

/** A node's last heartbeat. Only nodes that speak the v1 protocol send one. */
export interface NodeReport {
  received_at: string;
  state: string;
  state_since: string | null;
  uptime_s: number | null;
  config_version: number | null;
  health: Record<string, unknown>;
  versions: Record<string, string | null>;
  errors: { at: string; message: string }[];
}

/** One row of a node's configuration history, newest first. */
export interface ConfigVersion {
  version: number;
  created_at: string;
  /** Null for the version in force. */
  superseded_at: string | null;
  fc_hz: number | null;
  fs_hz: number | null;
  rx_lat: number | null;
  rx_lon: number | null;
  rx_alt_ft: number | null;
  tx_lat: number | null;
  tx_lon: number | null;
  tx_alt_ft: number | null;
  tx_callsign: string | null;
  beam_width_deg: number | null;
  beam_azimuth_deg: number | null;
  max_range_km: number | null;
  cpi_s: number | null;
  delay_tolerance_us: number | null;
  doppler_tolerance_hz: number | null;
}

/** What happened to a node. A kind the app does not know yet still arrives. */
export type OwnerEventKind =
  | 'registered'
  | 'removed'
  | 'graduated'
  | 'returned_to_probation'
  | 'renamed'
  | 'made_private'
  | 'made_public'
  | (string & {});

/** One entry of a node's history, newest first. The stored actor is never sent. */
export interface OwnerEvent {
  kind: OwnerEventKind;
  at: string;
  actor: 'you' | 'owner' | 'admin' | 'system';
  epoch: number | null;
}

/** One five-minute bucket of detection SNR. */
export interface SnrPoint {
  t_ms: number;
  median_db: number;
  p90_db: number;
  count: number;
}

/** Per-bucket SNR of one node's detections. */
export interface SnrSeries {
  /** The window asked for, 1 to 72. */
  hours: number;
  bucket_s: number;
  /** The newest detection included, epoch ms; null when there is no data. */
  through_ms: number | null;
  /** Oldest first; empty buckets are left out. */
  points: SnrPoint[];
}

/** A node that was given one of the account's addresses and is not on the account yet. */
export interface MyClaim {
  node_ref: string;
  /** The address the node was given, which may be a retired one. */
  email: string;
  pending: boolean;
  /** When the outstanding link lapses, in epoch seconds; null with none out. */
  expires_at: number | null;
}

/** Each item parsed, or null when any one of them does not parse. */
function listOf<T>(items: unknown, parse: (item: unknown) => T | null): T[] | null {
  if (!Array.isArray(items)) return null;
  const parsed: T[] = [];
  for (const item of items) {
    const value = parse(item);
    if (value === null) return null;
    parsed.push(value);
  }
  return parsed;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return allowed.find((candidate) => candidate === value) ?? null;
}

const METRIC_NUMBERS = [
  'total_detections',
  'total_frames',
  'total_tracks',
  'avg_snr',
  'max_snr',
  'availability_7d',
  'availability_24h',
];

// A block the analytics manager holds nothing for arrives as null (owner_views.py, _BLOCKS):
// read as an empty one. Its typed figures read as a number or null; the rest as they come.
function blockOf<T>(value: unknown, numbers: readonly string[] = []): T {
  const block: Record<string, unknown> = isRecord(value) ? { ...value } : {};
  for (const key of numbers) block[key] = numberOrNull(block[key]);
  return block as T;
}

function summaryOf(data: unknown): OwnerSummary | null {
  if (!isRecord(data) || typeof data.node_id !== 'string') return null;
  return {
    node_id: data.node_id,
    node_ref: stringOrNull(data.node_ref),
    trust: blockOf(data.trust, ['trust_score']),
    detection_area: blockOf(data.detection_area, ['n_detections']),
    metrics: blockOf(data.metrics, METRIC_NUMBERS),
    reputation: blockOf(data.reputation),
    coverage_map: isRecord(data.coverage_map) ? data.coverage_map : null,
    empirical_coverage: isRecord(data.empirical_coverage) ? data.empirical_coverage : null,
    node_bias: isRecord(data.node_bias) ? data.node_bias : null,
  };
}

function recordOr<T>(value: unknown): T {
  return (isRecord(value) ? value : {}) as T;
}

/**
 * The performance block, its top level read the way the node page relies on it and its nested
 * records as they come. The server sends null for a key the file lacks (performance_views.py,
 * _projected), a tower included. Null when the window it covers is unreadable: figures are
 * not shown without the days they were measured over.
 */
function performanceOf(data: unknown): NodePerformance | null {
  if (!isRecord(data)) return null;
  const { window, tower, pd_by_bearing: bearing, classes_with_evidence: classes } = data;
  if (
    !Array.isArray(window) ||
    window.length !== 2 ||
    typeof window[0] !== 'string' ||
    typeof window[1] !== 'string'
  ) {
    return null;
  }
  const towerFields = isRecord(tower) ? tower : {};
  return {
    schema: numberOrNull(data.schema) ?? 0,
    window: [window[0], window[1]],
    opportunities: numberOrNull(data.opportunities) ?? 0,
    detections: numberOrNull(data.detections) ?? 0,
    detections_claims: numberOrNull(data.detections_claims) ?? 0,
    detections_tags: numberOrNull(data.detections_tags) ?? 0,
    denominator: data.denominator === 'node' ? 'node' : 'aggregator',
    numerator: data.numerator === 'tags' ? 'tags' : 'claims',
    system_constant_db: numberOrNull(data.system_constant_db),
    system_constant_sigma_db: numberOrNull(data.system_constant_sigma_db),
    system_constant_bound: oneOf(data.system_constant_bound, ['measured', 'at_least'] as const),
    threshold_db: numberOrNull(data.threshold_db),
    pd_ceiling: numberOrNull(data.pd_ceiling),
    pd_by_class_range_alt: recordOr(data.pd_by_class_range_alt),
    evidence_by_class_range_alt: recordOr(data.evidence_by_class_range_alt),
    ...(Array.isArray(bearing) ? { pd_by_bearing: bearing.map(numberOrNull) } : {}),
    tag_delay_residual_mad_us: numberOrNull(data.tag_delay_residual_mad_us),
    delay_residual_source: oneOf(data.delay_residual_source, ['tags', 'claims'] as const),
    range_50pct_km: recordOr(data.range_50pct_km),
    range_50pct_bound: recordOr(data.range_50pct_bound),
    classes_with_evidence: Array.isArray(classes)
      ? classes.filter((name): name is string => typeof name === 'string')
      : [],
    tower: {
      callsign: stringOrNull(towerFields.callsign),
      eirp_dbm: numberOrNull(towerFields.eirp_dbm),
      status: stringOrNull(towerFields.status) as TowerStatus | null,
    },
    rank_status: stringOrNull(data.rank_status) as RankStatus | null,
    rank: numberOrNull(data.rank),
  };
}

function reportOf(data: unknown): NodeReport | null {
  if (!isRecord(data)) return null;
  const { received_at: receivedAt, state } = data;
  if (typeof receivedAt !== 'string' || typeof state !== 'string') return null;
  const versions = isRecord(data.versions) ? data.versions : {};
  return {
    received_at: receivedAt,
    state,
    state_since: stringOrNull(data.state_since),
    uptime_s: numberOrNull(data.uptime_s),
    config_version: numberOrNull(data.config_version),
    health: recordOr(data.health),
    versions: Object.fromEntries(
      Object.entries(versions).map(([part, version]) => [
        part,
        typeof version === 'number' ? String(version) : stringOrNull(version),
      ]),
    ),
    errors: Array.isArray(data.errors)
      ? data.errors.filter(isRecord).map((error) => ({
          at: stringOrNull(error.at) ?? '',
          message: stringOrNull(error.message) ?? '',
        }))
      : [],
  };
}

const CONFIG_NUMBERS = [
  'fc_hz',
  'fs_hz',
  'rx_lat',
  'rx_lon',
  'rx_alt_ft',
  'tx_lat',
  'tx_lon',
  'tx_alt_ft',
  'beam_width_deg',
  'beam_azimuth_deg',
  'max_range_km',
  'cpi_s',
  'delay_tolerance_us',
  'doppler_tolerance_hz',
] as const;

function configVersionOf(data: unknown): ConfigVersion | null {
  if (!isRecord(data)) return null;
  const { version, created_at: createdAt } = data;
  if (numberOrNull(version) === null || typeof createdAt !== 'string') return null;
  const numbers = Object.fromEntries(CONFIG_NUMBERS.map((key) => [key, numberOrNull(data[key])]));
  return {
    ...(numbers as Record<(typeof CONFIG_NUMBERS)[number], number | null>),
    version: version as number,
    created_at: createdAt,
    superseded_at: stringOrNull(data.superseded_at),
    tx_callsign: stringOrNull(data.tx_callsign),
  };
}

const ACTORS = ['you', 'owner', 'admin', 'system'] as const;

function eventOf(data: unknown): OwnerEvent | null {
  if (!isRecord(data)) return null;
  const { kind, at } = data;
  if (typeof kind !== 'string' || typeof at !== 'string') return null;
  return {
    kind,
    at,
    // The server's own rule (owner_views.py, _actor_role): an actor it cannot place is the system.
    actor: oneOf(data.actor, ACTORS) ?? 'system',
    epoch: numberOrNull(data.epoch),
  };
}

function snrPointOf(data: unknown): SnrPoint | null {
  if (!isRecord(data)) return null;
  const point = {
    t_ms: numberOrNull(data.t_ms),
    median_db: numberOrNull(data.median_db),
    p90_db: numberOrNull(data.p90_db),
    count: numberOrNull(data.count),
  };
  return Object.values(point).includes(null) ? null : (point as SnrPoint);
}

function snrSeriesOf(data: unknown): SnrSeries | null {
  if (!isRecord(data)) return null;
  const hours = numberOrNull(data.hours);
  const bucketS = numberOrNull(data.bucket_s);
  const points = listOf(data.points, snrPointOf);
  if (hours === null || bucketS === null || !points) return null;
  return { hours, bucket_s: bucketS, through_ms: numberOrNull(data.through_ms), points };
}

function claimOf(data: unknown): MyClaim | null {
  if (!isRecord(data)) return null;
  const { node_ref: nodeRef, email } = data;
  if (typeof nodeRef !== 'string' || typeof email !== 'string') return null;
  const expiresAt = numberOrNull(data.expires_at);
  return {
    node_ref: nodeRef,
    email,
    // The server's own rule (owner.py, my_claims): pending while a link is out.
    pending: typeof data.pending === 'boolean' ? data.pending : expiresAt !== null,
    expires_at: expiresAt,
  };
}

/** One of the account's nodes. A 404 once it is not on the account. */
export async function fetchOwnerNode(
  nodeId: string,
  signal?: AbortSignal,
  client: ApiClient = api,
): Promise<OwnerNode> {
  const data: unknown = await client.get('/api/auth/me/nodes/{node_id}', {
    params: { path: { node_id: nodeId } },
    signal,
  });
  const node = ownerNodeOf(data);
  if (!node) throw new InvalidResponseError('GET /api/auth/me/nodes/{node_id}: expected a node');
  return node;
}

/** The analytics of every one of the account's nodes that has any. */
export async function fetchMyAnalytics(
  signal?: AbortSignal,
  client: ApiClient = api,
): Promise<OwnerAnalytics> {
  const data: unknown = await client.get('/api/auth/me/analytics', { signal });
  const nodes = isRecord(data) && isRecord(data.nodes) ? Object.entries(data.nodes) : null;
  const summaries = nodes?.map(([nodeRef, summary]) => [nodeRef, summaryOf(summary)] as const);
  if (!summaries || summaries.some(([, summary]) => summary === null)) {
    throw new InvalidResponseError('GET /api/auth/me/analytics: expected { nodes: { ... } }');
  }
  // fromEntries defines own keys, so no node_ref can stand for a prototype key.
  return { nodes: Object.fromEntries(summaries) as Record<string, OwnerSummary> };
}

/** One node's analytics and performance; null before it has any. A 404 once it is not on the account. */
export async function fetchNodeAnalytics(
  nodeId: string,
  signal?: AbortSignal,
  client: ApiClient = api,
): Promise<OwnerNodeAnalytics | null> {
  const data: unknown = await client.get('/api/auth/me/nodes/{node_id}/analytics', {
    params: { path: { node_id: nodeId } },
    signal,
  });
  if (data === null) return null;
  const summary = summaryOf(data);
  if (!summary || !isRecord(data)) {
    throw new InvalidResponseError(
      'GET /api/auth/me/nodes/{node_id}/analytics: expected null or a summary',
    );
  }
  return { ...summary, performance: performanceOf(data.performance) };
}

/** A node's last heartbeat report; null when it has sent none since it joined the account. */
export async function fetchNodeReport(
  nodeId: string,
  signal?: AbortSignal,
  client: ApiClient = api,
): Promise<NodeReport | null> {
  const data: unknown = await client.get('/api/auth/me/nodes/{node_id}/report', {
    params: { path: { node_id: nodeId } },
    signal,
  });
  if (data === null) return null;
  const report = reportOf(data);
  if (!report) {
    throw new InvalidResponseError('GET /api/auth/me/nodes/{node_id}/report: expected a report');
  }
  return report;
}

/** A node's configuration versions since it joined the account, newest first, at most 50. */
export async function fetchConfigHistory(
  nodeId: string,
  signal?: AbortSignal,
  client: ApiClient = api,
): Promise<ConfigVersion[]> {
  const data: unknown = await client.get('/api/auth/me/nodes/{node_id}/config-history', {
    params: { path: { node_id: nodeId }, query: { limit: 50 } },
    signal,
  });
  const versions = isRecord(data) ? listOf(data.versions, configVersionOf) : null;
  if (!versions) {
    throw new InvalidResponseError(
      'GET /api/auth/me/nodes/{node_id}/config-history: expected { versions: [...] }',
    );
  }
  return versions;
}

/** What was recorded about a node since it joined the account, newest first, at most 100. */
export async function fetchNodeEvents(
  nodeId: string,
  signal?: AbortSignal,
  client: ApiClient = api,
): Promise<OwnerEvent[]> {
  const data: unknown = await client.get('/api/auth/me/nodes/{node_id}/events', {
    params: { path: { node_id: nodeId }, query: { limit: 100 } },
    signal,
  });
  const events = isRecord(data) ? listOf(data.events, eventOf) : null;
  if (!events) {
    throw new InvalidResponseError(
      'GET /api/auth/me/nodes/{node_id}/events: expected { events: [...] }',
    );
  }
  return events;
}

/** A node's detection SNR over the last `hours` (1 to 72), per five-minute bucket. */
export async function fetchNodeSnr(
  nodeId: string,
  hours: number,
  signal?: AbortSignal,
  client: ApiClient = api,
): Promise<SnrSeries> {
  const data: unknown = await client.get('/api/auth/me/nodes/{node_id}/snr', {
    params: { path: { node_id: nodeId }, query: { hours } },
    signal,
  });
  const series = snrSeriesOf(data);
  if (!series) {
    throw new InvalidResponseError(
      'GET /api/auth/me/nodes/{node_id}/snr: expected { hours, bucket_s, points: [...] }',
    );
  }
  return series;
}

/** The open claims addressed to the account: nodes given one of its addresses, not on it yet. */
export async function fetchMyClaims(
  signal?: AbortSignal,
  client: ApiClient = api,
): Promise<MyClaim[]> {
  const data: unknown = await client.get('/api/auth/me/claims', { signal });
  const claims = listOf(data, claimOf);
  if (!claims) throw new InvalidResponseError('GET /api/auth/me/claims: expected a list of claims');
  return claims;
}

/**
 * Mails a claim's link again; the new link replaces the one out. A 404 once the claim is not
 * open or not addressed to the account, a 409 when the node has an owner, a 429 when asked
 * too often.
 */
export async function resendClaim(nodeRef: string, client: ApiClient = api): Promise<void> {
  await client.post('/api/auth/me/claims/{node_ref}/resend', {
    params: { path: { node_ref: nodeRef } },
  });
}

/** Hands a node back so its next owner can claim it. A 404 when it is not on the account. */
export async function releaseNode(nodeId: string, client: ApiClient = api): Promise<void> {
  await client.delete('/api/auth/me/nodes/{node_id}/claim', {
    params: { path: { node_id: nodeId } },
  });
}

// Each query below is keyed on the account and reads through readForAccount, as myNodesQuery
// does, so one account's answer is never cached or shown under another's.

const nodeKey = (email: string, nodeId: string) =>
  [...OWNER_QUERY_ROOT, 'node', email, nodeId] as const;

export const myClaimsQuery = (email: string) =>
  queryOptions({
    queryKey: [...OWNER_QUERY_ROOT, 'claims', email],
    queryFn: ({ signal }) => readForAccount(email, () => fetchMyClaims(signal)),
  });

export const myAnalyticsQuery = (email: string) =>
  queryOptions({
    queryKey: [...OWNER_QUERY_ROOT, 'analytics', email],
    queryFn: ({ signal }) => readForAccount(email, () => fetchMyAnalytics(signal)),
  });

export const ownerNodeQuery = (email: string, nodeId: string) =>
  queryOptions({
    queryKey: nodeKey(email, nodeId),
    queryFn: ({ signal }) => readForAccount(email, () => fetchOwnerNode(nodeId, signal)),
  });

export const nodeAnalyticsQuery = (email: string, nodeId: string) =>
  queryOptions({
    queryKey: [...nodeKey(email, nodeId), 'analytics'],
    queryFn: ({ signal }) => readForAccount(email, () => fetchNodeAnalytics(nodeId, signal)),
  });

export const nodeReportQuery = (email: string, nodeId: string) =>
  queryOptions({
    queryKey: [...nodeKey(email, nodeId), 'report'],
    queryFn: ({ signal }) => readForAccount(email, () => fetchNodeReport(nodeId, signal)),
  });

export const configHistoryQuery = (email: string, nodeId: string) =>
  queryOptions({
    queryKey: [...nodeKey(email, nodeId), 'config-history'],
    queryFn: ({ signal }) => readForAccount(email, () => fetchConfigHistory(nodeId, signal)),
  });

export const nodeEventsQuery = (email: string, nodeId: string) =>
  queryOptions({
    queryKey: [...nodeKey(email, nodeId), 'events'],
    queryFn: ({ signal }) => readForAccount(email, () => fetchNodeEvents(nodeId, signal)),
  });

export const nodeSnrQuery = (email: string, nodeId: string, hours: number) =>
  queryOptions({
    queryKey: [...nodeKey(email, nodeId), 'snr', hours],
    queryFn: ({ signal }) => readForAccount(email, () => fetchNodeSnr(nodeId, hours, signal)),
  });
