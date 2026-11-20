import { useQuery } from '@tanstack/react-query';
import { useIsFocused } from 'expo-router';
import { useState } from 'react';

import { leaderboardQuery, useIsOffline, type LeaderboardRow } from '@/api';

const REFRESH_INTERVAL_MS = 30_000;
const NO_ROWS: LeaderboardRow[] = [];

/** The node leaderboard, refreshed every 30 s while the screen using it is focused. */
export function useNetworkNodes() {
  const focused = useIsFocused();
  const offline = useIsOffline();
  const query = useQuery({
    ...leaderboardQuery,
    refetchInterval: focused ? REFRESH_INTERVAL_MS : false,
  });
  const [requested, setRequested] = useState(false);

  const rows = query.data?.leaderboard ?? NO_ROWS;
  const online = rows.filter((row) => row.online).length;

  /** A refetch the user asked for; paused while offline, so it does nothing then. */
  const refresh = async () => {
    if (offline) return;
    setRequested(true);
    try {
      await query.refetch();
    } finally {
      setRequested(false);
    }
  };

  return {
    rows,
    online,
    total: rows.length,
    hasData: query.data !== undefined,
    updatedAt: query.dataUpdatedAt,
    isLoading: query.isPending && !offline,
    error: query.isError ? query.error : null,
    offline,
    refreshing: requested && query.isFetching,
    refresh,
  };
}
