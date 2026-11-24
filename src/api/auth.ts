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

/** One of the signed-in account's nodes, with what a list of them shows. */
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
  if (!Array.isArray(data) || !data.every(isOwnerNode)) {
    throw new InvalidResponseError('GET /api/auth/me/nodes: expected a list of nodes');
  }
  return data;
}

/**
 * The nodes of the account signed in as `email`. The account is in the key, and an answer is
 * kept only when the session was that account's from before the request to after it, so one
 * account's nodes never show under another's.
 */
export const myNodesQuery = (email: string) =>
  queryOptions({
    queryKey: ['auth', 'me', 'nodes', email],
    queryFn: async ({ signal }) => {
      if (currentSession()?.email !== email) throw new UnauthorizedError();
      const nodes = await fetchMyNodes(signal);
      if (currentSession()?.email !== email) throw new UnauthorizedError();
      return nodes;
    },
  });
