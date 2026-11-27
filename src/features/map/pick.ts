import type { LngLat } from '@maplibre/maplibre-react-native';

const RADIANS = Math.PI / 180;
const TURN = 2 * Math.PI;
// The latitude where the Web Mercator square ends (atan(sinh(pi))); the map draws nothing past it,
// and the projection runs to infinity at the poles.
const MAX_LATITUDE = 85.0511287798066;

function mercatorY(latitude: number): number {
  const lat = Math.min(MAX_LATITUDE, Math.max(-MAX_LATITUDE, latitude)) * RADIANS;
  return Math.log(Math.tan(Math.PI / 4 + lat / 2));
}

function pointOf(geometry: unknown): LngLat | null {
  if (typeof geometry !== 'object' || geometry === null) return null;
  const { type, coordinates } = geometry as { type?: unknown; coordinates?: unknown };
  if (type !== 'Point' || !Array.isArray(coordinates)) return null;
  const [lon, lat] = coordinates;
  return Number.isFinite(lon) && Number.isFinite(lat) ? [lon, lat] : null;
}

/**
 * The feature whose point is nearest to `lngLat` on the Web Mercator plane, which is the distance
 * on screen for a map that is not tilted: a tap that covers several icons opens the one under the
 * finger. Degrees would not do, since a degree of longitude is drawn wider than a degree of
 * latitude and more so towards the poles. The east-west gap is taken the short way round, across
 * the antimeridian when that is shorter. A feature that is not a point with finite coordinates is
 * skipped; null when none is left. Of two at the same distance, the first wins.
 */
export function nearestFeature<F extends { geometry: unknown }>(
  lngLat: LngLat,
  features: readonly F[],
): F | null {
  const [lon, lat] = lngLat;
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  const x = lon * RADIANS;
  const y = mercatorY(lat);
  let nearest: F | null = null;
  let nearestSquared = Infinity;
  for (const feature of features) {
    const point = pointOf(feature.geometry);
    if (!point) continue;
    let dx = point[0] * RADIANS - x;
    dx -= TURN * Math.round(dx / TURN);
    const dy = mercatorY(point[1]) - y;
    const squared = dx * dx + dy * dy;
    if (squared < nearestSquared) {
      nearest = feature;
      nearestSquared = squared;
    }
  }
  return nearest;
}
