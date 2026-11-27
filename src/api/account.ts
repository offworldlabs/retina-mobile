import { queryOptions } from '@tanstack/react-query';

import { currentSession } from '../auth/tokenStore';
import { fetchMe, type AccountUser } from './auth';
import { api, type ApiClient } from './client';
import {
  HttpError,
  InvalidResponseError,
  NetworkError,
  TimeoutError,
  UnauthorizedError,
} from './errors';

// The account routes declare no response models either, so these types follow the server:
// routes/auth.py for sessions, routes/api_keys.py and services/entitlements.py for access and
// keys, routes/account.py for the name and deletion.

/** One device signed in to the account. Times are epoch seconds. */
export interface AccountSession {
  id: string;
  created_at: number;
  last_used_at: number;
  expires_at: number;
  /** The server's short label for the client, such as "Firefox on Windows". */
  user_agent: string | null;
  /** The network the client was in, a /24 or a /48, never its address. */
  ip: string | null;
  /** The session asking. */
  current: boolean;
}

/** What the account's data API access is limited to. A null limit is none. */
export interface ApiAccessLimits {
  /** The tier's name; "admin" for an administrator. */
  tier: string;
  requests_per_minute: number | null;
  max_concurrent_streams: number | null;
  /** The longest span of history one request may ask for, in seconds. */
  max_history_span_s: number | null;
}

/** The account's best node against the contributor threshold. */
export interface ApiAccessContributor {
  /** Days of the window the best node reported data on. */
  active_days: number;
  window_days: number;
  /** Days a node needs to have reported on to qualify. */
  threshold_days: number;
  /** ISO 8601. While under the threshold with access still running: when it pauses. */
  grace_ends_at: string | null;
}

/** Where the account stands on the data API. Times are ISO 8601 UTC. */
export interface ApiAccess {
  /** Whether keys of the account are accepted now. */
  entitled: boolean;
  /** How the access is held; null without it. An administrator needs no key. */
  kind: 'contributor' | 'customer' | 'admin' | null;
  /** Why there is no access; null while there is. */
  reason: 'not_entitled' | 'lapsed' | 'grant_ended' | null;
  limits: ApiAccessLimits | null;
  /** Null for an administrator. */
  contributor: ApiAccessContributor | null;
  /** When an administrator's grant ends; null for no end date or no grant. */
  grant_ends_at: string | null;
}

/** One of the account's keys. The secret is never in it. Times are ISO 8601. */
export interface ApiKey {
  id: string;
  name: string;
  /** The 8 characters after "rtk_" that tell keys apart. */
  prefix: string;
  created_at: string;
  last_used_at: string | null;
  /** Set once revoked; a revoked key never works again. */
  revoked_at: string | null;
}

/** A key as created: the only answer that carries the whole key. */
export interface CreatedApiKey extends ApiKey {
  key: string;
}

type Loose<T> = Partial<Record<keyof T, unknown>>;

const textOrNull = (value: unknown) => (typeof value === 'string' ? value : null);
const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
const countOrNull = (value: unknown) => (isCount(value) ? value : null);

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return allowed.find((item) => item === value) ?? null;
}

function userOf(data: unknown): AccountUser | null {
  const { id, email, name } = (data ?? {}) as Loose<AccountUser>;
  if (typeof id !== 'string' || typeof email !== 'string') return null;
  return { id, email, name: textOrNull(name) };
}

function sessionOf(data: unknown): AccountSession | null {
  const row = (data ?? {}) as Loose<AccountSession>;
  const { id, created_at, last_used_at, expires_at, current } = row;
  if (typeof id !== 'string' || typeof current !== 'boolean') return null;
  if (!isCount(created_at) || !isCount(last_used_at) || !isCount(expires_at)) return null;
  return {
    id,
    created_at,
    last_used_at,
    expires_at,
    user_agent: textOrNull(row.user_agent),
    ip: textOrNull(row.ip),
    current,
  };
}

function limitsOf(data: unknown): ApiAccessLimits | null {
  const limits = data as Loose<ApiAccessLimits> | null;
  if (typeof limits?.tier !== 'string') return null;
  return {
    tier: limits.tier,
    requests_per_minute: countOrNull(limits.requests_per_minute),
    max_concurrent_streams: countOrNull(limits.max_concurrent_streams),
    max_history_span_s: countOrNull(limits.max_history_span_s),
  };
}

function contributorOf(data: unknown): ApiAccessContributor | null {
  const row = data as Loose<ApiAccessContributor> | null;
  const { active_days, window_days, threshold_days } = row ?? {};
  if (!isCount(active_days) || !isCount(window_days) || !isCount(threshold_days)) return null;
  return {
    active_days,
    window_days,
    threshold_days,
    grace_ends_at: textOrNull(row?.grace_ends_at),
  };
}

function accessOf(data: unknown): ApiAccess | null {
  const access = data as Loose<ApiAccess> | null;
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

function keyOf(data: unknown): ApiKey | null {
  const row = (data ?? {}) as Loose<ApiKey>;
  const { id, name, prefix, created_at } = row;
  if (typeof id !== 'string' || typeof name !== 'string') return null;
  if (typeof prefix !== 'string' || typeof created_at !== 'string') return null;
  return {
    id,
    name,
    prefix,
    created_at,
    last_used_at: textOrNull(row.last_used_at),
    revoked_at: textOrNull(row.revoked_at),
  };
}

function listOf<T>(data: unknown, rowOf: (row: unknown) => T | null): T[] | null {
  if (!Array.isArray(data)) return null;
  const rows = data.map(rowOf);
  return rows.every((row) => row !== null) ? (rows as T[]) : null;
}

// A 404 to a revocation: ended or revoked already, here or elsewhere, which is what was asked.
function goneIsDone(error: unknown): void {
  if (!(error instanceof HttpError && error.status === 404)) throw error;
}

/**
 * A read for the account signed in as `email`, kept only when the session was that account's
 * from before the request to after it, so one account's answer never shows under another's.
 */
function forAccount<T>(email: string, read: (signal: AbortSignal) => Promise<T>) {
  return async ({ signal }: { signal: AbortSignal }): Promise<T> => {
    if (currentSession()?.email !== email) throw new UnauthorizedError();
    const answer = await read(signal);
    if (currentSession()?.email !== email) throw new UnauthorizedError();
    return answer;
  };
}

async function fetchMySessions(signal?: AbortSignal, client: ApiClient = api) {
  const data: unknown = await client.get('/api/auth/me/sessions', { signal });
  const sessions = listOf(data, sessionOf);
  if (!sessions) throw new InvalidResponseError('GET /api/auth/me/sessions: expected a list');
  return sessions;
}

async function fetchMyAccess(signal?: AbortSignal, client: ApiClient = api) {
  const data: unknown = await client.get('/api/auth/me/access', { signal });
  const access = accessOf(data);
  if (!access) throw new InvalidResponseError('GET /api/auth/me/access: expected { entitled }');
  return access;
}

async function fetchMyKeys(signal?: AbortSignal, client: ApiClient = api) {
  const data: unknown = await client.get('/api/auth/me/keys', { signal });
  const keys = listOf(data, keyOf);
  if (!keys) throw new InvalidResponseError('GET /api/auth/me/keys: expected a list of keys');
  return keys;
}

/** The account signed in as `email`, as /api/auth/me answers it. */
export const meQuery = (email: string) =>
  queryOptions({
    queryKey: ['auth', 'me', 'user', email],
    queryFn: forAccount(email, (signal) => fetchMe(signal)),
  });

/** The devices signed in to the account of `email`, the most recently used first. */
export const mySessionsQuery = (email: string) =>
  queryOptions({
    queryKey: ['auth', 'me', 'sessions', email],
    queryFn: forAccount(email, (signal) => fetchMySessions(signal)),
  });

/** Where the account of `email` stands on the data API. */
export const myAccessQuery = (email: string) =>
  queryOptions({
    queryKey: ['auth', 'me', 'access', email],
    queryFn: forAccount(email, (signal) => fetchMyAccess(signal)),
  });

/** The keys of the account of `email`, the latest first, revoked ones included. */
export const myKeysQuery = (email: string) =>
  queryOptions({
    queryKey: ['auth', 'me', 'keys', email],
    queryFn: forAccount(email, (signal) => fetchMyKeys(signal)),
  });

/** Renames the account; resolves the user as /api/auth/me answers. A 422 carries the reason. */
export async function updateMyName(name: string, client: ApiClient = api): Promise<AccountUser> {
  const data: unknown = await client.patch('/api/auth/me', { body: { name } });
  const user = userOf(data);
  if (!user) throw new InvalidResponseError('PATCH /api/auth/me: expected { id, email }');
  return user;
}

/** Signs one of the account's sessions out. Resolves for one already ended too. */
export async function revokeMySession(id: string, client: ApiClient = api): Promise<void> {
  await client
    .delete('/api/auth/me/sessions/{session_id}', { params: { path: { session_id: id } } })
    .catch(goneIsDone);
}

/** Signs out every session of the account but the one asking; resolves how many ended. */
export async function revokeOtherSessions(client: ApiClient = api): Promise<number> {
  const data: unknown = await client.post('/api/auth/me/sessions/revoke-others');
  const revoked = (data as { revoked?: unknown } | null)?.revoked;
  if (!isCount(revoked)) {
    throw new InvalidResponseError(
      'POST /api/auth/me/sessions/revoke-others: expected { revoked }',
    );
  }
  return revoked;
}

/**
 * Mails a link to `email` that makes it the account's address once opened; resolves with the
 * address as the server normalised it and how many seconds the link lasts (`null` when the
 * answer does not say). A 400 for an invalid address or the current one, and 429 or 503 as a
 * sign-in link.
 */
export async function requestEmailChange(
  email: string,
  client: ApiClient = api,
): Promise<{ email: string; expiresIn: number | null }> {
  const data: unknown = await client.post('/api/auth/me/email', { body: { email } });
  const answer = data as { email?: unknown; expires_in?: unknown } | null;
  if (typeof answer?.email !== 'string') {
    throw new InvalidResponseError('POST /api/auth/me/email: expected { email: string }');
  }
  return {
    email: answer.email,
    expiresIn: typeof answer.expires_in === 'number' ? answer.expires_in : null,
  };
}

/** Which address a mailed change link would make the account's, without spending it. A 404 for a dead link. */
export async function previewEmailChange(
  token: string,
  signal?: AbortSignal,
  client: ApiClient = api,
): Promise<{ email: string }> {
  const data: unknown = await client.get('/api/auth/email-change/{token}', {
    params: { path: { token } },
    signal,
  });
  const email = (data as { email?: unknown } | null)?.email;
  if (typeof email !== 'string') {
    throw new InvalidResponseError(
      'GET /api/auth/email-change/{token}: expected { email: string }',
    );
  }
  return { email };
}

/**
 * Spends a mailed change link: its address becomes the account's. Needs no session and opens
 * none. A 400 for a link no longer valid, 409 for an address taken meanwhile, 503 when the
 * change cannot be made now.
 */
export async function confirmEmailChange(
  token: string,
  client: ApiClient = api,
): Promise<{ email: string }> {
  const data: unknown = await client.post('/api/auth/email-change/consume', { body: { token } });
  const email = (data as { email?: unknown } | null)?.email;
  if (typeof email !== 'string') {
    throw new InvalidResponseError(
      'POST /api/auth/email-change/consume: expected { email: string }',
    );
  }
  return { email };
}

const CREATED_KEY = 'POST /api/auth/me/keys: expected the created key';

// Whatever the client throws once a 2xx is in can hold its body, the key included: a JSON
// parser's message quotes the text around the fault. Such errors are thrown again bare, with a
// fixed message and no cause. A non-2xx answer never carries a key, so an HttpError stays whole.
function withoutBody(error: unknown): unknown {
  if (error instanceof InvalidResponseError) return new InvalidResponseError(CREATED_KEY);
  if (error instanceof TimeoutError) return new TimeoutError(error.timeoutMs);
  if (error instanceof NetworkError) return new NetworkError(error.offline);
  return error;
}

/**
 * Creates a key named `name`. The resolved object is the only place the whole key ever is: it
 * is not cached, logged or put in an error, so keep it in the component that shows it once,
 * and call this directly rather than through useMutation, whose cache would keep the answer.
 * A 403 with a detail when the account has no access or is an administrator's, a 422 for a name
 * the server refuses.
 */
export async function createMyKey(name: string, client: ApiClient = api): Promise<CreatedApiKey> {
  let data: unknown;
  try {
    data = await client.post('/api/auth/me/keys', { body: { name } });
  } catch (error) {
    throw withoutBody(error);
  }
  const row = keyOf(data);
  const key = (data as { key?: unknown } | null)?.key;
  if (!row || typeof key !== 'string' || !key.startsWith(`rtk_${row.prefix}_`)) {
    throw new InvalidResponseError(CREATED_KEY);
  }
  return { ...row, key };
}

/** Revokes one of the account's keys. Resolves for one already gone too. */
export async function revokeMyKey(id: string, client: ApiClient = api): Promise<void> {
  await client
    .delete('/api/auth/me/keys/{key_id}', { params: { path: { key_id: id } } })
    .catch(goneIsDone);
}

/**
 * Deletes the account once `email` matches its address: every node it owns is released, and
 * every session and key of it ends, so the session asking is over too. Resolves how many nodes
 * were released. A 400 when `email` is not the account's address, 409 when a node was claimed
 * for it meanwhile; the account is untouched then.
 */
export async function deleteMyAccount(
  email: string,
  client: ApiClient = api,
): Promise<{ released: number }> {
  const data: unknown = await client.post('/api/auth/me/delete', { body: { email } });
  const released = (data as { released?: unknown } | null)?.released;
  if (!isCount(released)) {
    throw new InvalidResponseError('POST /api/auth/me/delete: expected { released }');
  }
  return { released };
}
