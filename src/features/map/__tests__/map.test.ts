/// <reference types="jest" />
import { basemapStyle } from '../basemap';
import { feedBoxOf, parseFrame, toFeatureCollection } from '../feed';
import { createAircraftIdentity } from '../identity';
import { finishMapFocus, pendingMapFocus, requestMapFocus } from '../link';
import { createLiveFeed, type LiveFeedState } from '../liveFeed';
import { motionPlan, startGlide, stepGlide, takeFix, type MotionPlan } from '../motion';
import { nearestFeature } from '../pick';

// The app config the native build embeds; jest-expo's stand-in carries no `extra`.
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: {
      extra: {
        appEnv: 'development',
        apiBaseUrl: { ios: 'http://i.test', android: 'http://a.test' },
      },
    },
  },
}));

// Outside the mock factory, so it outlives a module reset the way the keychain outlives the app.
const mockKeychain = new Map<string, string>();

jest.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 0,
  getItemAsync: async (key: string) => mockKeychain.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => void mockKeychain.set(key, value),
  deleteItemAsync: async (key: string) => void mockKeychain.delete(key),
}));

afterEach(() => {
  jest.useRealTimers();
});

test('turns a feed frame into one point per aircraft with a position', () => {
  const frame = parseFrame({
    now: 1700000000,
    aircraft: [
      { hex: 'abc123', lat: 10.5, lon: 20.25, flight: 'TST12  ', alt_baro: 35000, track: 90 },
      { hex: 'def456', lat: -5, lon: 179.5, alt_m: 1000 },
      { hex: 'bad789', lat: 95, lon: 20 },
    ],
    viewport: { bbox: [-10, 10, 20, 180], clipped: true },
  });

  expect(frame?.clipped).toBe(true);
  expect(toFeatureCollection((frame?.aircraft ?? []).map((a) => [a.hex, a] as const))).toEqual({
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [20.25, 10.5] },
        properties: { id: 'abc123', hex: 'abc123', track: 90, callsign: 'TST12', alt: 35000 },
      },
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [179.5, -5] },
        properties: { id: 'def456', hex: 'def456', track: null, callsign: null, alt: 3281 },
      },
    ],
  });
});

test('binds the feed to the view, across the antimeridian and world-wide', () => {
  expect(feedBoxOf({ south: 50, west: 10, north: 52, east: 14 })).toEqual([50, 10, 52, 14]);
  expect(feedBoxOf({ south: -20, west: 170, north: -10, east: 190 })).toEqual([
    -20, 170, -10, -170,
  ]);
  expect(feedBoxOf({ south: -100, west: -250, north: 100, east: 200 })).toEqual([
    -90, -180, 90, 180,
  ]);
});

class FakeSocket {
  static made: FakeSocket[] = [];
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(readonly url: string) {
    FakeSocket.made.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {}
}

test('sends the box on open, settles moves, backs off reconnects and stays stopped', () => {
  jest.useFakeTimers();
  const sockets = FakeSocket.made;
  const feed = createLiveFeed({
    apiBaseUrl: 'https://api.example.com',
    onUpdate: () => {},
    WebSocketImpl: FakeSocket as unknown as typeof WebSocket,
    fetchFrame: () => new Promise(() => {}),
    isOffline: () => false,
  });
  feed.setBox([50, 10, 52, 14]);
  feed.start();
  expect(sockets.map((s) => s.url)).toEqual(['wss://api.example.com/ws/aircraft/live']);

  sockets[0].onopen?.();
  expect(sockets[0].sent).toEqual(['{"type":"viewport","bbox":[50,10,52,14]}']);

  feed.setBox([50, 11, 52, 15]);
  jest.advanceTimersByTime(100);
  feed.setBox([50, 12, 52, 16]);
  jest.advanceTimersByTime(299);
  expect(sockets[0].sent).toHaveLength(1);
  jest.advanceTimersByTime(1);
  expect(sockets[0].sent).toEqual([
    '{"type":"viewport","bbox":[50,10,52,14]}',
    '{"type":"viewport","bbox":[50,12,52,16]}',
  ]);

  sockets[0].onclose?.();
  jest.advanceTimersByTime(2999);
  expect(sockets).toHaveLength(1);
  jest.advanceTimersByTime(1);
  expect(sockets).toHaveLength(2);

  // Accepted, then closed before any frame: the backoff goes on growing.
  sockets[1].onopen?.();
  expect(sockets[1].sent).toEqual(['{"type":"viewport","bbox":[50,12,52,16]}']);
  sockets[1].onclose?.();
  jest.advanceTimersByTime(5999);
  expect(sockets).toHaveLength(2);
  jest.advanceTimersByTime(1);
  expect(sockets).toHaveLength(3);

  const lateClose = sockets[2].onclose;
  feed.stop();
  lateClose?.();
  jest.advanceTimersByTime(60_000);
  expect(sockets).toHaveLength(3);
});

test('closes a socket stopped while connecting once it opens late', () => {
  // React Native's Android socket: close() does nothing until the handshake is done.
  class AndroidSocket extends FakeSocket {
    static CONNECTING = 0;
    readyState = 0;
    close() {
      if (this.readyState === 1) this.readyState = 3;
    }
  }
  const statuses: string[] = [];
  const feed = createLiveFeed({
    apiBaseUrl: 'https://api.example.com',
    onUpdate: (state) => statuses.push(state.status),
    WebSocketImpl: AndroidSocket as unknown as typeof WebSocket,
    fetchFrame: () => new Promise(() => {}),
    isOffline: () => false,
  });
  feed.start();
  feed.setBox([50, 10, 52, 14]);
  feed.stop();
  const socket = FakeSocket.made[FakeSocket.made.length - 1] as AndroidSocket;
  socket.readyState = 1;
  socket.onopen?.();
  expect(socket.readyState).toBe(3);
  expect(statuses).toEqual(['connecting', 'paused']);
});

test('keeps an aircraft under one id across the renames the server makes', () => {
  jest.useFakeTimers();
  const states: LiveFeedState[] = [];
  const feed = createLiveFeed({
    apiBaseUrl: 'https://api.example.com',
    onUpdate: (state) => states.push(state),
    WebSocketImpl: FakeSocket as unknown as typeof WebSocket,
    fetchFrame: () => new Promise(() => {}),
    isOffline: () => false,
  });
  feed.setBox([50, 10, 52, 14]);
  feed.start();
  const socket = FakeSocket.made[FakeSocket.made.length - 1];
  socket.onopen?.();
  // Each aircraft shown, as [id, hex].
  const send = (aircraft: object[]) => {
    socket.onmessage?.({ data: JSON.stringify({ aircraft }) });
    return states[states.length - 1].collection.features.map((f) => [
      f.properties.id,
      f.properties.hex,
    ]);
  };

  expect(
    send([
      { hex: 'df5341', lat: 51, lon: 12 },
      { hex: '2df10f', lat: 50, lon: 11 },
    ]),
  ).toEqual([
    ['df5341', 'df5341'],
    ['2df10f', '2df10f'],
  ]);
  expect(
    send([
      {
        hex: 'mn811cddc02e',
        ground_truth_hex: 'obj-00014',
        adsb_hex: 'df5341',
        lat: 51.01,
        lon: 12,
      },
      { hex: 'mn9d1f8293d5', adsb_hex: '2df10f', lat: 50.01, lon: 11, multinode: true },
    ]),
  ).toEqual([
    ['df5341', 'mn811cddc02e'],
    ['2df10f', 'mn9d1f8293d5'],
  ]);
  expect(
    send([
      { hex: 'mn811cddc02e', ground_truth_hex: 'fd801a', adsb_hex: 'df5341', lat: 51.02, lon: 12 },
    ]),
  ).toEqual([['df5341', 'mn811cddc02e']]);
  expect(
    send([{ hex: 'mn5c0ffee0001', predecessor_hex: 'mn811cddc02e', lat: 51.03, lon: 12 }]),
  ).toEqual([['df5341', 'mn5c0ffee0001']]);
  expect(states[states.length - 1].aircraft.get('df5341')?.hex).toBe('mn5c0ffee0001');
  expect(states[states.length - 1].idFor?.('mn811cddc02e')).toBe('df5341');

  // The simulator's truth match moves to another aircraft, which turns up 30 km away, and then the
  // solve drops out for a frame: the solve's id never passes to that aircraft.
  const solve = { hex: 'mn6b9fecf3a5', adsb_hex: '4caad5', lat: 50.5, lon: 13 };
  expect(send([{ ...solve, ground_truth_hex: '4876ba' }])).toEqual([['4caad5', 'mn6b9fecf3a5']]);
  const other = { hex: '4876ba', lat: 50.77, lon: 13 };
  expect(send([{ ...solve, ground_truth_hex: 'd9b78b' }, other])).toEqual([
    ['4caad5', 'mn6b9fecf3a5'],
    ['4876ba', '4876ba'],
  ]);
  expect(send([other])).toEqual([['4876ba', '4876ba']]);
  feed.stop();
});

test('keeps recent positions for the tracked aircraft only, through a rename, afresh for another', () => {
  jest.useFakeTimers();
  const states: LiveFeedState[] = [];
  const feed = createLiveFeed({
    apiBaseUrl: 'https://api.example.com',
    onUpdate: (state) => states.push(state),
    WebSocketImpl: FakeSocket as unknown as typeof WebSocket,
    fetchFrame: () => new Promise(() => {}),
    isOffline: () => false,
  });
  feed.setBox([50, 10, 52, 14]);
  feed.start();
  const socket = FakeSocket.made[FakeSocket.made.length - 1];
  socket.onopen?.();
  const trail = () => states[states.length - 1].trail;
  const send = (aircraft: object[]) => {
    socket.onmessage?.({ data: JSON.stringify({ aircraft }) });
    return trail();
  };
  const other = (ts: number) => ({
    hex: '2df10f',
    lat: 50,
    lon: 11,
    recent_positions: [[49.9, 11, 9000, ts]],
  });

  // Asked for by its solve hex, shown under its transponder's.
  feed.setTracked('mn811cddc02e');
  const solve = {
    hex: 'mn811cddc02e',
    adsb_hex: 'df5341',
    lat: 51.01,
    lon: 12,
    recent_positions: [
      [51.01, 12, 3000, 101],
      [51, 12, 3000, 100],
    ],
  };
  expect(send([other(100), solve])).toEqual([
    [51, 12, 3000, 100],
    [51.01, 12, 3000, 101],
  ]);
  feed.setTracked(states[states.length - 1].idFor?.('mn811cddc02e') ?? null);
  const renamed = {
    hex: 'mn5c0ffee0001',
    predecessor_hex: 'mn811cddc02e',
    lat: 51.03,
    lon: 12,
    recent_positions: [
      [51.02, 12, 3100, 102],
      [51.03, 12, 3200, 103],
    ],
  };
  expect(send([other(102), renamed])).toEqual([
    [51, 12, 3000, 100],
    [51.01, 12, 3000, 101],
    [51.02, 12, 3100, 102],
    [51.03, 12, 3200, 103],
  ]);

  feed.setTracked('2df10f');
  expect(trail()).toEqual([]);
  expect(send([other(104), renamed])).toEqual([[49.9, 11, 9000, 104]]);
  feed.stop();
});

test('applies the newest waiting map focus request, once', () => {
  requestMapFocus({ hex: 'abc123', lat: 10, lon: 20, callsign: 'TST1' });
  requestMapFocus({ hex: 'def456', lat: 11, lon: 21, callsign: null });
  const newest = pendingMapFocus();
  expect(newest).toMatchObject({ hex: 'def456', lat: 11, lon: 21, callsign: null });

  // Finishing the replaced request leaves the newer one waiting.
  finishMapFocus((newest?.seq ?? 0) - 1);
  expect(pendingMapFocus()).toBe(newest);
  finishMapFocus(newest?.seq ?? 0);
  expect(pendingMapFocus()).toBeNull();
});

test('keeps the fresher of two entries for one aircraft, the solve on a tie, both when far apart', () => {
  const hexes = (aircraft: object[]) => {
    const shown = createAircraftIdentity().resolve(parseFrame({ aircraft })?.aircraft ?? [], 0);
    return [...shown.values()].map((a) => a.hex);
  };
  const adsb = { hex: '2df10f', lat: 51, lon: 12 };
  const solve = { hex: 'mn9d1f8293d5', adsb_hex: '2df10f', lat: 51.01, lon: 12.01 };

  expect(
    hexes([
      { ...adsb, seen: 0.5 },
      { ...solve, multinode: true, seen: 2 },
    ]),
  ).toEqual(['2df10f']);
  expect(
    hexes([
      { ...solve, multinode: true, seen: 1 },
      { ...adsb, seen: 1 },
    ]),
  ).toEqual(['mn9d1f8293d5']);
  // 4 km apart: two aircraft, whatever their keys say.
  expect(hexes([solve, { ...solve, hex: 'mn0c4fe2b7a1', lat: 51.046 }])).toEqual([
    'mn9d1f8293d5',
    'mn0c4fe2b7a1',
  ]);
});

test('picks the feature nearest the tap as drawn on screen', () => {
  const at = (lon: number, lat: number) => ({
    geometry: { type: 'Point', coordinates: [lon, lat] },
  });
  // This far north 0.9 degrees east is drawn closer than 0.6 degrees north.
  const east = at(0.9, 70);
  const north = at(0, 70.6);
  expect(nearestFeature([0, 70], [north, east])).toBe(east);
});

test('glides aircraft between frames, at most a frame past the feed, and puts a jump in place', () => {
  const glide = startGlide({ lat: 10, lon: 20, gs: 400, track: 90 }, 0);
  for (const now of [100, 200, 300, 400, 500]) stepGlide(glide, now, 0.1);
  expect(glide.lat).toBeCloseTo(10, 9);
  expect(glide.lon).toBeCloseTo(20.000376423, 9);

  // Seconds without a frame: reckoned one second of travel ahead and no further.
  for (let i = 0; i < 100; i += 1) stepGlide(glide, 5000, 0.1);
  expect(glide.lon).toBeCloseTo(20.00187704, 8);

  const turning = startGlide({ lat: 0, lon: 0, gs: 300, track: 359 }, 0);
  takeFix(turning, { lat: 0.001, lon: 0, gs: 300, track: 1 }, 1000);
  stepGlide(turning, 1000, 0.1);
  expect(turning.track).toBeCloseTo(359.3325, 4);

  const jumping = startGlide({ lat: 50, lon: 10 }, 0);
  // 1.4 km in a second glides; 5.7 km in a second is a glitch, drawn where the fix is.
  takeFix(jumping, { lat: 50, lon: 10.02 }, 1000);
  expect([jumping.lat, jumping.lon]).toEqual([50, 10]);
  takeFix(jumping, { lat: 50.05, lon: 10.02 }, 2000);
  expect([jumping.lat, jumping.lon]).toEqual([50.05, 10.02]);
});

test('steps aircraft less often as there are more or a step costs more, never with reduce motion', () => {
  const plan = (count: number, cost = 0, previous?: MotionPlan) =>
    motionPlan(count, cost, false, previous);
  const still = { smooth: false, intervalMs: 1000 };
  expect([100, 1000].map((n) => plan(n).intervalMs)).toEqual([33, 250]);
  expect(plan(1501)).toEqual(still);

  // Over a quarter of the interval steps down; back up only under a tenth of the faster one.
  const slowed = plan(100, 9);
  expect(slowed).toEqual({ smooth: true, intervalMs: 50 });
  expect(plan(100, 5, slowed)).toEqual(slowed);
  expect(plan(100, 3, slowed)).toEqual({ smooth: true, intervalMs: 33 });
  expect(plan(1000, 70)).toEqual(still);
  expect(plan(1000, 30, still)).toEqual(still);
  expect(plan(1000, 20, still)).toEqual({ smooth: true, intervalMs: 250 });

  expect(motionPlan(10, 0, true)).toEqual(still);
});

type Basemap = typeof import('../basemap');

// A new app run: the module's memory is gone, the keychain is not.
function startApp(): Basemap {
  let basemap: Basemap | undefined;
  jest.isolateModules(() => {
    basemap = jest.requireActual<Basemap>('../basemap');
  });
  return basemap!;
}

test('keeps the basemap picked across restarts until cleared, and reads an unknown one as none', async () => {
  await startApp().saveBasemapChoice('osm');
  await expect(startApp().loadBasemapChoice()).resolves.toBe('osm');

  await startApp().saveBasemapChoice(null);
  expect(mockKeychain.has('retina.map.basemap')).toBe(false);
  await expect(startApp().loadBasemapChoice()).resolves.toBeNull();

  mockKeychain.set('retina.map.basemap', 'satellite');
  await expect(startApp().loadBasemapChoice()).resolves.toBeNull();
});

test('puts the CARTO key on CARTO tiles only', () => {
  const tilesOf = (style: ReturnType<typeof basemapStyle>) =>
    (style.sources.basemap as { tiles: string[] }).tiles;

  expect(tilesOf(basemapStyle('voyager', ' k&y ', 'light'))).toEqual([
    'https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png?key=k%26y',
    'https://b.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png?key=k%26y',
    'https://c.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png?key=k%26y',
    'https://d.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png?key=k%26y',
  ]);
  expect(tilesOf(basemapStyle('osm', 'k&y', 'dark'))).toEqual([
    'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  ]);
  expect(tilesOf(basemapStyle('dark', '  ', 'dark'))).toEqual([
    'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
    'https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
    'https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
    'https://d.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
  ]);
});
