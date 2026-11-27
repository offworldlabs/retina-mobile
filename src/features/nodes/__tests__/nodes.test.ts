/// <reference types="jest" />
import { act, createElement } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { createRoot } from 'test-renderer';

import type { OwnerNode, OwnerNodeAnalytics } from '@/api';
import { consumeClaim, declineClaim, previewClaim, resendClaimLink } from '@/api/claims';
import { HttpError } from '@/api/errors';

import { decimate, niceTicks, timeTicks } from '../charts/scale';
import { bearingSegments } from '../charts/performance';
import { claimOutcome } from '../claim';
import { Figures } from '../detail/Figures';
import { Heading } from '../detail/Heading';
import { claimRow, nodeStatus, resendOutcome } from '../model';
import { OpenClaims } from '../OpenClaims';
import { eventView } from '../records/values';

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

// Whether the screen is focused, as the router would say.
const mockScreen = { focused: true };
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  useIsFocused: () => mockScreen.focused,
}));

/** Every text on screen, in order. */
function texts(root: ReturnType<typeof createRoot>): string[] {
  const out: string[] = [];
  const walk = (node: unknown) => {
    if (typeof node === 'string') out.push(node);
    else for (const child of (node as { children: unknown[] }).children) walk(child);
  };
  walk(root.container);
  return out;
}

/** Answers every request the app's client sends with `respond`, noting each one. */
function stubFetch(respond: (request: Request) => { status: number; body: unknown }) {
  const seen: Request[] = [];
  const spy = jest.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const request = input as Request;
    seen.push(request);
    const { status, body } = respond(request);
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  return { seen, restore: () => spy.mockRestore() };
}

describe('node readings', () => {
  test('reads a status as the web does: only an absent node is offline', () => {
    expect(nodeStatus('active')).toEqual({ label: 'Online', tone: 'online' });
    expect(nodeStatus('disconnected')).toEqual({ label: 'Offline', tone: 'offline' });
    expect(nodeStatus('never_connected')).toEqual({ label: 'Never connected', tone: 'never' });
    expect(nodeStatus('degraded')).toEqual({ label: 'Online', tone: 'online' });
  });
});

describe('open claims', () => {
  // Wall-clock times on the test machine's own zone, so the shown time is the same anywhere.
  const now = new Date(2026, 10, 27, 9, 0).getTime();
  const at = (hours: number, minutes: number) =>
    new Date(2026, 10, 27, hours, minutes).getTime() / 1000;
  const claim = { node_ref: 'ndeabc123def456', email: 'owner@example.com' };

  test('describes a claim by its link: live until a time, expired, or none out', () => {
    expect(claimRow({ ...claim, pending: true, expires_at: at(9, 45) }, now)).toEqual({
      nodeRef: 'ndeabc123def456',
      givenTo: 'Given owner@example.com',
      linkText: 'Link is live until 09:45 AM',
      live: true,
    });
    expect(claimRow({ ...claim, pending: true, expires_at: at(8, 45) }, now)).toEqual({
      nodeRef: 'ndeabc123def456',
      givenTo: 'Given owner@example.com',
      linkText: 'Link has expired',
      live: false,
    });
    expect(claimRow({ ...claim, pending: false, expires_at: null }, now)).toEqual({
      nodeRef: 'ndeabc123def456',
      givenTo: 'Given owner@example.com',
      linkText: 'Link has expired',
      live: false,
    });
  });

  test('says what a resend did, and reads the claims again after a send or a 404', () => {
    expect(resendOutcome('ndeabc123def456', null)).toEqual({
      text: 'Sent. The link lasts fifteen minutes.',
      refresh: true,
    });
    expect(
      resendOutcome('ndeabc123def456', new HttpError(404, { detail: 'Claim not found' })),
    ).toEqual({ text: 'Node ndeabc123def456 is no longer waiting for you.', refresh: true });
    expect(resendOutcome('ndeabc123def456', new HttpError(429, null, 3_600_000))).toEqual({
      text: 'Too many links have been asked for. Try again later.',
      refresh: false,
    });
  });

  test('says a sent link in its own row, and only a claim that is gone under the list', async () => {
    const later = Math.floor(Date.now() / 1000) + 600;
    const claims = ['ndeaaaaaaaaaaaa', 'ndebbbbbbbbbbbb'].map((ref) => ({
      ...claim,
      node_ref: ref,
      pending: true,
      expires_at: later,
    }));
    const server = stubFetch((request) =>
      request.url.includes('ndeaaaaaaaaaaaa')
        ? { status: 200, body: {} }
        : { status: 404, body: { detail: 'Claim not found' } },
    );
    const root = createRoot();
    const show = (list: typeof claims) =>
      act(async () => root.render(createElement(OpenClaims, { claims: list, onSent: () => {} })));
    await show(claims);
    for (const button of root.container.queryAll(
      (node) => node.props.accessibilityLabel === 'Send the link again',
    )) {
      await act(async () => button.props.onClick({ nativeEvent: {} }));
    }
    server.restore();
    const shown = texts(root);
    expect(shown.indexOf('Sent. The link lasts fifteen minutes.')).toBeGreaterThan(-1);
    expect(shown.indexOf('Sent. The link lasts fifteen minutes.')).toBeLessThan(
      shown.indexOf('ndebbbbbbbbbbbb'),
    );

    // Both claims leave the list on its next read: the sent one with its note.
    await show([]);
    expect(texts(root)).toEqual([
      'Waiting for you',
      'Nodes that were given your address and are not on your account yet.',
      'Node ndebbbbbbbbbbbb is no longer waiting for you.',
    ]);
  });
});

describe('node history', () => {
  test('names a known history entry and its actor, and an unknown kind by its own words', () => {
    expect(
      eventView({ kind: 'graduated', actor: 'admin', at: '2026-03-04T05:06:07Z', epoch: 2 }),
    ).toEqual({
      label: 'Graduated from probation',
      actor: 'by an administrator',
      tone: 'success',
      at: '2026-03-04T05:06:07Z',
    });
    expect(
      eventView({
        kind: 'moved_to_new_site',
        actor: 'system',
        at: '2026-03-05T00:00:00Z',
        epoch: 2,
      }),
    ).toEqual({
      label: 'Moved to new site',
      actor: 'automatically',
      tone: 'neutral',
      at: '2026-03-05T00:00:00Z',
    });
  });
});

describe('chart scales', () => {
  const HOUR_MS = 3_600_000;

  test('puts value ticks on 1, 2 or 5 steps and widens the domain to them', () => {
    expect(niceTicks(3.2, 17.8, 4)).toEqual({
      min: 0,
      max: 20,
      step: 5,
      ticks: [0, 5, 10, 15, 20],
    });
    expect(niceTicks(0.12, 0.87, 5).ticks).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
  });

  test('opens a domain without span around its value', () => {
    expect(niceTicks(12.3, 12.3, 4).ticks).toEqual([0, 5, 10, 15, 20, 25]);
    expect(niceTicks(0, 0, 4).ticks).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
  });

  test('ticks a 24-hour window on round local hours with the date where a day starts', () => {
    const start = new Date(2026, 10, 27, 8, 20).getTime();
    const ticks = timeTicks(start, start + 24 * HOUR_MS, 6);
    expect(ticks.map((tick) => [tick.label, tick.day])).toEqual([
      ['12:00', '27 Nov'],
      ['18:00', null],
      ['00:00', '28 Nov'],
      ['06:00', null],
    ]);
    expect(ticks[0].t).toBe(new Date(2026, 10, 27, 12, 0).getTime());
  });

  test('thins a long series under the cap, keeping its peak, its dip and its order', () => {
    const items = Array.from({ length: 1000 }, (_, i) => ({ i, v: i % 10 }));
    items[123].v = -50;
    items[537].v = 99;
    const kept = decimate(items, 100, [(item) => item.v]).map((item) => item.i);
    expect(kept.length).toBeLessThanOrEqual(100);
    expect(kept).toEqual(expect.arrayContaining([0, 123, 537, 999]));
    expect(kept).toEqual([...kept].sort((a, b) => a - b));
    expect(decimate(items.slice(0, 50), 100, [(item) => item.v])).toHaveLength(50);
  });

  test('keeps a thinned line broken wherever the series had a gap', () => {
    // A sparse node: a reading in every other bucket, a gap in each one between.
    const items = Array.from({ length: 1000 }, (_, i) => ({ v: i % 2 ? null : (i * 37) % 11 }));
    const kept = decimate(items, 100, [(item) => item.v]);
    expect(kept.length).toBeLessThanOrEqual(100);
    expect(kept.some((item, k) => k > 0 && item.v !== null && kept[k - 1].v !== null)).toBe(false);
  });
});

describe('bearing chart', () => {
  test('breaks the bearing line at unmeasured bins and joins 355° to 0° only when both are measured', () => {
    const bins: (number | null)[] = Array(72).fill(null);
    [bins[0], bins[1], bins[2], bins[10], bins[70], bins[71]] = [0.5, 0.6, 0, 0.4, 0.3, 0.2];

    expect(bearingSegments(bins)).toEqual([[0, 1, 2], [10], [70, 71, 0]]);

    bins[71] = null;
    expect(bearingSegments(bins)).toEqual([[0, 1, 2], [10], [70]]);
  });
});

describe('claim links', () => {
  test('a confirmed claim is yours only when the link was for the account signed in', () => {
    expect(claimOutcome('Owner@Example.com', 'owner@example.com')).toBe('yours');
    expect(claimOutcome('owner@example.com', 'other@example.com')).toBe('elsewhere');
    expect(claimOutcome(null, 'owner@example.com')).toBe('elsewhere');
  });

  test('every claim call goes out through the app client without cookies', async () => {
    const server = stubFetch((request) => ({
      status: 200,
      body: request.url.endsWith('/consume')
        ? { node_ref: 'ndeabc123def456', user: { id: 'u1', email: 'owner@example.com' } }
        : { node_ref: 'ndeabc123def456' },
    }));
    await previewClaim('tok');
    await consumeClaim('tok');
    await declineClaim('tok');
    await resendClaimLink('tok');
    server.restore();
    expect(
      server.seen.map((r) => [`${r.method} ${new URL(r.url).pathname}`, r.credentials]),
    ).toEqual([
      ['GET /api/auth/claim/tok', 'omit'],
      ['POST /api/auth/claim/consume', 'omit'],
      ['POST /api/auth/claim/decline', 'omit'],
      ['POST /api/auth/claim/resend', 'omit'],
    ]);
  });
});

describe('node page', () => {
  test('rounds trust and reputation as the web does, and keeps availability rounded down', async () => {
    const analytics: OwnerNodeAnalytics = {
      node_id: 'n1',
      node_ref: 'ndeabc123def456',
      trust: { trust_score: 0.9996 },
      reputation: { reputation: 0.12345 },
      metrics: { availability_7d: 0.9996 },
      detection_area: {},
      coverage_map: null,
      empirical_coverage: null,
      node_bias: null,
      performance: null,
    };
    const root = createRoot();
    await act(async () => root.render(createElement(Figures, { analytics })));
    const shown = texts(root);
    const row = (label: string) => shown[shown.indexOf(label) + 1];
    expect([row('Trust Score'), row('Reputation'), row('Availability (7 d)')]).toEqual([
      '100.0%',
      '12.3%',
      '99.9%',
    ]);
  });

  test('moves "last heard" on only while focused and in the foreground, and catches up on return', async () => {
    jest.useFakeTimers({ now: Date.parse('2026-11-27T12:00:00Z') });
    const listeners = new Set<(state: AppStateStatus) => void>();
    const appState = (state: AppStateStatus) => {
      Object.defineProperty(AppState, 'currentState', { value: state, configurable: true });
      listeners.forEach((listener) => listener(state));
    };
    const subscribe = jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation((_type, listener) => {
        listeners.add(listener);
        return { remove: () => listeners.delete(listener) };
      });
    appState('active');
    const node = { status: 'disconnected', last_heartbeat: '2026-11-27T11:55:00Z' } as OwnerNode;
    const root = createRoot();
    const show = () =>
      act(async () => root.render(createElement(Heading, { title: 'Roof', node })));
    const wait = (ms: number) => act(async () => jest.advanceTimersByTime(ms));
    const heard = () => texts(root).find((text) => text.startsWith('Last heard'));

    await show();
    expect(heard()).toBe('Last heard 5m ago');
    await wait(60_000);
    expect(heard()).toBe('Last heard 6m ago');

    await act(async () => appState('background'));
    await wait(600_000);
    expect(heard()).toBe('Last heard 6m ago');
    await act(async () => appState('active'));
    expect(heard()).toBe('Last heard 16m ago');

    mockScreen.focused = false;
    await show();
    await wait(600_000);
    expect(heard()).toBe('Last heard 16m ago');
    mockScreen.focused = true;
    await show();
    expect(heard()).toBe('Last heard 26m ago');

    await act(async () => root.unmount());
    expect(listeners.size).toBe(0);
    subscribe.mockRestore();
    jest.useRealTimers();
  });
});
