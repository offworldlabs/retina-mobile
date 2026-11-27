import { useQuery } from '@tanstack/react-query';
import { useIsFocused } from 'expo-router';
import { useState } from 'react';

import {
  configHistoryQuery,
  myAnalyticsQuery,
  myClaimsQuery,
  nodeAnalyticsQuery,
  nodeEventsQuery,
  nodeReportQuery,
  nodeSnrQuery,
  ownerNodeQuery,
  useIsOffline,
  type ConfigVersion,
  type MyClaim,
  type NodeReport,
  type OwnerAnalytics,
  type OwnerEvent,
  type OwnerNode,
  type OwnerNodeAnalytics,
  type SnrSeries,
} from '@/api';

import { isNotFound } from './model';

// Every hook here is keyed on the signed-in account and disabled while there is none. Polls run
// only while the screen is focused, and never with the app in the background: TanStack skips an
// interval's fetch while focusManager, wired to AppState in src/api/query.tsx, says unfocused,
// since refetchIntervalInBackground is left false.

const REFRESH_INTERVAL_MS = 30_000;
// The server caches a node's SNR series for 60 s.
const SNR_INTERVAL_MS = 60_000;

const NO_CLAIMS: MyClaim[] = [];
const NO_VERSIONS: ConfigVersion[] = [];
const NO_EVENTS: OwnerEvent[] = [];

/** A poll every `ms` while focused, stopped by a 404: what is not on the account stays gone until asked again. */
function pollWhile(focused: boolean, ms: number) {
  return (query: { state: { error: unknown } }) =>
    focused && !isNotFound(query.state.error) ? ms : false;
}

// Read when the screen opens and on a pull-to-refresh, never on a poll, an app focus or a reconnect.
const ON_REFRESH_ONLY = { refetchOnWindowFocus: false, refetchOnReconnect: false } as const;

/** The open claims addressed to the account, refreshed every 30 s while focused; [] until loaded. */
export function useMyClaims(email: string | null): {
  claims: MyClaim[];
  error: unknown | null;
  refresh: () => Promise<void>;
} {
  const focused = useIsFocused();
  const offline = useIsOffline();
  const enabled = email !== null;
  const query = useQuery({
    ...myClaimsQuery(email ?? ''),
    enabled,
    refetchInterval: pollWhile(focused, REFRESH_INTERVAL_MS),
  });

  /** A refetch asked for, after a resend; paused while offline, so it does nothing then. */
  const refresh = async () => {
    if (offline || !enabled) return;
    await query.refetch();
  };

  return {
    claims: query.data ?? NO_CLAIMS,
    error: query.isError ? query.error : null,
    refresh,
  };
}

/** The analytics of the account's nodes, keyed by node_ref, refreshed every 30 s while focused. */
export function useMyAnalytics(email: string | null): {
  analytics: OwnerAnalytics | null;
  error: unknown | null;
} {
  const focused = useIsFocused();
  const query = useQuery({
    ...myAnalyticsQuery(email ?? ''),
    enabled: email !== null,
    refetchInterval: pollWhile(focused, REFRESH_INTERVAL_MS),
  });
  return {
    analytics: query.data ?? null,
    error: query.isError ? query.error : null,
  };
}

export interface NodeDetail {
  node: OwnerNode | null;
  /** Null when nothing is measured yet. */
  analytics: OwnerNodeAnalytics | null;
  report: NodeReport | null;
  versions: ConfigVersion[];
  events: OwnerEvent[];
  /** A 404 from the node or its analytics: it is no longer on this account. */
  gone: boolean;
  /** The node's or its analytics' first load, while online. */
  isLoading: boolean;
  /** Per record, whether its first answer is still to come. */
  recordsLoading: { report: boolean; versions: boolean; events: boolean };
  /** The node's own failure, other than a 404. */
  error: unknown | null;
  /** Why the figures could not be read, other than a 404; the last ones read stay on show. */
  analyticsError: unknown | null;
  /** A failure of the report, the configuration history or the events. */
  recordsError: unknown | null;
  offline: boolean;
  /** A refresh asked for is in flight. */
  refreshing: boolean;
  refresh: () => Promise<void>;
}

/**
 * One of the account's nodes and its page's records. The node, its analytics and its report
 * refresh every 30 s while focused; its configuration history and events on a refresh only.
 * A 404 from the node or its analytics means it is no longer on the account: `gone`, with
 * nothing of it kept on show.
 */
export function useNodeDetail(email: string | null, nodeId: string): NodeDetail {
  const focused = useIsFocused();
  const offline = useIsOffline();
  const enabled = email !== null;
  const account = email ?? '';
  const poll = pollWhile(focused, REFRESH_INTERVAL_MS);
  const nodeQuery = useQuery({
    ...ownerNodeQuery(account, nodeId),
    enabled,
    refetchInterval: poll,
  });
  const analyticsQuery = useQuery({
    ...nodeAnalyticsQuery(account, nodeId),
    enabled,
    refetchInterval: poll,
  });
  const reportQuery = useQuery({
    ...nodeReportQuery(account, nodeId),
    enabled,
    refetchInterval: poll,
  });
  const historyQuery = useQuery({
    ...configHistoryQuery(account, nodeId),
    enabled,
    ...ON_REFRESH_ONLY,
  });
  const eventsQuery = useQuery({
    ...nodeEventsQuery(account, nodeId),
    enabled,
    ...ON_REFRESH_ONLY,
  });
  const queries = [nodeQuery, analyticsQuery, reportQuery, historyQuery, eventsQuery];
  const [requested, setRequested] = useState(false);

  // A query's error stays until its next success, so a node back on the account clears this.
  const gone = isNotFound(nodeQuery.error) || isNotFound(analyticsQuery.error);
  const recordsQuery = [reportQuery, historyQuery, eventsQuery].find((query) => query.isError);

  /** A refetch of everything on the page; paused while offline, so it does nothing then. */
  const refresh = async () => {
    if (offline || !enabled) return;
    setRequested(true);
    try {
      await Promise.all(queries.map((query) => query.refetch()));
    } finally {
      setRequested(false);
    }
  };

  return {
    node: gone ? null : (nodeQuery.data ?? null),
    analytics: gone ? null : (analyticsQuery.data ?? null),
    report: gone ? null : (reportQuery.data ?? null),
    versions: gone ? NO_VERSIONS : (historyQuery.data ?? NO_VERSIONS),
    events: gone ? NO_EVENTS : (eventsQuery.data ?? NO_EVENTS),
    gone,
    isLoading: !gone && enabled && (nodeQuery.isPending || analyticsQuery.isPending) && !offline,
    recordsLoading: {
      report: !gone && enabled && reportQuery.isPending,
      versions: !gone && enabled && historyQuery.isPending,
      events: !gone && enabled && eventsQuery.isPending,
    },
    error: gone || !nodeQuery.isError ? null : nodeQuery.error,
    analyticsError: gone || !analyticsQuery.isError ? null : analyticsQuery.error,
    recordsError: gone ? null : (recordsQuery?.error ?? null),
    offline,
    refreshing: requested && queries.some((query) => query.isFetching),
    refresh,
  };
}

/** A node's detection SNR over the last `hours`, refreshed every 60 s while focused. */
export function useNodeSnr(
  email: string | null,
  nodeId: string,
  hours: number,
): { series: SnrSeries | null; isLoading: boolean; error: unknown | null } {
  const focused = useIsFocused();
  const offline = useIsOffline();
  const enabled = email !== null;
  const query = useQuery({
    ...nodeSnrQuery(email ?? '', nodeId, hours),
    enabled,
    refetchInterval: pollWhile(focused, SNR_INTERVAL_MS),
  });
  return {
    series: query.data ?? null,
    isLoading: enabled && query.isPending && !offline,
    error: query.isError ? query.error : null,
  };
}
