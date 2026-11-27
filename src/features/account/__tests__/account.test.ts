/// <reference types="jest" />
import {
  createApiClient,
  createMyKey,
  InvalidResponseError,
  type AccountSession,
  type ApiKey,
} from '@/api';
import { refreshedSessionOf } from '@/auth/AuthProvider';

import { accessViewOf, keyRowsOf, sessionRowsOf } from '../model';

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

test('lists this device first, names an unlabelled one, and offers sign-out for the others only', () => {
  const session = (id: string, user_agent: string | null, current: boolean): AccountSession => ({
    id,
    created_at: 1_764_000_000,
    last_used_at: 1_764_100_000,
    expires_at: 1_766_000_000,
    user_agent,
    ip: null,
    current,
  });
  const rows = sessionRowsOf([
    session('tablet', '  ', false),
    session('phone', 'Retina on Android', true),
    session('laptop', 'Firefox on Linux', false),
  ]);
  expect(
    rows.map(({ id, device, current, canSignOut }) => [id, device, current, canSignOut]),
  ).toEqual([
    ['phone', 'Retina on Android', true, false],
    ['tablet', 'Unknown device', false, true],
    ['laptop', 'Firefox on Linux', false, true],
  ]);
});

test('marks keys active, revoked or paused, and shows only their prefix', () => {
  const key = (id: string, revoked_at: string | null): ApiKey => ({
    id,
    name: id,
    prefix: '00000000',
    created_at: '2026-11-20T10:00:00Z',
    last_used_at: null,
    revoked_at,
  });
  const keys = [key('live', null), key('old', '2026-11-21T10:00:00Z')];
  const shown = (entitled: boolean) =>
    keyRowsOf(keys, entitled).map(({ status, masked, lastUsed, canRevoke }) => [
      status,
      masked,
      lastUsed,
      canRevoke,
    ]);
  expect(shown(true)).toEqual([
    ['Active', 'rtk_00000000_…', 'Never', true],
    ['Revoked', 'rtk_00000000_…', 'Never', false],
  ]);
  expect(shown(false)).toEqual([
    ['Paused', 'rtk_00000000_…', 'Never', true],
    ['Revoked', 'rtk_00000000_…', 'Never', false],
  ]);
});

test('says why there is no access and how far the best node is from qualifying', () => {
  const view = accessViewOf({
    entitled: false,
    kind: null,
    reason: 'lapsed',
    limits: null,
    contributor: { active_days: 12, window_days: 30, threshold_days: 20, grace_ends_at: null },
    grant_ends_at: null,
  });
  expect(view).toEqual({
    badges: [{ label: 'Not active', tone: 'off' }],
    lines: [
      'Your API access has lapsed.',
      'To qualify, a node you own needs to report data on at least 20 of the last 30 days. ' +
        'Your best node: 12 of 30 days.',
    ],
    canCreateKeys: false,
  });
});

test('keeps a new key out of errors', async () => {
  const fakeKey = 'rtk_00000000_madeUpTextNotAKeyOnlyForThisTestAbcdefghijkl';
  const row = {
    id: 'k1',
    name: 'Weather station',
    prefix: '00000000',
    created_at: '2026-11-26T10:00:00Z',
    last_used_at: null,
    revoked_at: null,
  };
  const answering = (body: string) =>
    createApiClient({
      baseUrl: 'http://api.test',
      fetch: async () =>
        new Response(body, { status: 201, headers: { 'Content-Type': 'application/json' } }),
      isOffline: () => false,
    });

  const missingId = JSON.stringify({ ...row, id: undefined, key: fakeKey });
  const cutOff = JSON.stringify({ key: fakeKey, ...row }).slice(0, -12);
  for (const body of [missingId, cutOff]) {
    const error = await createMyKey('Weather station', answering(body)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(InvalidResponseError);
    const { message, cause } = error as Error;
    expect(`${message} ${String(error)}`).not.toContain(fakeKey);
    // How much of the body a JSON parser's message quotes differs by engine, so none is kept.
    expect(cause).toBeUndefined();
  }

  await expect(
    createMyKey('Weather station', answering(JSON.stringify({ ...row, key: fakeKey }))),
  ).resolves.toEqual({ ...row, key: fakeKey });
});

test('takes the address the account has now, unless a deletion is ending the session', () => {
  const token = 'a'.repeat(43);
  const session = { token, email: 'old@example.com' };
  const read = { token, email: 'new@example.com' };
  expect(refreshedSessionOf(session, read, false)).toEqual({ token, email: 'new@example.com' });
  expect(refreshedSessionOf(session, read, true)).toBeNull();
});
