import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { fetchAircraftHistory } from '@/api';
import { noteApiRefusal } from '@/features/aircraft/access';
import { historyPoints, simplifyTrack, type TrackPoint } from '@/features/aircraft/track';

/** The spans of history the card offers, in seconds. */
export const HISTORY_WINDOWS_S = [15 * 60, 60 * 60, 2 * 60 * 60] as const;
export const DEFAULT_HISTORY_WINDOW_S = 60 * 60;
/** The most positions one answer of the history endpoint holds. */
const HISTORY_LIMIT = 10_000;
// An answer is kept this long, and not asked again sooner; the live trail covers what follows it.
const HISTORY_KEEP_MS = 60_000;

/** The spans an account may ask for: those within its longest span, when it has one. */
export function historyWindows(maxSpanS: number | null): number[] {
  return HISTORY_WINDOWS_S.filter((span) => maxSpanS === null || span <= maxSpanS);
}

/**
 * - `idle`: nothing asked, or the account has no history.
 * - `loading`: the first answer for this aircraft and span is on its way.
 * - `ready`: the answer is in.
 * - `unavailable`: the server could not answer, for any reason but a refusal.
 */
export type TrackHistoryStatus = 'idle' | 'loading' | 'ready' | 'unavailable';

export type TrackHistory = {
  /** The aircraft's earlier positions, oldest first; null with none to draw. */
  points: readonly TrackPoint[] | null;
  status: TrackHistoryStatus;
  /** Whether the span held more positions than one answer carries. */
  truncated: boolean;
};

type HistoryAnswer = { points: TrackPoint[]; truncated: boolean };

/** A failure the account's access explains, which the card answers by hiding history. */
class HistoryRefused extends Error {}

const QUERY_KEY = 'track-history';
const NO_HISTORY: TrackHistory = { points: null, status: 'idle', truncated: false };

/**
 * The selected aircraft's track over the last `windowS` seconds, from the data API, as one page
 * simplified once. It is asked while `entitled` and `active` (the map focused, the app in the
 * foreground), once per aircraft and span, with the keys the aircraft has when it is asked; a
 * fetch under way stops as soon as either goes false. Every failure goes through the account's
 * access first, so a refusal turns history off for the account instead of showing an error.
 */
export function useTrackHistory({
  id,
  hexes,
  windowS,
  entitled,
  active,
}: {
  /** The selected aircraft's id; null with none selected. */
  id: string | null;
  /** Every key the aircraft is known by now. */
  hexes: readonly string[];
  windowS: number;
  entitled: boolean;
  active: boolean;
}): TrackHistory {
  const queryClient = useQueryClient();
  const enabled = entitled && active && id !== null && hexes.length > 0;
  const query = useQuery({
    queryKey: [QUERY_KEY, id, windowS],
    queryFn: async ({ signal }): Promise<HistoryAnswer> => {
      const endMs = Date.now();
      const startMs = endMs - windowS * 1000;
      try {
        const page = await fetchAircraftHistory(
          { hexes, startMs, endMs, limit: HISTORY_LIMIT },
          signal,
        );
        return {
          points: simplifyTrack(historyPoints(page.rows)),
          truncated: page.nextCursor !== null,
        };
      } catch (error) {
        // A rate limit keeps its own error, so the client's retry rules wait it out.
        if (noteApiRefusal(error)?.kind === 'refused') throw new HistoryRefused();
        throw error;
      }
    },
    enabled,
    gcTime: HISTORY_KEEP_MS,
    staleTime: HISTORY_KEEP_MS,
    // Another span for the same aircraft keeps the line it has until the new one lands.
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[1] === id ? previous : undefined,
  });

  useEffect(() => {
    if (!enabled) void queryClient.cancelQueries({ queryKey: [QUERY_KEY] });
  }, [enabled, queryClient]);

  if (!entitled || id === null) return NO_HISTORY;
  const { data, isPlaceholderData, fetchStatus, error } = query;
  const settled = data !== undefined && !isPlaceholderData;
  let status: TrackHistoryStatus = 'idle';
  if (settled) status = 'ready';
  else if (fetchStatus === 'fetching') status = 'loading';
  else if (error !== null && !(error instanceof HistoryRefused)) status = 'unavailable';
  return { points: data?.points ?? null, status, truncated: settled && data.truncated };
}
