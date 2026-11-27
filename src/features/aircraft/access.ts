import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useSyncExternalStore } from 'react';

import { dataAccessQuery, HttpError, queryClient, type DataAccess } from '@/api';
import { useAuth, type AuthState } from '@/auth';
import { currentSession } from '@/auth/tokenStore';

// What search covers for the visitor. Everyone searches the map's view; an account with data API
// access searches the whole network too. The texts are the web's API access page
// (dashboard/src/pages/user/ApiAccessPage.tsx in retina-server).

export type AccessReason = 'not_entitled' | 'lapsed' | 'grant_ended';

/**
 * - `checking`: the session is being restored, or /me/access has not answered yet.
 * - `signed-out`: the map's view only.
 * - `view-only`: signed in without access; why, and how it is earned, where the server says.
 * - `entitled`: the whole network too; `maxHistorySpanS` is null when no limit is stated (an
 *   administrator).
 */
export type SearchAccess =
  | { kind: 'checking' }
  | { kind: 'signed-out' }
  | { kind: 'view-only'; reasonLine: string | null; earnLine: string | null }
  | { kind: 'entitled'; maxHistorySpanS: number | null };

type ApiRefusal =
  { kind: 'refused'; reason: AccessReason } | { kind: 'rate-limited'; retryAfterMs: number | null };

const ACCESS_REASONS: readonly AccessReason[] = ['not_entitled', 'lapsed', 'grant_ended'];

const REASON_LINES: Record<AccessReason, string> = {
  lapsed: 'Your API access has lapsed.',
  grant_ended: 'The access granted to you has ended.',
  not_entitled: 'You have no access yet.',
};

const CHECKING: SearchAccess = { kind: 'checking' };
const SIGNED_OUT: SearchAccess = { kind: 'signed-out' };
const UNKNOWN: SearchAccess = { kind: 'view-only', reasonLine: null, earnLine: null };

/** The web's contributor rule with the account's numbers; null without them (an administrator). */
function earnLineOf(access: DataAccess | undefined): string | null {
  const contributor = access?.contributor;
  if (!contributor) return null;
  const { threshold_days: threshold, window_days: window, active_days: active } = contributor;
  return (
    `To qualify, a node you own needs to report data on at least ${threshold} of the last ` +
    `${window} days. Your best node: ${active} of ${window} days.`
  );
}

/**
 * The access state from its inputs. A refusal held for the account outranks the access the server
 * last stated, and that answer, while there is one, outranks a failure to read it again.
 */
export function searchAccessOf(input: {
  auth: AuthState;
  access: DataAccess | undefined;
  accessFailed: boolean;
  refusal: AccessReason | null;
}): SearchAccess {
  const { auth, access, accessFailed, refusal } = input;
  if (auth.status === 'loading') return CHECKING;
  if (auth.status === 'signed-out') return SIGNED_OUT;
  if (refusal !== null) {
    return { kind: 'view-only', reasonLine: REASON_LINES[refusal], earnLine: earnLineOf(access) };
  }
  if (access === undefined) return accessFailed ? UNKNOWN : CHECKING;
  if (access.entitled) {
    return { kind: 'entitled', maxHistorySpanS: access.limits?.max_history_span_s ?? null };
  }
  return {
    kind: 'view-only',
    reasonLine: REASON_LINES[access.reason ?? 'not_entitled'],
    earnLine: earnLineOf(access),
  };
}

/**
 * What a failed data API call means for access: a 403 naming why the account is refused, or a
 * 429 with how long the server asked to wait. Null for any other failure.
 */
export function refusalOf(error: unknown): ApiRefusal | null {
  if (!(error instanceof HttpError)) return null;
  if (error.status === 429) return { kind: 'rate-limited', retryAfterMs: error.retryAfterMs };
  if (error.status !== 403) return null;
  const reason = ACCESS_REASONS.find((known) => known === error.reason);
  return reason ? { kind: 'refused', reason } : null;
}

// The refusal last met, held for the account it was met under until /me/access answers after it.
type Hold = { email: string; reason: AccessReason; at: number };

let hold: Hold | null = null;
const holdListeners = new Set<() => void>();

function setHold(next: Hold | null): void {
  hold = next;
  for (const listener of holdListeners) listener();
}

function subscribeHold(listener: () => void): () => void {
  holdListeners.add(listener);
  return () => {
    holdListeners.delete(listener);
  };
}

const currentHold = () => hold;

/** Records a 403 refusal of /api/v1 for the signed-in account and returns what the error meant. */
export function noteApiRefusal(error: unknown): ReturnType<typeof refusalOf> {
  const refusal = refusalOf(error);
  if (refusal?.kind !== 'refused') return refusal;
  const email = currentSession()?.email;
  if (email) {
    setHold({ email, reason: refusal.reason, at: Date.now() });
    void queryClient.invalidateQueries({ queryKey: dataAccessQuery(email).queryKey });
  }
  return refusal;
}

/** The signed-in account's access to search, read from /me/access and the refusals since. */
export function useSearchAccess(): SearchAccess {
  const { state: auth } = useAuth();
  const email = auth.status === 'signed-in' ? auth.email : null;
  const { data, isError, dataUpdatedAt } = useQuery({
    ...dataAccessQuery(email ?? ''),
    enabled: email !== null,
  });
  const held = useSyncExternalStore(subscribeHold, currentHold);
  const refusal =
    held !== null && held.email === email && !(dataUpdatedAt > held.at) ? held.reason : null;

  useEffect(() => {
    // Another account, or an answer from /me/access since, ends it.
    if (held !== null && refusal === null && hold === held) setHold(null);
  }, [held, refusal]);

  return useMemo(
    () => searchAccessOf({ auth, access: data, accessFailed: isError, refusal }),
    [auth, data, isError, refusal],
  );
}
