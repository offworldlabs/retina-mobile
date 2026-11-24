/// <reference types="jest" />
import { apiBaseUrl, resolveApiBaseUrl } from '../../config/env';
import { createApiClient, setAuthTokenProvider, setSessionEndedHandler } from '../client';
import { HttpError, UnauthorizedError } from '../errors';
import { fetchLeaderboard } from '../leaderboard';

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

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function stubbedClient(
  respond: (request: Request) => Response | Promise<Response>,
  baseUrl = 'http://api.test',
) {
  const requests: Request[] = [];
  const fetch = async (request: Request) => {
    requests.push(request);
    return respond(request);
  };
  return { requests, client: createApiClient({ baseUrl, fetch, isOffline: () => false }) };
}

test('maps FastAPI error bodies and Retry-After to typed errors', async () => {
  const limited = stubbedClient(() =>
    json({ detail: { reason: 'rate_limited', message: 'Slow down' } }, 429, { 'Retry-After': '3' }),
  );
  const error = await limited.client.get('/api/radar/leaderboard').catch((e: unknown) => e);
  expect(error).toBeInstanceOf(HttpError);
  expect(error).toMatchObject({
    status: 429,
    reason: 'rate_limited',
    message: 'Slow down',
    retryAfterMs: 3000,
  });

  const denied = stubbedClient(() => json({ detail: 'Not authenticated' }, 401));
  await expect(denied.client.get('/api/auth/me')).rejects.toBeInstanceOf(UnauthorizedError);
});

test('picks the platform base URL from app config and requests under it', async () => {
  const extra = {
    appEnv: 'development',
    apiBaseUrl: { ios: 'http://localhost:18422/', android: 'http://10.0.2.2:18422' },
  };
  expect(resolveApiBaseUrl(extra, 'android')).toBe('http://10.0.2.2:18422');
  expect(resolveApiBaseUrl(extra, 'ios')).toBe('http://localhost:18422');
  expect(() => resolveApiBaseUrl({ apiBaseUrl: {} }, 'android')).toThrow(
    'extra.apiBaseUrl.android',
  );

  const { client, requests } = stubbedClient(
    () => json({ leaderboard: [], total: 0 }),
    resolveApiBaseUrl(extra, 'android'),
  );
  await expect(fetchLeaderboard(undefined, client)).resolves.toEqual({ leaderboard: [], total: 0 });
  expect(requests.map((request) => request.url)).toEqual([
    'http://10.0.2.2:18422/api/radar/leaderboard',
  ]);
});

test('sends the bearer token to the API host only, and none without a provider', async () => {
  const respond = () => json({ leaderboard: [], total: 0 });
  const { client, requests } = stubbedClient(respond, apiBaseUrl);
  const elsewhere = stubbedClient(respond, 'https://elsewhere.example');

  setAuthTokenProvider(() => 'tok');
  await client.get('/api/radar/leaderboard');
  await client.get('/api/radar/leaderboard', { baseUrl: 'https://override.example' });
  await client.get('/api/radar/leaderboard', {
    middleware: [
      {
        onRequest: ({ request }) =>
          new Request('https://elsewhere.example/api/radar/leaderboard', request),
      },
    ],
  });
  await elsewhere.client.get('/api/radar/leaderboard');
  setAuthTokenProvider(null);
  await client.get('/api/radar/leaderboard');

  const sent = [...requests, ...elsewhere.requests].map(
    (request) => `${request.url} ${request.headers.get('Authorization')}`,
  );
  expect(sent).toEqual([
    `${apiBaseUrl}/api/radar/leaderboard Bearer tok`,
    'https://override.example/api/radar/leaderboard null',
    'https://elsewhere.example/api/radar/leaderboard null',
    `${apiBaseUrl}/api/radar/leaderboard null`,
    'https://elsewhere.example/api/radar/leaderboard null',
  ]);
});

test('ends the session on a 401 once, and only for the token still in use', async () => {
  let token = 'old-token';
  let reached = () => {};
  let release = () => {};
  const sent = new Promise<void>((resolve) => (reached = resolve));
  const held = new Promise<void>((resolve) => (release = resolve));
  const { client, requests } = stubbedClient(async (request) => {
    if (request.url.endsWith('/nodes')) {
      reached();
      await held;
    }
    return json({ detail: 'Not authenticated' }, 401);
  }, apiBaseUrl);
  const ended: string[] = [];
  setAuthTokenProvider(() => token);
  setSessionEndedHandler((endedToken) => ended.push(endedToken));

  const late = client.get('/api/auth/me/nodes').catch((e: unknown) => e);
  await sent;
  token = 'new-token';
  const ownHeader = client.get('/api/auth/me', { headers: { Authorization: 'Bearer new-token' } });
  await expect(ownHeader).rejects.toBeInstanceOf(UnauthorizedError);
  expect(ended).toEqual([]);

  const both = [client.get('/api/auth/me'), client.get('/api/auth/me/sessions')];
  for (const error of await Promise.all(both.map((call) => call.catch((e: unknown) => e)))) {
    expect(error).toBeInstanceOf(UnauthorizedError);
  }
  release();
  expect(await late).toBeInstanceOf(UnauthorizedError);
  expect(requests[0].headers.get('Authorization')).toBe('Bearer old-token');
  expect(ended).toEqual(['new-token']);

  setAuthTokenProvider(null);
  setSessionEndedHandler(null);
});
