import {
  HttpError,
  userMessage,
  type AccountSession,
  type ApiAccess,
  type ApiAccessLimits,
  type ApiKey,
} from '@/api';

// What the account screens show, worded as the web console's account and API access pages
// word it (dashboard/src/pages/user), with "browser" said as "device".

const DASH = '—';

const DAY: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'short', day: 'numeric' };
// Fields rather than dateStyle and timeStyle, which not every engine on a phone reads.
const MOMENT: Intl.DateTimeFormatOptions = { ...DAY, hour: 'numeric', minute: '2-digit' };

/**
 * When `at` was, given as epoch seconds or ISO 8601: a day or a day and time in the reader's
 * own calendar and clock, or how long ago. A dash for a stamp that is not one.
 */
function whenOf(at: number | string, style: 'day' | 'moment' | 'ago'): string {
  const ms = typeof at === 'number' ? at * 1000 : Date.parse(at);
  if (!Number.isFinite(ms)) return DASH;
  if (style !== 'ago')
    return new Date(ms).toLocaleString(undefined, style === 'day' ? DAY : MOMENT);
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** One signed-in device as its row shows it. */
export interface SessionRow {
  id: string;
  /** The server's label for the client, or "Unknown device". */
  device: string;
  /** The device asking, marked "This device". */
  current: boolean;
  /** The network it was in, a /24 or a /48; null when unknown. */
  network: string | null;
  lastActive: string;
  signedIn: string;
  /** False for this device: ending it is signing out, which the account screen does. */
  canSignOut: boolean;
}

/** The account's sessions as rows: this device first, then the rest as the server orders them. */
export function sessionRowsOf(sessions: readonly AccountSession[]): SessionRow[] {
  return [...sessions.filter((row) => row.current), ...sessions.filter((row) => !row.current)].map(
    (row) => ({
      id: row.id,
      device: row.user_agent?.trim() || 'Unknown device',
      current: row.current,
      network: row.ip || null,
      lastActive: whenOf(row.last_used_at, 'ago'),
      signedIn: whenOf(row.created_at, 'day'),
      canSignOut: !row.current,
    }),
  );
}

/** What to say once every other session was signed out, `revoked` of them. */
export function revokedOthersMessage(revoked: number): string {
  if (!(revoked > 0)) return 'No other device was signed in.';
  return revoked === 1 ? 'Signed out 1 other session.' : `Signed out ${revoked} other sessions.`;
}

/** What to say once the account is deleted, `released` of its nodes with it. */
export function releasedNodesMessage(released: number): string {
  if (!(Number.isInteger(released) && released > 0)) return 'Every session has ended.';
  return released === 1
    ? 'Your node was released and every session has ended.'
    : `Your ${released} nodes were released and every session has ended.`;
}

/** A revoked key never works again; a live one is refused while the account has no access. */
export type KeyStatus = 'Active' | 'Revoked' | 'Paused';

/** One key as its row shows it. */
export interface KeyRow {
  id: string;
  name: string;
  /** What tells the key apart, never the secret: "rtk_<prefix>_…". */
  masked: string;
  created: string;
  /** How long ago it was last used, or "Never". */
  lastUsed: string;
  status: KeyStatus;
  canRevoke: boolean;
}

/** The account's keys as rows, `entitled` being whether its access is active now. */
export function keyRowsOf(keys: readonly ApiKey[], entitled: boolean): KeyRow[] {
  return keys.map((key) => ({
    id: key.id,
    name: key.name,
    masked: `rtk_${key.prefix}_…`,
    created: whenOf(key.created_at, 'day'),
    lastUsed: key.last_used_at ? whenOf(key.last_used_at, 'ago') : 'Never',
    status: key.revoked_at ? 'Revoked' : entitled ? 'Active' : 'Paused',
    canRevoke: !key.revoked_at,
  }));
}

/** Where the account stands on the data API: badges, then a line of text each. */
export interface AccessView {
  badges: { label: string; tone: 'ok' | 'off' | 'info' }[];
  lines: string[];
  /** False without access, and for an administrator, who has no keys. */
  canCreateKeys: boolean;
}

const NO_ACCESS: Record<NonNullable<ApiAccess['reason']>, string> = {
  lapsed: 'Your API access has lapsed.',
  grant_ended: 'The access granted to you has ended.',
  not_entitled: 'You have no access yet.',
};

/** Seconds as days, or hours or minutes where they do not make whole days. */
function spanOf(seconds: number): string {
  const [n, unit] =
    seconds % 86400 === 0
      ? [seconds / 86400, 'day']
      : seconds % 3600 === 0
        ? [seconds / 3600, 'hour']
        : [Math.round(seconds / 60), 'minute'];
  return `${n} ${unit}${n === 1 ? '' : 's'}`;
}

function limitsLineOf(limits: ApiAccessLimits): string | null {
  const { requests_per_minute: rpm, max_concurrent_streams: streams } = limits;
  const span = limits.max_history_span_s;
  const parts = [
    rpm !== null && `${rpm} requests a minute`,
    streams !== null && `${streams} open streams`,
    span !== null && `history spans up to ${spanOf(span)}`,
  ].filter(Boolean);
  return parts.length ? `Limits: ${parts.join(', ')}.` : null;
}

/** The account's API access as its card shows it. */
export function accessViewOf(access: ApiAccess): AccessView {
  const { contributor } = access;
  if (access.kind === 'admin') {
    return {
      badges: [{ label: 'Full access', tone: 'ok' }],
      lines: [
        'You are signed in as an administrator, so the data API is open to you without a key. ' +
          'Keys belong to accounts: to create one, sign in with an account.',
      ],
      canCreateKeys: false,
    };
  }
  if (!access.entitled) {
    const lines = [NO_ACCESS[access.reason ?? 'not_entitled']];
    if (contributor) {
      lines.push(
        `To qualify, a node you own needs to report data on at least ${contributor.threshold_days} ` +
          `of the last ${contributor.window_days} days. Your best node: ` +
          `${contributor.active_days} of ${contributor.window_days} days.`,
      );
    }
    return { badges: [{ label: 'Not active', tone: 'off' }], lines, canCreateKeys: false };
  }
  const lines: string[] = [];
  if (access.kind === 'customer') {
    lines.push(
      access.grant_ends_at
        ? `Granted by an administrator, until ${whenOf(access.grant_ends_at, 'moment')}.`
        : 'Granted by an administrator, with no end date.',
    );
  } else if (contributor) {
    let line = `A node you own reported data on ${contributor.active_days} of the last ${contributor.window_days} days.`;
    if (contributor.grace_ends_at) {
      line +=
        ` That is below ${contributor.threshold_days} days: access continues until ` +
        `${whenOf(contributor.grace_ends_at, 'moment')}, then pauses.`;
    }
    lines.push(line);
  }
  const limits = access.limits && limitsLineOf(access.limits);
  if (limits) lines.push(limits);
  return {
    badges: [
      { label: 'Active', tone: 'ok' },
      { label: access.kind === 'customer' ? 'Customer' : 'Contributor', tone: 'info' },
    ],
    lines,
    canCreateKeys: true,
  };
}

/**
 * One sentence for a failed account request: the server's own sentence for a refusal (a 4xx
 * other than 401 whose detail is a string), else the app's wording for the failure. Never the
 * request's data: a validation error's list of faults echoes what was sent, so it is not shown.
 */
export function errorTextOf(error: unknown): string {
  if (
    error instanceof HttpError &&
    error.status >= 400 &&
    error.status < 500 &&
    error.status !== 401
  ) {
    const detail = (error.body as { detail?: unknown } | null)?.detail;
    if (typeof detail === 'string' && detail.trim() !== '') return detail;
  }
  return userMessage(error);
}

/** The longest name the server keeps for a key, in characters. */
export const KEY_NAME_MAX = 100;

/**
 * Why the server would refuse `name` for a key, or null when it would keep it. It keeps the
 * name trimmed, 1 to KEY_NAME_MAX characters, so send it trimmed.
 */
export function keyNameError(name: string): string | null {
  const length = [...name.trim()].length;
  return length >= 1 && length <= KEY_NAME_MAX
    ? null
    : `Use a name of 1 to ${KEY_NAME_MAX} characters.`;
}
