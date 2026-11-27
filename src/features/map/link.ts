import type { InitialViewState } from '@maplibre/maplibre-react-native';
import { useSyncExternalStore } from 'react';

import { feedBoxOf, type FeedBox } from './feed';

// What other screens share with the live map: the box it shows the feed, and a request to open
// it on an aircraft. A module store, so a screen can ask before the map has ever been shown.

// The web map's default view.
const INITIAL_CENTER: [lon: number, lat: number] = [-82.39, 34.85];
const INITIAL_ZOOM = 8;
export const INITIAL_VIEW: InitialViewState = { center: INITIAL_CENTER, zoom: INITIAL_ZOOM };

// A phone held upright, in points, for the box before the map has measured itself.
const NOMINAL_VIEWPORT = { width: 390, height: 844 };
// The map's world is this many points wide at zoom 0.
const WORLD_POINTS = 512;
const RADIANS = Math.PI / 180;

/** Web Mercator y of a latitude, 0 at the top of the world and 1 at the bottom. */
const mercatorY = (lat: number) =>
  0.5 - Math.log(Math.tan(Math.PI / 4 + (lat * RADIANS) / 2)) / (2 * Math.PI);
const latitudeOf = (y: number) => Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) / RADIANS;

/** The feed's box for a phone's view centred on `center` at `zoom`. */
function boxAround(center: readonly [lon: number, lat: number], zoom: number): FeedBox | null {
  const world = WORLD_POINTS * 2 ** zoom;
  const halfWidth = NOMINAL_VIEWPORT.width / 2 / world;
  const halfHeight = NOMINAL_VIEWPORT.height / 2 / world;
  const [lon, lat] = center;
  const y = mercatorY(lat);
  return feedBoxOf({
    west: lon - halfWidth * 360,
    east: lon + halfWidth * 360,
    north: latitudeOf(y - halfHeight),
    south: latitudeOf(y + halfHeight),
  });
}

type Store<T> = {
  get: () => T;
  set: (next: T) => void;
  subscribe: (onChange: () => void) => () => void;
};

function createStore<T>(initial: T): Store<T> {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next) {
      if (Object.is(next, value)) return;
      value = next;
      for (const listener of listeners) listener();
    },
    subscribe(onChange) {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
  };
}

// Finite by construction, so never null.
const lastBox = createStore<FeedBox>(boxAround(INITIAL_CENTER, INITIAL_ZOOM)!);

/** Called by the map with every box it sends the feed. */
export function setLastMapBox(box: FeedBox | null): void {
  if (box !== null) lastBox.set(box);
}

/**
 * The box the map last sent to the feed, or the box around INITIAL_VIEW before the map has shown
 * one.
 */
export function useLastMapBox(): FeedBox {
  return useSyncExternalStore(lastBox.subscribe, lastBox.get);
}

export type MapFocusRequest = { hex: string; lat: number; lon: number; callsign: string | null };

/** A focus request waiting for the map, numbered so each is applied once. */
export type PendingMapFocus = MapFocusRequest & { seq: number };

const focus = createStore<PendingMapFocus | null>(null);
let lastSeq = 0;

/** Asks the map to fly to an aircraft and open its card; the newest request wins. */
export function requestMapFocus(request: MapFocusRequest): void {
  lastSeq += 1;
  const { hex, lat, lon, callsign } = request;
  focus.set({ hex, lat, lon, callsign, seq: lastSeq });
}

/** The request the map has not applied yet, if any. */
export function pendingMapFocus(): PendingMapFocus | null {
  return focus.get();
}

/** The request the map has not applied yet, kept current. */
export function useMapFocus(): PendingMapFocus | null {
  return useSyncExternalStore(focus.subscribe, focus.get);
}

/** Marks request `seq` applied. A newer request made meanwhile stays waiting. */
export function finishMapFocus(seq: number): void {
  if (focus.get()?.seq === seq) focus.set(null);
}
