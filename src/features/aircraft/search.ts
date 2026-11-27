import type { NetworkAircraftQuery, SearchAircraft } from '@/api';

// The web map's aircraft filters, search and list (dashboard/src/pages/map in retina-server): the
// predicate of LiveAircraftMap.tsx, the fields of Toolbar.tsx, and the text match and default
// order of AircraftListPanel.tsx, which lists the aircraft that pass the predicate.

export type AircraftTypeFilter = 'all' | 'aircraft' | 'drone' | 'multinode';

/** The filter fields as typed, '' for unset, the way the web map keeps them. */
export type AircraftFilters = {
  minFl: string;
  maxFl: string;
  minGs: string;
  type: AircraftTypeFilter;
  anomaliesOnly: boolean;
};

export const NO_FILTERS: AircraftFilters = {
  minFl: '',
  maxFl: '',
  minGs: '',
  type: 'all',
  anomaliesOnly: false,
};

export const TYPE_FILTER_OPTIONS: readonly { value: AircraftTypeFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'aircraft', label: 'Aircraft' },
  { value: 'drone', label: 'Drones' },
  { value: 'multinode', label: 'Multi-node only' },
];

/** The filters that narrow the list: the web's four fields, plus anomalies only. */
export function activeFilterCount(filters: AircraftFilters): number {
  let count = 0;
  if (filters.minFl !== '') count++;
  if (filters.maxFl !== '') count++;
  if (filters.minGs !== '') count++;
  if (filters.type !== 'all') count++;
  if (filters.anomaliesOnly) count++;
  return count;
}

/** A bound as the web reads its input: '' is none, anything else is Number(text). */
const boundOf = (text: string) => (text === '' ? null : Number(text));

/**
 * The web map's predicate. Only aircraft a radar node saw pass: an entry with neither a position
 * source nor a multinode solve is plain ADS-B. The flight level is alt_baro / 100, with no altitude
 * as 0. JavaScript's coercions are kept: alt_baro 'ground' gives a flight level of NaN and a bound
 * typed as something other than a number is NaN, and as no comparison with NaN holds, neither ever
 * filters anything out.
 */
export function passesFilters(aircraft: SearchAircraft, filters: AircraftFilters): boolean {
  if (!(aircraft.position_source || aircraft.multinode)) return false;
  if (filters.anomaliesOnly && !aircraft.is_anomalous) return false;
  const minFl = boundOf(filters.minFl);
  const maxFl = boundOf(filters.maxFl);
  const minGs = boundOf(filters.minGs);
  const altitude = aircraft.alt_baro ?? 0;
  const fl = altitude === 'ground' ? Number.NaN : altitude / 100;
  if (minFl !== null && fl < minFl) return false;
  if (maxFl !== null && fl > maxFl) return false;
  if (minGs !== null && (aircraft.gs ?? 0) < minGs) return false;
  const drone = aircraft.target_class === 'drone';
  if (filters.type === 'drone' && !drone) return false;
  if (filters.type === 'aircraft' && drone) return false;
  if (
    filters.type === 'multinode' &&
    !(aircraft.multinode || aircraft.position_source === 'multinode_solve')
  ) {
    return false;
  }
  return true;
}

/**
 * Whether the text is part of the hex or the callsign, ignoring case; blank text matches every
 * aircraft. The text is trimmed, as the web map trims it for its markers.
 */
export function matchesText(aircraft: SearchAircraft, text: string): boolean {
  const query = text.trim().toLowerCase();
  if (query === '') return true;
  return (
    (aircraft.hex || '').toLowerCase().includes(query) ||
    (aircraft.flight || '').toLowerCase().includes(query)
  );
}

/**
 * The data API query search sends: no filter at all, so the answer is the whole real feed, the same
 * for every text and filter. The server matches otherwise than the web (a whole hex, the start of
 * an ADS-B callsign, no altitude or speed never in a range), so the web's match is applied to the
 * rows on the device instead.
 */
export const WHOLE_NETWORK: Readonly<NetworkAircraftQuery> = {};

/** One aircraft of a search source, under the id the map shows it by. */
export type SearchEntry = readonly [id: string, aircraft: SearchAircraft];

/** The data API's rows for the whole network, and the id the map shows the aircraft of a hex by. */
export type NetworkSource = {
  aircraft: readonly SearchAircraft[];
  idFor: (hex: string) => string;
};

/**
 * The aircraft a search covers, one per id: those of the map's view, then, with `network`, the rest
 * of the network under the id the map knows each hex by. The view's row for an aircraft wins over
 * the data API's, as it is the richer one (it carries the type and a solve's callsign); of two data
 * API rows for one aircraft, the fresher fix stays.
 */
export function searchEntriesOf(
  view: Iterable<SearchEntry>,
  network?: NetworkSource,
): SearchEntry[] {
  const entries = [...view];
  if (!network) return entries;
  const shown = new Set(entries.map(([id]) => id));
  const rest = new Map<string, SearchAircraft>();
  for (const aircraft of network.aircraft) {
    const id = network.idFor(aircraft.hex);
    if (shown.has(id)) continue;
    const held = rest.get(id);
    if (!held || (aircraft.seen ?? 0) < (held.seen ?? 0)) rest.set(id, aircraft);
  }
  return [...entries, ...rest];
}

/** One aircraft of the results, under the id the map shows it by. */
export type SearchResult = {
  id: string;
  hex: string;
  callsign: string | null;
  lat: number;
  lon: number;
  /** Feet, or 'ground'. */
  altitude: number | 'ground' | null;
  gs: number | null;
  track: number | null;
  multinode: boolean;
  nNodes: number | null;
  anomalous: boolean;
  drone: boolean;
};

function resultOf(id: string, aircraft: SearchAircraft): SearchResult {
  return {
    id,
    hex: aircraft.hex,
    callsign: aircraft.flight?.trim() || null,
    lat: aircraft.lat,
    lon: aircraft.lon,
    altitude: aircraft.alt_baro ?? null,
    gs: aircraft.gs ?? null,
    track: aircraft.track ?? null,
    multinode: aircraft.multinode === true,
    nNodes: aircraft.n_nodes ?? null,
    anomalous: aircraft.is_anomalous === true,
    drone: aircraft.target_class === 'drone',
  };
}

// The list's default order is by altitude, highest first, with none as 0 ft. 'ground' counts as
// 0 ft too: on the web it makes the comparison NaN, which leaves its place to the browser's sort.
const sortAltitudeOf = ({ altitude }: SearchResult) =>
  typeof altitude === 'number' ? altitude : 0;

/**
 * The aircraft that pass the filters and match the text, in the web list's default order: of the
 * map's view, and with `network` of the whole network too (searchEntriesOf).
 */
export function searchResultsOf(
  view: Iterable<SearchEntry>,
  text: string,
  filters: AircraftFilters,
  network?: NetworkSource,
): SearchResult[] {
  const results: SearchResult[] = [];
  for (const [id, entry] of searchEntriesOf(view, network)) {
    if (passesFilters(entry, filters) && matchesText(entry, text))
      results.push(resultOf(id, entry));
  }
  // Equal altitudes keep the order the aircraft came in.
  return results
    .map((result, at) => ({ result, at, altitude: sortAltitudeOf(result) }))
    .sort((a, b) => b.altitude - a.altitude || a.at - b.at)
    .map(({ result }) => result);
}
