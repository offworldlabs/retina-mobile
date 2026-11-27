// The public real-fleet aircraft feed as the map reads it, ported from the web map's feed
// (dashboard/src/pages/map/hooks.ts and types.ts in retina-server). The socket is
// /ws/aircraft/live: it says nothing until it is told the box in view, then sends every aircraft
// in that box once a second. aircraft-live.json answers the same frame for a box over HTTP.

/**
 * The box the feed is bound to, in degrees, in the order the server reads it: the `bbox` of a
 * `viewport` message and of aircraft-live.json. Longitudes are in [-180, 180], and a west edge
 * east of the east edge is a box across the antimeridian.
 */
export type FeedBox = readonly [south: number, west: number, north: number, east: number];

/** A west edge into [-180, 180): one on the antimeridian is -180. */
const wrapWest = (lon: number) => ((((lon + 180) % 360) + 360) % 360) - 180;
/** An east edge into (-180, 180]: one on the antimeridian is 180. */
const wrapEast = (lon: number) => 180 - ((((180 - lon) % 360) + 360) % 360);
const clampLat = (lat: number) => Math.min(90, Math.max(-90, lat));

/**
 * The map's visible bounds as the feed's box, or null until the map has a view. Bounds run
 * outside [-180, 180] once the map is panned into another copy of the world, and span more than
 * the world zoomed far out; the server takes neither. So a view the width of the world asks for
 * all of it, and otherwise each edge is brought into the canonical copy, which puts west east of
 * east when the view crosses the antimeridian. The box is the view itself, unpadded: the server
 * cuts one past its cap down around its centre and says so on the frame.
 */
export function feedBoxOf(
  view: { north: number; south: number; east: number; west: number } | null,
): FeedBox | null {
  if (!view) return null;
  const { north, south, east, west } = view;
  if (![north, south, east, west].every(Number.isFinite)) return null;
  if (east - west >= 360) return [clampLat(south), -180, clampLat(north), 180];
  return [clampLat(south), wrapWest(west), clampLat(north), wrapEast(east)];
}

/** How long the view has to stay put before a new box goes to the server, so a drag or a zoom
 *  animation sends the box it ends on rather than a stream. */
export const VIEWPORT_SETTLE_MS = 300;

/** The wait before reconnect number `attempt` (from 0): 3 s, 6 s, 12 s, ... capped at 30 s. */
export function reconnectDelay(attempt: number): number {
  return Math.min(3000 * 2 ** attempt, 30000);
}

const SOCKET_SCHEMES: Record<string, string> = { http: 'ws', https: 'wss' };

/** The live feed's socket URL on the API host: ws for an http base, wss for https. */
export function liveSocketUrl(apiBaseUrl: string): string {
  const match = /^([a-z][a-z0-9+.-]*):(\/\/.+)$/i.exec(apiBaseUrl.trim());
  const scheme = match ? SOCKET_SCHEMES[match[1].toLowerCase()] : undefined;
  if (!match || !scheme) throw new Error(`API base URL must be http or https: ${apiBaseUrl}`);
  return `${scheme}:${match[2].replace(/\/+$/, '')}/ws/aircraft/live`;
}

/** The message that binds the socket to a box. */
export function viewportMessage(box: FeedBox): string {
  return JSON.stringify({ type: 'viewport', bbox: box });
}

/** One aircraft of a feed frame, as much of it as the app reads. */
export type LiveAircraft = {
  hex: string;
  lat: number;
  lon: number;
  flight?: string;
  alt_baro?: number;
  alt_m?: number;
  gs?: number;
  track?: number;
  squawk?: string;
  type?: string;
  node_ref?: string;
  position_source?: string;
  multinode?: boolean;
  n_nodes?: number;
  contributing_node_refs?: string[];
  seen?: number;
};

type Entry = Record<string, unknown>;

const STRING_FIELDS = ['flight', 'squawk', 'type', 'node_ref', 'position_source'] as const;
const NUMBER_FIELDS = ['alt_baro', 'alt_m', 'gs', 'track', 'n_nodes', 'seen'] as const;

function isRecord(value: unknown): value is Entry {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function aircraftOf(entry: unknown): LiveAircraft | null {
  if (!isRecord(entry)) return null;
  const { hex, lat, lon } = entry;
  if (typeof hex !== 'string' || hex === '') return null;
  if (!isFiniteNumber(lat) || !isFiniteNumber(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  // Exactly 0, 0 is the "no position" sentinel, which the web map never draws either.
  if (lat === 0 && lon === 0) return null;
  const aircraft: LiveAircraft = { hex, lat, lon };
  for (const field of STRING_FIELDS) {
    const value = entry[field];
    if (typeof value === 'string') aircraft[field] = value;
  }
  for (const field of NUMBER_FIELDS) {
    const value = entry[field];
    if (isFiniteNumber(value)) aircraft[field] = value;
  }
  if (typeof entry.multinode === 'boolean') aircraft.multinode = entry.multinode;
  const refs = entry.contributing_node_refs;
  if (Array.isArray(refs) && refs.every((ref) => typeof ref === 'string')) {
    aircraft.contributing_node_refs = refs;
  }
  return aircraft;
}

/**
 * A socket frame or an aircraft-live.json body as the aircraft in it, one per hex (a repeated hex
 * keeps its last entry), and whether the server clipped the box it was asked for. Null for
 * anything without an `aircraft` array. An entry without a hex or a usable position is dropped,
 * and an optional field of the wrong type is left out.
 */
export function parseFrame(data: unknown): { aircraft: LiveAircraft[]; clipped: boolean } | null {
  if (!isRecord(data) || !Array.isArray(data.aircraft)) return null;
  const byHex = new Map<string, LiveAircraft>();
  for (const entry of data.aircraft) {
    const aircraft = aircraftOf(entry);
    if (aircraft) byHex.set(aircraft.hex, aircraft);
  }
  const { viewport } = data;
  return {
    aircraft: [...byHex.values()],
    clipped: isRecord(viewport) && viewport.clipped === true,
  };
}

// Minimal GeoJSON shapes, enough for what the map sources take.
export type PointGeometry = { type: 'Point'; coordinates: [lon: number, lat: number] };
export type PointFeature<P> = { type: 'Feature'; geometry: PointGeometry; properties: P };
export type PointCollection<P> = { type: 'FeatureCollection'; features: PointFeature<P>[] };

/** What the aircraft layer reads from a feature. `alt` is in feet. */
export type AircraftProps = {
  hex: string;
  track: number | null;
  callsign: string | null;
  alt: number | null;
};

export type AircraftCollection = PointCollection<AircraftProps>;

const FEET_PER_METRE = 3.28084;

function altitudeFeet(aircraft: LiveAircraft): number | null {
  if (aircraft.alt_baro !== undefined) return aircraft.alt_baro;
  if (aircraft.alt_m !== undefined) return Math.round(aircraft.alt_m * FEET_PER_METRE);
  return null;
}

/** The aircraft as one GeoJSON source: a point per aircraft, at [lon, lat]. */
export function toFeatureCollection(aircraft: readonly LiveAircraft[]): AircraftCollection {
  return {
    type: 'FeatureCollection',
    features: aircraft.map((a) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [a.lon, a.lat] },
      properties: {
        hex: a.hex,
        track: a.track ?? null,
        callsign: a.flight?.trim() || null,
        alt: altitudeFeet(a),
      },
    })),
  };
}
