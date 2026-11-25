/// <reference types="jest" />
import { basemapStyle } from '../basemap';
import { feedBoxOf, parseFrame, toFeatureCollection } from '../feed';
import { createLiveFeed } from '../liveFeed';

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
  expect(toFeatureCollection(frame?.aircraft ?? [])).toEqual({
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [20.25, 10.5] },
        properties: { hex: 'abc123', track: 90, callsign: 'TST12', alt: 35000 },
      },
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [179.5, -5] },
        properties: { hex: 'def456', track: null, callsign: null, alt: 3281 },
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
