import type { StyleSpecification } from '@maplibre/maplibre-react-native';
import * as SecureStore from 'expo-secure-store';

import { palette, type ColorScheme } from '@/theme/tokens';

// The web map's basemaps (dashboard/src/pages/map/utils/tiles.ts and basemap.ts in
// retina-server), as raster sources for MapLibre.

export type BasemapId = 'positron' | 'voyager' | 'dark' | 'osm';

/** The order the basemap switch cycles through. */
export const BASEMAPS: readonly BasemapId[] = ['positron', 'voyager', 'dark', 'osm'];

/** Each theme has the basemap its colours were picked against, as on the web map. */
export const DEFAULT_BASEMAP: Record<ColorScheme, BasemapId> = {
  light: 'positron',
  dark: 'voyager',
};

const CHOICE_KEY = 'retina.map.basemap';
// The same keychain class as the session (src/auth/tokenStore.ts): readable after the first unlock
// and never carried to another device by a backup.
const CHOICE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

let choiceCalls: Promise<unknown> = Promise.resolve();

// One SecureStore call at a time, in the order made, as tokenStore does: the native side does not
// promise to keep two in order, and an older choice landing last would come back next start.
function serial<T>(operation: () => Promise<T>): Promise<T> {
  const result = choiceCalls.then(operation);
  choiceCalls = result.catch(() => undefined);
  return result;
}

function isBasemapId(value: unknown): value is BasemapId {
  return typeof value === 'string' && (BASEMAPS as readonly string[]).includes(value);
}

/**
 * The basemap picked by hand on an earlier run, or null when none was (the map then follows the
 * theme). A stored name this version does not know reads as null, as does a store that cannot be
 * read: the choice is a convenience, so it never stops the map. Never rejects.
 */
export function loadBasemapChoice(): Promise<BasemapId | null> {
  return serial(() => SecureStore.getItemAsync(CHOICE_KEY, CHOICE_OPTIONS)).then(
    (stored) => (isBasemapId(stored) ? stored : null),
    () => null,
  );
}

/**
 * Keeps the basemap picked by hand for the next run; null forgets it, so the next run follows the
 * theme. Calls land in the order made, so the last choice wins. A write that fails is dropped
 * without a word; the map keeps showing the choice for this run. Never rejects.
 */
export function saveBasemapChoice(choice: BasemapId | null): Promise<void> {
  return serial(() =>
    choice === null
      ? SecureStore.deleteItemAsync(CHOICE_KEY, CHOICE_OPTIONS)
      : SecureStore.setItemAsync(CHOICE_KEY, choice, CHOICE_OPTIONS),
  ).catch(() => undefined);
}

/** The web map's names where it has one. */
export const BASEMAP_LABELS: Record<BasemapId, string> = {
  positron: 'Light',
  voyager: 'Muted',
  dark: 'Dark',
  osm: 'OSM',
};

// MapLibre has no {s} or {r} placeholders, so each CARTO subdomain is its own URL, and the @2x
// tiles at a tile size of 256 stay sharp on phone screens. Positron is the live map's
// `rastertiles/light_all` spelling.
const CARTO_SUBDOMAINS = ['a', 'b', 'c', 'd'];
const CARTO_STYLES: Record<Exclude<BasemapId, 'osm'>, string> = {
  positron: 'rastertiles/light_all',
  voyager: 'rastertiles/voyager',
  dark: 'dark_all',
};
// One host: OpenStreetMap has deprecated its a/b/c subdomains.
const OSM_TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
// The deepest zoom each provider serves; past it MapLibre scales the last tiles up instead of
// asking for ones that do not exist. CARTO: github.com/CartoDB/basemap-styles; OSM: the zoom the
// Leaflet quick start gives tile.openstreetmap.org.
const CARTO_MAX_ZOOM = 20;
const OSM_MAX_ZOOM = 19;

// The web map's tile filter for each theme (dashboard/src/pages/map/map-surface.css), whatever
// basemap is shown: in dark the tiles are pushed back over the theme's background, as
// saturate(0.85) brightness(0.78) opacity(0.82); in light only some colour goes, as saturate(0.9).
const BASEMAP_PAINT = {
  dark: { 'raster-saturation': -0.15, 'raster-brightness-max': 0.78, 'raster-opacity': 0.82 },
  light: { 'raster-saturation': -0.1 },
} satisfies Record<ColorScheme, Record<string, number>>;

const OSM_CREDIT = {
  label: '© OpenStreetMap contributors',
  url: 'https://www.openstreetmap.org/copyright',
};
const CARTO_CREDIT = { label: '© CARTO', url: 'https://carto.com/attributions' };

/** The credit a basemap's terms ask for, as text and as the links behind it. */
export function basemapAttribution(id: BasemapId): {
  text: string;
  links: { label: string; url: string }[];
} {
  const links = id === 'osm' ? [OSM_CREDIT] : [OSM_CREDIT, CARTO_CREDIT];
  return { text: links.map((link) => link.label).join(' '), links: links.map((l) => ({ ...l })) };
}

/**
 * The tile URLs of a basemap. CARTO watermarks every tile asked for without its key, so the key
 * goes on each CARTO URL as `key` (CARTO ignores any other name without an error). It never goes
 * anywhere else: on an OSM tile it would only be a stray parameter handed to another host.
 */
function tilesOf(id: BasemapId, cartoKey: string): string[] {
  if (id === 'osm') return [OSM_TILES];
  const key = cartoKey.trim();
  const query = key ? `?key=${encodeURIComponent(key)}` : '';
  return CARTO_SUBDOMAINS.map(
    (s) => `https://${s}.basemaps.cartocdn.com/${CARTO_STYLES[id]}/{z}/{x}/{y}@2x.png${query}`,
  );
}

/**
 * The map style for a basemap: the theme's background under one raster source, `basemap`, tinted
 * for the theme. The background shows while tiles load and wherever none come, so an empty map
 * still matches the app around it.
 */
export function basemapStyle(
  id: BasemapId,
  cartoKey: string,
  scheme: ColorScheme,
): StyleSpecification {
  const { links } = basemapAttribution(id);
  return {
    version: 8,
    sources: {
      basemap: {
        type: 'raster',
        tiles: tilesOf(id, cartoKey),
        tileSize: 256,
        maxzoom: id === 'osm' ? OSM_MAX_ZOOM : CARTO_MAX_ZOOM,
        attribution: links.map((link) => `<a href="${link.url}">${link.label}</a>`).join(' '),
      },
    },
    layers: [
      {
        id: 'background',
        type: 'background',
        paint: { 'background-color': palette[scheme].bgPrimary },
      },
      { id: 'basemap', type: 'raster', source: 'basemap', paint: { ...BASEMAP_PAINT[scheme] } },
    ],
  };
}
