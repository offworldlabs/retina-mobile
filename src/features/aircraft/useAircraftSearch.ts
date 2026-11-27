import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useIsFocused } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';

import {
  fetchNetworkAircraft,
  fetchViewAircraft,
  isRetryable,
  useIsOffline,
  type SearchAircraft,
} from '@/api';
import type { LiveAircraft } from '@/features/map/feed';
import { createAircraftIdentity, type AircraftIdentity } from '@/features/map/identity';
import { useLastMapBox } from '@/features/map/link';
import { useAppActive } from '@/features/map/useLiveAircraft';

import { noteApiRefusal, refusalOf, type SearchAccess } from './access';
import {
  searchEntriesOf,
  searchResultsOf,
  WHOLE_NETWORK,
  type AircraftFilters,
  type NetworkSource,
  type SearchEntry,
  type SearchResult,
} from './search';

export type SearchScope = 'view' | 'network';

export type AircraftSearchState = {
  scope: SearchScope;
  results: readonly SearchResult[];
  /** Aircraft in the sources before the text and the filters. */
  total: number;
  /** A source of the scope has not answered yet. */
  loading: boolean;
  /** The last failure other than a refusal or a rate limit; null after a success. */
  error: unknown;
  offline: boolean;
  /** The network source is rate limited: seconds until it asks again. */
  retryInS: number | null;
  /** The server cut the map's view down. */
  clipped: boolean;
};

const VIEW_REFRESH_MS = 5_000;
const NETWORK_REFRESH_MS = 15_000;
const DEFAULT_RETRY_AFTER_MS = 30_000;
// An answer is kept this long after the search stops showing it.
const KEEP_MS = 60_000;
const MAX_RETRIES = 2;

const VIEW_KEY = ['aircraft-search', 'view'] as const;
const NETWORK_KEY = ['aircraft-search', 'network'] as const;

const NO_ENTRIES: readonly SearchEntry[] = [];

/**
 * A wait before the data API is asked again: the server's Retry-After after a 429, or one refresh
 * after a refusal, during which the search covers the view. `now` is the clock as last ticked.
 */
type Pause = { until: number; now: number; rateLimited: boolean };

// Refusals and rate limits are answered by the access state and the pause, never by asking again.
const retryOf = (failureCount: number, error: unknown) =>
  failureCount < MAX_RETRIES && isRetryable(error) && refusalOf(error) === null;

/**
 * A view frame's entries one per aircraft, under the id the map shows it by: identity.ts reads
 * only the keys, the position, the age and the source, so each entry goes in as those and comes
 * back as itself.
 */
function resolveView(
  identity: AircraftIdentity,
  aircraft: readonly SearchAircraft[],
  now: number,
): SearchEntry[] {
  const entryOf = new Map<LiveAircraft, SearchAircraft>();
  const keyed = aircraft.map((entry) => {
    const { hex, lat, lon, seen, multinode, position_source, adsb_hex, predecessor_hex } = entry;
    const key: LiveAircraft = {
      hex,
      lat,
      lon,
      seen,
      multinode,
      position_source,
      adsb_hex,
      predecessor_hex,
    };
    entryOf.set(key, entry);
    return key;
  });
  const entries: SearchEntry[] = [];
  for (const [id, key] of identity.resolve(keyed, now)) {
    const entry = entryOf.get(key);
    if (entry) entries.push([id, entry]);
  }
  return entries;
}

/**
 * Aircraft matching `text` and `filters`, the web map's way. Everyone searches the map's last view,
 * asked when the screen comes into focus and every 5 s. With API access the whole network is
 * searched too: the data API's whole feed, asked every 15 s and never for a text, joined to the
 * view by the map's identity, the view's row winning. The text and the filters are applied on the
 * device to what the sources last answered, so typing asks nothing and shows no stale answer.
 * Nothing is asked while the calling screen is out of focus or the app is in the background, and a
 * request under way then is cancelled. A refusal turns the account's access off and the search
 * back to the view; a rate limit keeps the last answer and waits as long as the server asked,
 * counting down only while the screen is in focus.
 */
export function useAircraftSearch(
  text: string,
  filters: AircraftFilters,
  access: SearchAccess,
): AircraftSearchState {
  const queryClient = useQueryClient();
  const focused = useIsFocused();
  const foreground = useAppActive();
  const offline = useIsOffline();
  const box = useLastMapBox();
  const active = focused && foreground;
  const [identity] = useState(createAircraftIdentity);
  const [pause, setPause] = useState<Pause | null>(null);

  const refusedLately = pause !== null && !pause.rateLimited;
  const scope: SearchScope = access.kind === 'entitled' && !refusedLately ? 'network' : 'view';
  const paused = pause !== null;
  const networkOn = active && scope === 'network' && !paused;

  useEffect(() => {
    if (!paused || !active) return;
    const timer = setInterval(() => {
      const now = Date.now();
      setPause((held) => (held === null || now >= held.until ? null : { ...held, now }));
    }, 1000);
    return () => clearInterval(timer);
  }, [paused, active]);

  const view = useQuery({
    queryKey: [...VIEW_KEY, box],
    queryFn: async ({ signal }) => {
      const frame = await fetchViewAircraft(box, signal);
      return {
        entries: resolveView(identity, frame.aircraft, Date.now()),
        clipped: frame.clipped,
      };
    },
    enabled: active,
    refetchInterval: active ? VIEW_REFRESH_MS : false,
    staleTime: 0,
    gcTime: KEEP_MS,
    placeholderData: keepPreviousData,
    retry: retryOf,
  });

  const network = useQuery({
    queryKey: NETWORK_KEY,
    queryFn: async ({ signal }) => {
      try {
        return await fetchNetworkAircraft(WHOLE_NETWORK, signal);
      } catch (error) {
        const refusal = noteApiRefusal(error);
        if (refusal) {
          const now = Date.now();
          const rateLimited = refusal.kind === 'rate-limited';
          const waitMs = rateLimited
            ? (refusal.retryAfterMs ?? DEFAULT_RETRY_AFTER_MS)
            : NETWORK_REFRESH_MS;
          setPause({ until: now + waitMs, now, rateLimited });
        }
        throw error;
      }
    },
    enabled: networkOn,
    refetchInterval: networkOn ? NETWORK_REFRESH_MS : false,
    staleTime: 0,
    gcTime: KEEP_MS,
    retry: retryOf,
  });

  // A request under way stops as soon as its source is off.
  useEffect(() => {
    if (!active) return;
    return () => void queryClient.cancelQueries({ queryKey: VIEW_KEY });
  }, [active, queryClient]);
  useEffect(() => {
    if (!networkOn) return;
    return () => void queryClient.cancelQueries({ queryKey: NETWORK_KEY });
  }, [networkOn, queryClient]);

  const viewEntries = view.data?.entries ?? NO_ENTRIES;
  // The identity is the one the view entries were just resolved by, so it names each hex by the id
  // the view shows that aircraft under; the memos below re-run with every view answer.
  const networkSource = useMemo<NetworkSource | undefined>(
    () =>
      scope === 'network' && network.data
        ? { aircraft: network.data, idFor: identity.idFor }
        : undefined,
    [scope, network.data, identity],
  );
  const total = useMemo(
    () => searchEntriesOf(viewEntries, networkSource).length,
    [viewEntries, networkSource],
  );
  const results = useMemo(
    () => searchResultsOf(viewEntries, text, filters, networkSource),
    [viewEntries, text, filters, networkSource],
  );

  const viewWaiting = view.isPlaceholderData || view.status === 'pending';
  const networkWaiting = scope === 'network' && !paused && network.status === 'pending';
  const failure = [view.error, scope === 'network' ? network.error : null].find(
    (error) => error !== null && refusalOf(error) === null,
  );
  const rateLimited = scope === 'network' && pause !== null && pause.rateLimited;
  return {
    scope,
    results,
    total,
    loading: !offline && (viewWaiting || networkWaiting),
    error: failure ?? null,
    offline,
    retryInS: rateLimited ? Math.max(1, Math.ceil((pause.until - pause.now) / 1000)) : null,
    clipped: scope === 'view' && view.data?.clipped === true,
  };
}
