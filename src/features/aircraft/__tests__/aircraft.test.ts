/// <reference types="jest" />
import {
  createApiClient,
  fetchNetworkAircraft,
  fetchViewAircraft,
  type SearchAircraft,
} from '@/api';

import { refusalOf, searchAccessOf } from '../access';
import {
  activeFilterCount,
  NO_FILTERS,
  searchResultsOf,
  WHOLE_NETWORK,
  type AircraftFilters,
  type AircraftTypeFilter,
} from '../search';
import { joinTrack, mergeTrail, simplifyTrack, trackLine, type TrackPoint } from '../track';

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

jest.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 0,
  getItemAsync: async () => null,
  setItemAsync: async () => undefined,
  deleteItemAsync: async () => undefined,
}));

function stubbedClient(respond: () => Response) {
  const urls: string[] = [];
  const fetch = async (request: Request) => {
    urls.push(request.url);
    return respond();
  };
  return {
    urls,
    client: createApiClient({ baseUrl: 'http://api.test', fetch, isOffline: () => false }),
  };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });

test('asks the view frame for the map box and the data API for the whole network', async () => {
  const { client, urls } = stubbedClient(() => json({ aircraft: [] }));
  await fetchViewAircraft([10.25, 20.125, 10.75, 20.5], undefined, client);
  await fetchNetworkAircraft(WHOLE_NETWORK, undefined, client);
  expect(new URL(urls[0]).searchParams.get('bbox')).toBe('10.25,20.125,10.75,20.5');
  expect(urls[1]).toBe('http://api.test/api/v1/aircraft');
});

test('with API access, matches any part of a callsign or hex across the view and the network, with or without a type filter', async () => {
  const drone = { hex: 'pr1a2b', lat: 10.53, lon: 20.28, alt_baro: 400, gs: 30 };
  const inView = { ...drone, position_source: 'solver_single_node', target_class: 'drone' };
  const view = stubbedClient(() => json({ aircraft: [inView] }));
  // The data API's rows: no type, and a callsign for ADS-B rows only.
  const network = stubbedClient(() =>
    json({
      aircraft: [
        {
          ...drone,
          hex: 'a1b2c3',
          flight: 'TST1234',
          alt_baro: 30000,
          position_source: 'adsb_single_node',
        },
        {
          ...drone,
          hex: 'c0ffee',
          flight: 'XYZ9',
          alt_baro: 20000,
          position_source: 'adsb_multi_node',
        },
        { ...drone, position_source: 'solver_single_node' },
      ],
    }),
  );
  const frame = await fetchViewAircraft([10.25, 20.125, 10.75, 20.5], undefined, view.client);
  const rows = await fetchNetworkAircraft({}, undefined, network.client);
  const hexes = (text: string, type: AircraftTypeFilter = 'all') =>
    searchResultsOf(
      frame.aircraft.map((row) => [row.hex, row] as const),
      text,
      { ...NO_FILTERS, type },
      { aircraft: rows, idFor: (hex) => hex },
    ).map((result) => result.hex);

  expect(hexes('ST12')).toEqual(['a1b2c3']);
  expect(hexes('a1b2')).toEqual(['a1b2c3']);
  expect(hexes('ffee')).toEqual(['c0ffee']);
  expect(hexes('')).toEqual(['a1b2c3', 'c0ffee', 'pr1a2b']);
  expect(hexes('', 'drone')).toEqual(['pr1a2b']);
});

test('filters to radar-detected aircraft by flight level, speed, type and anomaly, and matches text', () => {
  const rows: SearchAircraft[] = [
    { hex: 'a00001', lat: 10.5, lon: 20.25, flight: 'TST1', alt_baro: 30000, gs: 400 },
    {
      hex: 'a00002',
      lat: 10.51,
      lon: 20.26,
      flight: 'TST22  ',
      alt_baro: 12000,
      gs: 250,
      track: 90,
      position_source: 'solver_single_node',
    },
    {
      hex: 'mn0a1b2c3d4e',
      lat: 10.52,
      lon: 20.27,
      alt_baro: 36000,
      gs: 480,
      multinode: true,
      n_nodes: 3,
      is_anomalous: true,
    },
    {
      hex: 'pr1a2b',
      lat: 10.53,
      lon: 20.28,
      alt_baro: 400,
      gs: 30,
      position_source: 'solver_single_node',
      target_class: 'drone',
    },
    { hex: 'a00003', lat: 10.54, lon: 20.29, alt_baro: 'ground', gs: 10, position_source: 'adsb' },
    { hex: 'a00004', lat: 10.55, lon: 20.3, alt_baro: 20000, position_source: 'multinode_solve' },
  ];
  const hexes = (text: string, filters: Partial<AircraftFilters>) =>
    searchResultsOf(
      rows.map((row) => [row.hex, row] as const),
      text,
      { ...NO_FILTERS, ...filters },
    ).map((result) => result.hex);

  expect(hexes('', {})).toEqual(['mn0a1b2c3d4e', 'a00004', 'a00002', 'pr1a2b', 'a00003']);
  expect(hexes('', { minFl: '100', maxFl: '300' })).toEqual(['a00004', 'a00002', 'a00003']);
  expect(hexes('', { minGs: '200' })).toEqual(['mn0a1b2c3d4e', 'a00002']);
  expect(hexes('', { type: 'drone' })).toEqual(['pr1a2b']);
  expect(hexes('', { type: 'aircraft' })).toEqual(['mn0a1b2c3d4e', 'a00004', 'a00002', 'a00003']);
  expect(hexes('', { type: 'multinode' })).toEqual(['mn0a1b2c3d4e', 'a00004']);
  expect(hexes('', { anomaliesOnly: true })).toEqual(['mn0a1b2c3d4e']);
  expect(hexes('tst2', {})).toEqual(['a00002']);
  expect(hexes(' A1B ', {})).toEqual(['mn0a1b2c3d4e']);
  expect(hexes('TST1', {})).toEqual([]);
  expect(activeFilterCount({ ...NO_FILTERS, minFl: '100', anomaliesOnly: true })).toBe(2);
  expect(searchResultsOf([['a00002', rows[1]]], '', NO_FILTERS)).toEqual([
    {
      id: 'a00002',
      hex: 'a00002',
      callsign: 'TST22',
      lat: 10.51,
      lon: 20.26,
      altitude: 12000,
      gs: 250,
      track: 90,
      multinode: false,
      nNodes: null,
      anomalous: false,
      drone: false,
    },
  ]);
});

test('tells what search covers from the session, the account access and refusals', async () => {
  const signedIn = { status: 'signed-in', email: 'pilot@example.com' } as const;
  const base = { auth: signedIn, access: undefined, accessFailed: false, refusal: null };
  const access = {
    entitled: false,
    kind: null,
    reason: 'not_entitled',
    limits: null,
    contributor: { active_days: 3, window_days: 30, threshold_days: 20, grace_ends_at: null },
    grant_ends_at: null,
  } as const;
  const limits = {
    tier: 'contributor',
    requests_per_minute: 60,
    max_concurrent_streams: 2,
    max_history_span_s: 86400,
  };

  expect(searchAccessOf({ ...base, auth: { status: 'signed-out' } })).toEqual({
    kind: 'signed-out',
  });
  expect(searchAccessOf({ ...base, auth: { status: 'loading' } })).toEqual({ kind: 'checking' });
  expect(searchAccessOf(base)).toEqual({ kind: 'checking' });
  expect(searchAccessOf({ ...base, accessFailed: true })).toEqual({
    kind: 'view-only',
    reasonLine: null,
    earnLine: null,
  });
  expect(
    searchAccessOf({
      ...base,
      access: { ...access, entitled: true, kind: 'contributor', reason: null, limits },
    }),
  ).toEqual({ kind: 'entitled', maxHistorySpanS: 86400 });
  const earnLine =
    'To qualify, a node you own needs to report data on at least 20 of the last 30 days. ' +
    'Your best node: 3 of 30 days.';
  expect(searchAccessOf({ ...base, access })).toEqual({
    kind: 'view-only',
    reasonLine: 'You have no access yet.',
    earnLine,
  });

  const lapsed = stubbedClient(() =>
    json({ detail: { reason: 'lapsed', message: 'API access has lapsed.' } }, 403),
  );
  const refused = await lapsed.client.get('/api/v1/aircraft').catch((e: unknown) => e);
  expect(refusalOf(refused)).toEqual({ kind: 'refused', reason: 'lapsed' });
  expect(
    searchAccessOf({ ...base, access: { ...access, entitled: true }, refusal: 'lapsed' }),
  ).toEqual({ kind: 'view-only', reasonLine: 'Your API access has lapsed.', earnLine });

  const limited = stubbedClient(() =>
    json({ detail: { reason: 'rate_limited', message: 'Slow down' } }, 429, {
      'Retry-After': '12',
    }),
  );
  const slowed = await limited.client.get('/api/v1/aircraft').catch((e: unknown) => e);
  expect(refusalOf(slowed)).toEqual({ kind: 'rate-limited', retryAfterMs: 12000 });
  const broken = stubbedClient(() => json({ detail: 'Server error' }, 500));
  expect(refusalOf(await broken.client.get('/api/v1/aircraft').catch((e: unknown) => e))).toBe(
    null,
  );
});

test('draws a merged, joined and simplified track as one capped line', () => {
  const held: TrackPoint[] = [
    [10.5, 20.25, 30000, 100],
    [10.501, 20.251, 30100, 110],
  ];
  expect(
    mergeTrail(held, [
      [10.503, 20.253, null, 130],
      [10.5, 20.25, 30000, 100],
      [10.502, 20.252, 30200, 120],
      [10.502000005, 20.252000005, 30200, 125],
      [10.504, 20.254, 30400, 125],
    ]),
  ).toEqual([...held, [10.502, 20.252, 30200, 120], [10.503, 20.253, null, 130]]);
  const full = Array.from({ length: 400 }, (_, i): TrackPoint => [10.5 + i / 1024, 20.25, null, i]);
  const capped = mergeTrail(full, [[11, 20.25, null, 1000]]);
  expect([capped.length, capped[0][3], capped[399][3]]).toEqual([400, 1, 1000]);

  const live: TrackPoint[] = [
    [10.5, 20.25, 30000, 100],
    [10.502, 20.252, 30200, 120],
  ];
  const history: TrackPoint[] = [
    [10.4, 20.1, null, 50],
    [10.45, 20.2, null, 90],
    [10.5, 20.25, null, 100],
    [10.51, 20.26, null, 105],
  ];
  expect(joinTrack(history, live)).toEqual([
    [10.4, 20.1, null, 50],
    [10.45, 20.2, null, 90],
    ...live,
  ]);

  // 10 000 fixes along a diagonal, all but every third off it by up to about 85 m.
  const noisy = Array.from({ length: 10000 }, (_, i): TrackPoint => {
    const jitter = i % 3 === 0 ? 0 : (((i * 7919) % 101) - 50) / 65536;
    return [10.5 + i / 2048 + jitter, 20.25 + i / 2048 - jitter, null, i];
  });
  const simplified = simplifyTrack(noisy);
  expect(simplified.length).toBeLessThan(10000);
  expect(simplified.length).toBeGreaterThan(1000);
  const [line] = trackLine(simplified).features;
  const drawn = line.geometry.coordinates;
  expect(drawn.length).toBeLessThanOrEqual(1000);
  expect(line.properties.points).toBe(drawn.length);
  expect([drawn[0], drawn[drawn.length - 1]]).toEqual([
    [20.25, 10.5],
    [25.13232421875, 15.38232421875],
  ]);

  expect(trackLine([[10.5, 20.25, null, 1]])).toEqual({ type: 'FeatureCollection', features: [] });
  expect(
    trackLine([
      [10.5, 179.75, null, 1],
      [10.625, -179.5, null, 2],
      [10.75, -179.25, null, 3],
    ]).features[0].geometry.coordinates,
  ).toEqual([
    [179.75, 10.5],
    [180.5, 10.625],
    [180.75, 10.75],
  ]);
});
