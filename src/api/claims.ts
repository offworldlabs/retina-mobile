import type { AccountUser } from './auth';
import { api, type ApiClient } from './client';
import { InvalidResponseError } from './errors';

// A node's claim link is its own proof: none of these routes reads a session. Consume answers
// with a cookie for a new session of the account the link was mailed to, and no session token
// (routes/auth.py on the server). So every call goes with credentials 'omit': the platform
// neither sends a cookie with it nor keeps one from its answer, and a session opened by a
// claim can never sign the app in. 'omit' reaches the native request: expo/fetch turns the
// cookie jar off for it on Android and HTTPShouldHandleCookies off on iOS.
const NO_COOKIES = { credentials: 'omit' } as const;

function accountUserOf(data: unknown): AccountUser | null {
  const { id, email, name } = (data ?? {}) as Partial<Record<keyof AccountUser, unknown>>;
  if (typeof id !== 'string' || typeof email !== 'string') return null;
  return { id, email, name: typeof name === 'string' ? name : null };
}

/** Which node a claim link is for, without spending it. A 404 for a dead link. */
export async function previewClaim(
  token: string,
  signal?: AbortSignal,
  client: ApiClient = api,
): Promise<{ nodeRef: string }> {
  const data: unknown = await client.get('/api/auth/claim/{token}', {
    ...NO_COOKIES,
    params: { path: { token } },
    signal,
  });
  const nodeRef = (data as { node_ref?: unknown } | null)?.node_ref;
  if (typeof nodeRef !== 'string') {
    throw new InvalidResponseError('GET /api/auth/claim/{token}: expected { node_ref: string }');
  }
  return { nodeRef };
}

/**
 * Spends a claim link: the node joins the account the link was mailed to, whoever is signed in
 * here. Answers with that account; the session the server opens for it stays out of the app.
 * A 409 when the node already has an owner, a 400 for a link used or expired.
 */
export async function consumeClaim(
  token: string,
  client: ApiClient = api,
): Promise<{ nodeRef: string; user: AccountUser }> {
  const data: unknown = await client.post('/api/auth/claim/consume', {
    ...NO_COOKIES,
    body: { token },
  });
  const { node_ref: nodeRef, user } = (data ?? {}) as Record<string, unknown>;
  const account = accountUserOf(user);
  if (typeof nodeRef !== 'string' || !account) {
    throw new InvalidResponseError(
      'POST /api/auth/claim/consume: expected { node_ref, user: { id, email } }',
    );
  }
  return { nodeRef, user: account };
}

/** Spends a claim link by refusing it: the node stays unowned. A 400 for a link used or expired. */
export async function declineClaim(token: string, client: ApiClient = api): Promise<void> {
  await client.post('/api/auth/claim/decline', { ...NO_COOKIES, body: { token } });
}

/**
 * Mails the claim again, to the address the node gave. A 404 when this link can no longer be
 * renewed, a 409 when the node has an owner by now, a 429 when asked too often.
 */
export async function resendClaimLink(token: string, client: ApiClient = api): Promise<void> {
  await client.post('/api/auth/claim/resend', { ...NO_COOKIES, body: { token } });
}
