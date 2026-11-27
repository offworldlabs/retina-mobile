import { useQuery } from '@tanstack/react-query';
import { useIsFocused } from 'expo-router';
import { useState } from 'react';

import { myNodesQuery, useIsOffline, type OwnerNode } from '@/api';

const REFRESH_INTERVAL_MS = 30_000;
const NO_NODES: OwnerNode[] = [];

/** The signed-in account's nodes, refreshed every 30 s while the screen using it is focused. */
export function useMyNodes(email: string | null) {
  const focused = useIsFocused();
  const offline = useIsOffline();
  const enabled = email !== null;
  const query = useQuery({
    ...myNodesQuery(email ?? ''),
    enabled,
    refetchInterval: focused ? REFRESH_INTERVAL_MS : false,
  });
  const [requested, setRequested] = useState(false);

  /** A refetch the user asked for; paused while offline, so it does nothing then. */
  const refresh = async () => {
    if (offline || !enabled) return;
    setRequested(true);
    try {
      await query.refetch();
    } finally {
      setRequested(false);
    }
  };

  return {
    nodes: query.data ?? NO_NODES,
    hasData: query.data !== undefined,
    isLoading: enabled && query.isPending && !offline,
    error: query.isError ? query.error : null,
    offline,
    refreshing: requested && query.isFetching,
    refresh,
  };
}
