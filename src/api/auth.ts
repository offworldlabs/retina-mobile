import { queryOptions } from '@tanstack/react-query';

import { currentSession, isSessionToken } from '../auth/tokenStore';
import { api, type ApiClient } from './client';
import { InvalidResponseError, UnauthorizedError } from './errors';

// The auth routes declare no response models, so these types follow the server: user_to_dict
// in core/users.py for the account, and views in services/owner_nodes.py for a node.

/** The signed-in account, as much of it as the app reads. */
export interface AccountUser {
  id: string;
  email: string;
  /** Null until the account names itself. */
  name: string | null;
}

/**
 * A node's liveness: 'active' or 'disconnected', and 'never_connected' for a node the server has
 * no record of. A node's own heartbeat may report another word, so the set stays open.
 */
export type OwnerNodeStatus = 'active' | 'disconnected' | 'never_connected' | (string & {});

/**
 * Which ends of a node's bistatic pair have coordinates. Apart from its status: a node can be
 * detecting and still be anything but 'positioned'.
 */
export type PositionStatus = 'positioned' | 'missing_rx' | 'missing_tx' | 'missing_both';

const POSITION_STATUSES: readonly string[] = [
  'positioned',
  'missing_rx',
  'missing_tx',
  'missing_both',
];

/** A stock blah2 radar the server polls, as its owner sees it under `polled`. */
export interface OwnedPolledRadar {
  /** As the owner gave it, less any password. */
  address: string;
  unprotected: boolean;
  /** How the server's polls are going, as the poller last wrote it. */
  liveness: 'pending' | 'streaming' | 'stalled' | 'unreachable' | (string & {});
  /** Whether its data reaches the solve and the public map ('graduated') or only its own pages. */
  trust_state: 'probation' | 'graduated' | (string & {});
}

/** A node's geometry as configured, the true positions; null where the node declared none. */
export interface OwnerNodeLocation {
  rx_lat: number | null;
  rx_lon: number | null;
  rx_alt_ft: number | null;
  tx_lat: number | null;
  tx_lon: number | null;
  tx_alt_ft: number | null;
}

/** A node's RF configuration beyond carrier and sample rate; null where unknown. */
export interface OwnerNodeRf {
  tx_callsign: string | null;
  beam_width_deg: number | null;
  beam_azimuth_deg: number | null;
  max_range_km: number | null;
  cpi_s: number | null;
  delay_tolerance_us: number | null;
  doppler_tolerance_hz: number | null;
}

/** One of the signed-in account's nodes: an item of the list, and the answer for one node. */
export interface OwnerNode {
  node_id: string;
  /** The node's public handle; null for a node published nowhere. */
  node_ref: string | null;
  /** What to call it: the owner's label, else the node's own name, else its ref. */
  name: string | null;
  /** The owner's own label, never published; null when unset. */
  label: string | null;
  status: OwnerNodeStatus;
  /** ISO 8601. Empty or null for a node never heard from. */
  last_heartbeat: string | null;
  rx_lat: number | null;
  rx_lon: number | null;
  /** Withheld from every public surface. */
  location_private: boolean;
  config_hash: string | null;
  is_synthetic: boolean;
  position_status: PositionStatus;
  /** Carrier, Hz. */
  frequency: number | null;
  /** Hz. */
  sample_rate: number | null;
  location: OwnerNodeLocation;
  rf: OwnerNodeRf;
  /** The address the node was claimed with; null for a node assigned to the account, polled radars included. */
  claimed_with: string | null;
  /** Null for every node but a polled radar. */
  polled: OwnedPolledRadar | null;
}

function accountUserOf(data: unknown): AccountUser | null {
  const { id, email, name } = (data ?? {}) as Partial<Record<keyof AccountUser, unknown>>;
  if (typeof id !== 'string' || typeof email !== 'string') return null;
  return { id, email, name: typeof name === 'string' ? name : null };
}

function isOwnerNode(data: unknown): data is OwnerNode {
  const node = data as Partial<Record<keyof OwnerNode, unknown>> | null;
  return (
    typeof node?.node_id === 'string' &&
    typeof node.status === 'string' &&
    typeof node.location_private === 'boolean'
  );
}

/** A JSON object, not null and not a list. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A finite number, else null: what an untyped body's "number or null" field is read as. */
export function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** A string, else null. */
export function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function numbersOf<K extends string>(
  data: Record<string, unknown>,
  keys: readonly K[],
): Record<K, number | null> {
  return Object.fromEntries(keys.map((key) => [key, numberOrNull(data[key])])) as Record<
    K,
    number | null
  >;
}

const LOCATION_FIELDS = ['rx_lat', 'rx_lon', 'rx_alt_ft', 'tx_lat', 'tx_lon', 'tx_alt_ft'] as const;
const RF_NUMBERS = [
  'beam_width_deg',
  'beam_azimuth_deg',
  'max_range_km',
  'cpi_s',
  'delay_tolerance_us',
  'doppler_tolerance_hz',
] as const;

function polledOf(data: unknown): OwnedPolledRadar | null {
  if (!isRecord(data)) return null;
  return {
    address: stringOrNull(data.address) ?? '',
    unprotected: data.unprotected === true,
    liveness: stringOrNull(data.liveness) ?? '',
    trust_state: stringOrNull(data.trust_state) ?? '',
  };
}

/**
 * A node view (services/owner_nodes.py) as the app reads it, or null when it lacks what every
 * server sends: node_id, status and location_private. A field an older server leaves out reads
 * as unknown (null, false, empty), and an unknown position status as 'positioned', so no
 * warning is raised that the server did not raise.
 */
export function ownerNodeOf(data: unknown): OwnerNode | null {
  if (!isOwnerNode(data)) return null;
  // Past the three fields checked, every one is read as whatever the server sent.
  const view = data as unknown as Record<string, unknown>;
  const location = isRecord(view.location) ? view.location : {};
  const rf = isRecord(view.rf) ? view.rf : {};
  const position = view.position_status;
  return {
    node_id: data.node_id,
    node_ref: stringOrNull(view.node_ref),
    name: stringOrNull(view.name),
    label: stringOrNull(view.label),
    status: data.status,
    last_heartbeat: stringOrNull(view.last_heartbeat),
    rx_lat: numberOrNull(view.rx_lat),
    rx_lon: numberOrNull(view.rx_lon),
    location_private: data.location_private,
    config_hash: stringOrNull(view.config_hash),
    is_synthetic: view.is_synthetic === true,
    position_status:
      typeof position === 'string' && POSITION_STATUSES.includes(position)
        ? (position as PositionStatus)
        : 'positioned',
    frequency: numberOrNull(view.frequency),
    sample_rate: numberOrNull(view.sample_rate),
    location: numbersOf(location, LOCATION_FIELDS),
    rf: { tx_callsign: stringOrNull(rf.tx_callsign), ...numbersOf(rf, RF_NUMBERS) },
    claimed_with: stringOrNull(view.claimed_with),
    polled: polledOf(view.polled),
  };
}

/**
 * `read`, for the account signed in as `email`: its answer is kept only when the session was
 * that account's from before the request to after it, so one account's data never shows under
 * another's. Otherwise an UnauthorizedError, which no query retries.
 */
export async function readForAccount<T>(email: string, read: () => Promise<T>): Promise<T> {
  if (currentSession()?.email !== email) throw new UnauthorizedError();
  const value = await read();
  if (currentSession()?.email !== email) throw new UnauthorizedError();
  return value;
}

/** Mails a sign-in link that opens the app. A 429 when asked too often. */
export async function requestMagicLink(email: string, client: ApiClient = api): Promise<void> {
  await client.post('/api/auth/magic-link', { body: { email, client: 'app' } });
}

/** Which address a mailed link signs in, without spending it. A 404 for a dead link. */
export async function previewMagicLink(
  token: string,
  signal?: AbortSignal,
  client: ApiClient = api,
): Promise<{ email: string }> {
  const data: unknown = await client.get('/api/auth/magic-link/{token}', {
    params: { path: { token } },
    signal,
  });
  const email = (data as { email?: unknown } | null)?.email;
  if (typeof email !== 'string') {
    throw new InvalidResponseError('GET /api/auth/magic-link/{token}: expected { email: string }');
  }
  return { email };
}

/** Spends a mailed link and opens a session for the app. A 400 for a link used or expired. */
export async function consumeMagicLink(
  token: string,
  client: ApiClient = api,
): Promise<{ sessionToken: string; user: AccountUser }> {
  const data: unknown = await client.post('/api/auth/magic-link/consume', {
    body: { token, client: 'app' },
  });
  const { session_token: sessionToken, user } = (data ?? {}) as Record<string, unknown>;
  const account = accountUserOf(user);
  if (!isSessionToken(sessionToken) || !account) {
    throw new InvalidResponseError(
      'POST /api/auth/magic-link/consume: expected { user: { id, email }, session_token }',
    );
  }
  return { sessionToken, user: account };
}

/** The account the current session signs in. */
export async function fetchMe(signal?: AbortSignal, client: ApiClient = api): Promise<AccountUser> {
  const data: unknown = await client.get('/api/auth/me', { signal });
  const user = accountUserOf(data);
  if (!user) throw new InvalidResponseError('GET /api/auth/me: expected { id, email }');
  return user;
}

/**
 * Ends `sessionToken`'s session on the server. The header is set here, not by the token
 * provider, so this works once the app has forgotten the session, and its 401 (a session
 * already ended) is never taken for the end of the current one.
 */
export async function logout(sessionToken: string, client: ApiClient = api): Promise<void> {
  await client.post('/api/auth/logout', {
    headers: { Authorization: `Bearer ${sessionToken}` },
  });
}

/** The signed-in account's nodes. */
export async function fetchMyNodes(
  signal?: AbortSignal,
  client: ApiClient = api,
): Promise<OwnerNode[]> {
  const data: unknown = await client.get('/api/auth/me/nodes', { signal });
  const nodes = Array.isArray(data) ? data.map(ownerNodeOf) : null;
  if (!nodes || nodes.includes(null)) {
    throw new InvalidResponseError('GET /api/auth/me/nodes: expected a list of nodes');
  }
  return nodes as OwnerNode[];
}

/**
 * The nodes of the account signed in as `email`. The account is in the key, and an answer is
 * kept only when the session was that account's from before the request to after it, so one
 * account's nodes never show under another's.
 */
export const myNodesQuery = (email: string) =>
  queryOptions({
    queryKey: ['auth', 'me', 'nodes', email],
    queryFn: ({ signal }) => readForAccount(email, () => fetchMyNodes(signal)),
  });
