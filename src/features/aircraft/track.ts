import type { AircraftHistoryRow } from '@/api';

// An aircraft's track: the live trail the feed's frames carry, merged the way the web map merges it
// (dashboard/src/pages/map/trails.ts and hooks.ts in retina-server), joined to the history the
// data API keeps, simplified, and drawn as one line.

/** A position as the feed's recent_positions give it; ts in epoch seconds. */
export type TrackPoint = readonly [lat: number, lon: number, altFt: number | null, ts: number];

/** The most positions a live trail keeps, the newest. */
export const MAX_TRAIL_POINTS = 400;
/**
 * The most positions one drawn line holds: about one per pixel across a phone held upright, so
 * more could not show more of the track, while the line the map is sent with every frame stays
 * small.
 */
export const MAX_DRAWN_POINTS = 1000;

// A merged position this close to the last one in both lat and lon is the same fix (trails.ts).
const SAME_FIX_DEG = 0.00001;
// A frame's position further than this from the last one in lat or lon is appended (hooks.ts).
const MOVED_DEG = 0.00005;
// About one pixel at zoom 12 on the equator, 19 m, and finer at any zoom further out: the points
// it drops change nothing that can be seen where a whole track fits on the screen.
const DEFAULT_TOLERANCE_M = 20;
// Douglas-Peucker can take time growing with the square of a track's length on some shapes; run
// on windows this many points long, it never takes more than this many distances per point.
const SIMPLIFY_WINDOW = 256;
const EARTH_RADIUS_M = 6_371_000;
const RADIANS = Math.PI / 180;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

// A position the feed would draw: inside the world, and not the 0, 0 "no position" sentinel.
function inWorld(lat: number, lon: number): boolean {
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0);
}

/**
 * A frame's recent_positions as points: each a [lat, lon, alt, ts] array with a usable position.
 * An altitude that is not a number is null, and a time that is not one is 0, as the web reads it.
 */
export function recentPositionsOf(value: unknown): TrackPoint[] {
  if (!Array.isArray(value)) return [];
  const points: TrackPoint[] = [];
  for (const entry of value) {
    if (!Array.isArray(entry) || entry.length < 2) continue;
    const [lat, lon, alt, ts] = entry as unknown[];
    if (!isFiniteNumber(lat) || !isFiniteNumber(lon) || !inWorld(lat, lon)) continue;
    points.push([lat, lon, isFiniteNumber(alt) ? alt : null, isFiniteNumber(ts) ? ts : 0]);
  }
  return points;
}

/**
 * A frame's recent positions merged into the trail held, as the web's mergeTrailPositions: the new
 * ones in time order, each one no newer than the last kept skipped, and one that has not moved from
 * it skipped too while still advancing the time to beat; then the newest MAX_TRAIL_POINTS. With
 * nothing held the frame's positions are taken as they are. Nothing new returns `held` itself.
 */
export function mergeTrail(
  held: readonly TrackPoint[],
  incoming: readonly TrackPoint[],
): readonly TrackPoint[] {
  if (incoming.length === 0) return held;
  const sorted = incoming.slice().sort((a, b) => a[3] - b[3]);
  if (held.length === 0) return sorted.slice(-MAX_TRAIL_POINTS);
  const merged = held.slice();
  let last = merged[merged.length - 1];
  let lastTs = last[3];
  for (const point of sorted) {
    if (point[3] <= lastTs) continue;
    if (
      Math.abs(last[0] - point[0]) < SAME_FIX_DEG &&
      Math.abs(last[1] - point[1]) < SAME_FIX_DEG
    ) {
      lastTs = point[3];
      continue;
    }
    merged.push(point);
    last = point;
    lastTs = point[3];
  }
  return merged.length > MAX_TRAIL_POINTS ? merged.slice(-MAX_TRAIL_POINTS) : merged;
}

/**
 * A frame's position for an aircraft whose entry carries no recent positions, as the web appends
 * it: only when it moved from the last one held, stamped `nowS`, keeping the newest
 * MAX_TRAIL_POINTS. Otherwise `held` itself.
 */
export function appendFix(
  held: readonly TrackPoint[],
  fix: { lat: number; lon: number; altFt: number | null },
  nowS: number,
): readonly TrackPoint[] {
  const { lat, lon, altFt } = fix;
  if (!inWorld(lat, lon)) return held;
  const last = held[held.length - 1];
  if (last && Math.abs(last[0] - lat) <= MOVED_DEG && Math.abs(last[1] - lon) <= MOVED_DEG) {
    return held;
  }
  const point: TrackPoint = [lat, lon, altFt, nowS];
  return [...held, point].slice(-MAX_TRAIL_POINTS);
}

/** The data API's history rows as points, oldest first, without those lacking a usable position. */
export function historyPoints(rows: readonly AircraftHistoryRow[]): TrackPoint[] {
  const points: TrackPoint[] = [];
  for (const { lat, lon, alt_baro, ts } of rows) {
    if (!inWorld(lat, lon) || !Number.isFinite(ts)) continue;
    points.push([lat, lon, isFiniteNumber(alt_baro) ? alt_baro : null, ts]);
  }
  return points.sort((a, b) => a[3] - b[3]);
}

/** The steps that bring each longitude within 180° of the one before, so a line crossing the
 *  antimeridian runs on past ±180 instead of across the world. */
function unwrapper(): (lon: number) => number {
  let previous: number | null = null;
  let offset = 0;
  return (lon) => {
    if (previous !== null) {
      const step = lon - previous;
      if (step > 180) offset -= 360;
      else if (step < -180) offset += 360;
    }
    previous = lon;
    return lon + offset;
  };
}

/**
 * The track with the points that change its shape by less than `toleranceM` left out, first and
 * last kept: Douglas-Peucker on an equirectangular projection around the track's middle latitude,
 * in metres, by distance to each segment. Each window of SIMPLIFY_WINDOW points is simplified on
 * its own, its ends kept, and on a stack of its own, so a long track can neither stall the app nor
 * overflow the call stack. A tolerance that is not above 0 keeps every point.
 */
export function simplifyTrack(
  points: readonly TrackPoint[],
  toleranceM: number = DEFAULT_TOLERANCE_M,
): TrackPoint[] {
  const count = points.length;
  if (count <= 2 || !(toleranceM > 0)) return points.slice();
  let south = Infinity;
  let north = -Infinity;
  for (const [lat] of points) {
    south = Math.min(south, lat);
    north = Math.max(north, lat);
  }
  const metresPerDegLat = EARTH_RADIUS_M * RADIANS;
  const metresPerDegLon = metresPerDegLat * Math.cos(((south + north) / 2) * RADIANS);
  const xs = new Float64Array(count);
  const ys = new Float64Array(count);
  const unwrap = unwrapper();
  for (let i = 0; i < count; i++) {
    xs[i] = unwrap(points[i][1]) * metresPerDegLon;
    ys[i] = points[i][0] * metresPerDegLat;
  }

  const keep = new Uint8Array(count);
  const spans: number[] = [];
  for (let start = 0; start < count - 1; start += SIMPLIFY_WINDOW) {
    const end = Math.min(start + SIMPLIFY_WINDOW, count - 1);
    keep[start] = 1;
    keep[end] = 1;
    spans.push(start, end);
  }
  const limit = toleranceM * toleranceM;
  while (spans.length > 0) {
    const end = spans.pop() as number;
    const start = spans.pop() as number;
    const ax = xs[start];
    const ay = ys[start];
    const dx = xs[end] - ax;
    const dy = ys[end] - ay;
    const length2 = dx * dx + dy * dy;
    let farthest = -1;
    let farthest2 = limit;
    for (let i = start + 1; i < end; i++) {
      let px = xs[i] - ax;
      let py = ys[i] - ay;
      if (length2 > 0) {
        const t = Math.min(1, Math.max(0, (px * dx + py * dy) / length2));
        px -= t * dx;
        py -= t * dy;
      }
      const distance2 = px * px + py * py;
      if (distance2 > farthest2) {
        farthest2 = distance2;
        farthest = i;
      }
    }
    if (farthest !== -1) {
      keep[farthest] = 1;
      spans.push(start, farthest, farthest, end);
    }
  }
  return points.filter((_, i) => keep[i] === 1);
}

/** The history older than the live trail's first position, then the live trail. */
export function joinTrack(
  history: readonly TrackPoint[],
  live: readonly TrackPoint[],
): TrackPoint[] {
  if (live.length === 0) return history.slice();
  const firstLiveTs = live[0][3];
  return [...history.filter((point) => point[3] < firstLiveTs), ...live];
}

export type TrackLine = {
  type: 'FeatureCollection';
  features: {
    type: 'Feature';
    geometry: { type: 'LineString'; coordinates: [lon: number, lat: number][] };
    properties: { points: number };
  }[];
};

/** No line to draw. */
export const NO_TRACK: TrackLine = { type: 'FeatureCollection', features: [] };

/**
 * The track as one GeoJSON line at [lon, lat], or NO_TRACK under 2 points. Over `maxPoints` it is
 * sampled at an even stride from the first point, the last always kept, as the web samples its
 * trail; the stride only changes as the track grows past a multiple of it, so the line holds still
 * from frame to frame. Longitudes are unwrapped point to point.
 */
export function trackLine(
  points: readonly TrackPoint[],
  maxPoints: number = MAX_DRAWN_POINTS,
): TrackLine {
  const count = points.length;
  if (count < 2) return NO_TRACK;
  const cap = Math.max(2, Math.floor(maxPoints));
  const stride = count > cap ? Math.ceil((count - 1) / (cap - 1)) : 1;
  const unwrap = unwrapper();
  const coordinates: [lon: number, lat: number][] = [];
  for (let i = 0; i < count - 1; i += stride) {
    coordinates.push([unwrap(points[i][1]), points[i][0]]);
  }
  const last = points[count - 1];
  coordinates.push([unwrap(last[1]), last[0]]);
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: { type: 'LineString', coordinates },
        properties: { points: coordinates.length },
      },
    ],
  };
}
