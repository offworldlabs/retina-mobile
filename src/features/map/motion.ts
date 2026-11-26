import type { LiveAircraft } from './feed';

// Aircraft glide between the feed's frames the way the web map glides them
// (dashboard/src/pages/map/LiveAircraftMap.tsx and archiveDisplay.ts in retina-server): each fix
// is dead-reckoned along its ground speed and track, and the drawn position eases towards that
// with the same time constant, heading the short way round, and the same guard against jumps a
// solver glitch makes. Unlike the web map, which reckons up to a minute ahead, a fix is reckoned
// at most one feed frame ahead, so nothing is drawn further past the feed than one frame of
// travel, however long the feed has been quiet.

/** The feed's frame period: the server sends the aircraft in view once a second. */
export const FEED_FRAME_MS = 1000;
/** One display frame at 60 Hz, the rate frame callbacks come at on an idle thread. */
export const FRAME_MS = 1000 / 60;

/** The glide's time constant, in seconds: lower is snappier, higher glides more. */
const TAU_S = 0.55;
/**
 * The longest step one ease takes unless the step rate allows a longer one (stepLimitS), so a
 * stall (a busy thread, a resumed loop) is not caught up in one leap.
 */
const MAX_STEP_S = 0.1;
const MS_PER_KNOT = 0.514444;
const METRES_PER_DEGREE = 111_320;
const EARTH_RADIUS_KM = 6371;
const RADIANS = Math.PI / 180;
// A new fix further from the drawn position than this is a jump no aircraft makes, so the icon
// is put there at once instead of gliding across the gap: 0.6 km plus 1 km/s (about Mach 3) for
// each second since the last fix, the second counting as at least 0.1 s.
const SNAP_KM = 0.6;
const SNAP_KM_PER_S = 1;
const SNAP_MIN_S = 0.1;

/**
 * Where the feed last put an aircraft and how it was moving, with the time that position came in
 * (`atMs`, on the loop's monotonic clock, performance.now()). `track` is in [0, 360).
 */
export type Fix = {
  lat: number;
  lon: number;
  gs: number | undefined;
  track: number | undefined;
  atMs: number;
};

/** An aircraft as drawn: its position and heading on screen, and the fix it glides along. */
export type Glide = { lat: number; lon: number; track: number | null; fix: Fix };

type Moving = Pick<LiveAircraft, 'lat' | 'lon' | 'gs' | 'track'>;

const heading = (track: number | undefined) =>
  track === undefined ? undefined : ((track % 360) + 360) % 360;
const wrapLon = (lon: number) => ((((lon + 180) % 360) + 360) % 360) - 180;
const clampLat = (lat: number) => Math.min(90, Math.max(-90, lat));

function fixOf(aircraft: Moving, atMs: number): Fix {
  const { lat, lon, gs } = aircraft;
  return { lat, lon, gs, track: heading(aircraft.track), atMs };
}

/** Great-circle distance, as the web map's guard measures it (dashboard/src/utils/geo.ts). */
function distanceKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const h =
    Math.sin(((bLat - aLat) * RADIANS) / 2) ** 2 +
    Math.cos(aLat * RADIANS) *
      Math.cos(bLat * RADIANS) *
      Math.sin(((bLon - aLon) * RADIANS) / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** An aircraft new to the map, drawn at its fix. */
export function startGlide(aircraft: Moving, nowMs: number): Glide {
  const fix = fixOf(aircraft, nowMs);
  return { lat: fix.lat, lon: fix.lon, track: fix.track ?? null, fix };
}

/**
 * A new frame's fix for an aircraft already drawn. The glide carries on from where the icon is,
 * unless the new position is further from it than the jump guard allows, which puts the icon on
 * the fix. A position the feed repeats keeps the time of the fix, as on the web map: the server
 * sends a solve again each second until the next one, and reckoning it afresh each time would
 * pull the icon back to it. A fix without a track is drawn without a heading, as the feed shows it.
 */
export function takeFix(glide: Glide, aircraft: Moving, nowMs: number): void {
  const last = glide.fix;
  const moved = aircraft.lat !== last.lat || aircraft.lon !== last.lon;
  if (moved) {
    const sinceS = Math.max((nowMs - last.atMs) / 1000, SNAP_MIN_S);
    const jumpKm = distanceKm(glide.lat, glide.lon, aircraft.lat, aircraft.lon);
    if (jumpKm > SNAP_KM + SNAP_KM_PER_S * sinceS) {
      glide.lat = aircraft.lat;
      glide.lon = aircraft.lon;
    }
  }
  glide.fix = fixOf(aircraft, moved ? nowMs : last.atMs);
  if (glide.fix.track === undefined) glide.track = null;
  else if (glide.track === null) glide.track = glide.fix.track;
}

/**
 * Moves the drawn aircraft `dtS` seconds on, to `nowMs`: towards its fix reckoned ahead along the
 * ground speed and track for the time since the fix, at most one feed frame, and eased by
 * 1 - exp(-dt / 0.55 s) with dt at most `maxStepS` (0.1 s unless given). Without a ground speed or
 * a track the fix itself is the target. Longitude eases the short way across the antimeridian,
 * heading the short way round.
 */
export function stepGlide(glide: Glide, nowMs: number, dtS: number, maxStepS = MAX_STEP_S): void {
  const { fix } = glide;
  const alpha = 1 - Math.exp(-Math.min(Math.max(dtS, 0), maxStepS) / TAU_S);
  let lat = fix.lat;
  let lon = fix.lon;
  const aheadS = Math.min(Math.max(nowMs - fix.atMs, 0), FEED_FRAME_MS) / 1000;
  if (aheadS > 0 && fix.gs !== undefined && fix.gs > 0 && fix.track !== undefined) {
    const metres = fix.gs * MS_PER_KNOT * aheadS;
    const course = fix.track * RADIANS;
    const metresPerDegreeLon = METRES_PER_DEGREE * Math.max(Math.cos(fix.lat * RADIANS), 1e-9);
    lat = clampLat(fix.lat + (metres * Math.cos(course)) / METRES_PER_DEGREE);
    lon = fix.lon + (metres * Math.sin(course)) / metresPerDegreeLon;
  }
  glide.lat += (lat - glide.lat) * alpha;
  glide.lon = wrapLon(glide.lon + wrapLon(lon - glide.lon) * alpha);
  if (fix.track !== undefined && glide.track !== null) {
    const turn = ((fix.track - glide.track + 540) % 360) - 180;
    glide.track = (glide.track + turn * alpha + 360) % 360;
  }
}

/**
 * The longest step one ease takes when the loop steps every `intervalMs`: the interval and one
 * display frame, for a step that comes a frame late, and at least 0.1 s. A step at the planned rate
 * then eases by all the time it took, so a slow rate glides at the pace of a fast one, and only a
 * longer gap is cut short.
 */
export function stepLimitS(intervalMs: number): number {
  return Math.max(MAX_STEP_S, (intervalMs + FRAME_MS) / 1000);
}

/**
 * How the aircraft are drawn between feed frames. With `smooth`, the loop steps every
 * `intervalMs`. Without it no loop runs and the map shows each frame as it comes, and
 * `intervalMs` is the feed's frame period, FEED_FRAME_MS: the aircraft move once a second.
 */
export type MotionPlan = { smooth: boolean; intervalMs: number };

// The step rate by the number of aircraft in view: a step's cost grows with each aircraft drawn,
// so more aircraft are stepped less often. Past the last tier smoothing is off.
const TIERS: readonly { maxCount: number; intervalMs: number }[] = [
  { maxCount: 200, intervalMs: 33 }, // about 30 a second
  { maxCount: 500, intervalMs: 50 }, // 20 a second
  { maxCount: 800, intervalMs: 100 }, // 10 a second
  { maxCount: 1500, intervalMs: 250 }, // 4 a second
];
// A tier is left for the next slower one when a step costs more than this share of its interval,
// and won back only once a step costs less than the lower share of the faster interval, so the
// rate does not flap at the edge.
const STEP_DOWN_SHARE = 0.25;
const STEP_UP_SHARE = 0.1;

const STILL: MotionPlan = { smooth: false, intervalMs: FEED_FRAME_MS };

function tierOf(plan: MotionPlan): number {
  if (!plan.smooth) return TIERS.length;
  return TIERS.findIndex((tier) => tier.intervalMs === plan.intervalMs);
}

/**
 * The plan for `count` aircraft when a step has lately cost `avgTickMs` (the JS work of a step
 * and the time the thread then stayed busy). Reduce motion turns smoothing off, as do more
 * aircraft than the last tier takes. Otherwise the count picks the tier, and the cost moves it:
 * one tier slower when a step takes more than a quarter of the interval (off, past the slowest),
 * and, given the `previous` plan, one tier back towards the count's tier only when a step takes
 * less than a tenth of the faster interval.
 */
export function motionPlan(
  count: number,
  avgTickMs: number,
  reduceMotion: boolean,
  previous?: MotionPlan,
): MotionPlan {
  if (reduceMotion) return STILL;
  const countTier = TIERS.findIndex((tier) => count <= tier.maxCount);
  if (countTier === -1) return STILL;
  let tier = countTier;
  const before = previous ? tierOf(previous) : -1;
  if (before > countTier) {
    const faster = TIERS[before - 1];
    tier = avgTickMs < STEP_UP_SHARE * faster.intervalMs ? before - 1 : before;
  }
  if (tier < TIERS.length && avgTickMs > STEP_DOWN_SHARE * TIERS[tier].intervalMs) tier += 1;
  return tier < TIERS.length ? { smooth: true, intervalMs: TIERS[tier].intervalMs } : STILL;
}
