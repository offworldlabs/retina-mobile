// What the node page's records say, ported from the web's owner records
// (dashboard/src/components/nodeOwner/records in retina-server): the same
// labels, tables and rules, as plain data the cards only draw.
import type { ConfigVersion, NodeReport, OwnerEvent } from '@/api';

/** What a missing value reads as. */
export const DASH = '—';

/** How many versions the page asks for. A history that fills it may go further back. */
export const CONFIG_HISTORY_LIMIT = 50;

/** How many history entries the page asks for. */
export const EVENTS_LIMIT = 100;

/** Versions drawn before the rest wait behind a button. */
const SHOWN_FIRST = 5;

/** A status badge's tone, as the web's `.badge` classes name them. */
export type BadgeTone = 'online' | 'offline' | 'warning' | 'info' | 'private';

/** A history entry's dot. */
export type DotTone = 'accent' | 'success' | 'warning' | 'error' | 'neutral';

/** One reading as the card draws it: words, a badge, or a moment. */
export type RecordValue =
  | { kind: 'text'; text: string; mono?: boolean }
  | { kind: 'badge'; text: string; tone: BadgeTone }
  | { kind: 'time'; at: string | null };

export interface RecordRow {
  key: string;
  label: string;
  value: RecordValue;
}

const text = (value: string, mono = false): RecordValue => ({ kind: 'text', text: value, mono });
const time = (at: unknown): RecordValue => ({
  kind: 'time',
  at: typeof at === 'string' ? at : null,
});

// ── Formats (the web's utils/format.ts, as the records use them) ─────────────

function fmt(n: number | null | undefined, decimals: number): string {
  if (n === undefined || n === null || Number.isNaN(n)) return DASH;
  return Number(n).toFixed(decimals);
}

function formatPercent(n: number, decimals: number): string {
  const value = fmt(n, decimals);
  return value === DASH ? DASH : `${value}%`;
}

/** Three places, because DAB block centres are set to the kilohertz. */
function formatMHz(hz: number | null | undefined): string {
  if (!hz || !Number.isFinite(hz)) return DASH;
  return `${(hz / 1e6).toFixed(3)} MHz`;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes)) return DASH;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

/** Whole seconds under a minute, whole minutes under an hour, tenths of an hour past that. */
function formatDuration(seconds: number): string {
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  return `${(s / 3600).toFixed(1)}h`;
}

/** How long a node has been up: days take over past a day, as a node runs for weeks. */
export function formatUptime(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return DASH;
  if (seconds < 86400) return formatDuration(seconds);
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  return hours ? `${days}d ${hours}h` : `${days}d`;
}

/** A reading in its unit, to at most `decimals` places with trailing zeros dropped. */
function measure(value: number | null | undefined, unit: string, decimals: number): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return DASH;
  const number = value.toLocaleString(undefined, { maximumFractionDigits: decimals });
  return unit === '°' ? `${number}°` : `${number} ${unit}`;
}

/** A key the server sent, in words: `returned_to_probation` reads "Returned to probation". */
export function humanize(key: string): string {
  const words = key.replace(/_+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** A nested reading on one line, keys unquoted and strings quoted so "3" and 3 stay apart. */
function compact(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(compact).join(', ')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value)
      .map(([key, inner]) => `${key}: ${compact(inner)}`)
      .join(', ')}}`;
  }
  return JSON.stringify(value) ?? String(value);
}

/** A value with no format of its own: scalars as they read, anything nested compactly in mono. */
function plainValue(value: unknown): RecordValue {
  if (value === null || value === undefined || value === '') return text(DASH);
  if (typeof value === 'boolean') return text(value ? 'Yes' : 'No');
  if (typeof value === 'number') {
    return text(
      Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: 3 }) : DASH,
    );
  }
  if (typeof value === 'string') return text(value);
  return text(compact(value), true);
}

// ── Moments ──────────────────────────────────────────────────────────────────

/** How long ago a moment was, in the coarsest unit that is not zero. */
function ago(ms: number, now: number): string {
  const s = Math.round((now - ms) / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** A moment as how long ago it was, with the exact local time beside it; null for a stamp
 *  that is missing or does not parse. The month is named, so 3/4 never reads two ways. */
export function moment(
  at: string | null | undefined,
  now: number,
): { relative: string; exact: string } | null {
  const ms = at ? Date.parse(at) : NaN;
  if (Number.isNaN(ms)) return null;
  return {
    relative: ago(ms, now),
    exact: new Date(ms).toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
    }),
  };
}

// ── Last report ──────────────────────────────────────────────────────────────

export const REPORT_ASIDE = 'The node’s own account, from its last heartbeat';

/** Streaming is the healthy steady state; stalled and error are what an owner acts on. */
const STATE_TONE = new Map<string, BadgeTone>([
  ['streaming', 'online'],
  ['starting', 'info'],
  ['stopping', 'info'],
  ['paused', 'info'],
  ['stalled', 'warning'],
  ['error', 'offline'],
]);

const SERVICE = new Map<string, { tone: BadgeTone; label: string }>([
  ['up', { tone: 'online', label: 'Up' }],
  ['down', { tone: 'offline', label: 'Down' }],
  ['unknown', { tone: 'private', label: 'Unknown' }],
]);

/** A watched service, as a badge when it is one of the three states the contract names. */
function service(value: unknown): RecordValue {
  const known = typeof value === 'string' ? SERVICE.get(value) : undefined;
  if (!known) return plainValue(value);
  return { kind: 'badge', text: known.label, tone: known.tone };
}

/** A format applies only to a number, so a node sending something else still shows it. */
const number = (format: (n: number) => string) => (value: unknown) =>
  typeof value === 'number' ? text(format(value)) : plainValue(value);

/** The readings the v1 contract names, in the order an owner checks them. The disk figure
 *  is the node's MB, read as the MiB `df -m` gives. */
const HEALTH: { key: string; label: string; show: (value: unknown) => RecordValue }[] = [
  { key: 'cpu_pct', label: 'CPU load', show: number((n) => formatPercent(n, 1)) },
  { key: 'temp_c', label: 'Temperature', show: number((n) => `${fmt(n, 1)} °C`) },
  {
    key: 'disk_free_mb',
    label: 'Free disk space',
    show: number((n) => formatBytes(n * 1024 * 1024)),
  },
  { key: 'blah2', label: 'Radar service (blah2)', show: service },
  // Left out of the beat, or sent as null, when ADS-B is disabled in the node's configuration.
  {
    key: 'adsb',
    label: 'ADS-B receiver',
    show: (value) => (value == null ? text('Disabled') : service(value)),
  },
];

const SOFTWARE: { key: string; label: string }[] = [
  { key: 'owl_os', label: 'Operating system (owl-os)' },
  { key: 'retina_node', label: 'Node software (retina-node)' },
  { key: 'blah2_image', label: 'Radar software (blah2)' },
  { key: 'retina_tracker', label: 'Tracker release' },
];

const hasOwn = (record: Record<string, unknown>, key: string) =>
  Object.prototype.hasOwnProperty.call(record, key);

/** The named readings first, then anything newer the node sent, under its own key. */
function healthRows(health: Record<string, unknown>): RecordRow[] {
  // A beat with no health block: nothing in it, ADS-B included.
  if (Object.keys(health).length === 0) return [];
  const named = new Set(HEALTH.map((h) => h.key));
  const rows: RecordRow[] = HEALTH.filter((h) => hasOwn(health, h.key) || h.key === 'adsb').map(
    (h) => ({
      key: h.key,
      label: h.label,
      value: h.show(hasOwn(health, h.key) ? health[h.key] : undefined),
    }),
  );
  for (const [key, value] of Object.entries(health)) {
    if (!named.has(key)) rows.push({ key, label: humanize(key), value: plainValue(value) });
  }
  return rows;
}

function softwareRows(versions: Record<string, unknown>): RecordRow[] {
  const show = (value: unknown) =>
    typeof value === 'string' && value ? text(value, true) : plainValue(value);
  const named = new Set(SOFTWARE.map((s) => s.key));
  const rows: RecordRow[] = SOFTWARE.filter((s) => hasOwn(versions, s.key)).map((s) => ({
    key: s.key,
    label: s.label,
    value: show(versions[s.key]),
  }));
  for (const [key, value] of Object.entries(versions)) {
    if (!named.has(key)) rows.push({ key, label: humanize(key), value: show(value) });
  }
  return rows;
}

/** An empty record for a block the beat did not carry, or for anything that is not a record. */
function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export interface ReportError {
  message: string;
  at: string | null;
}

/** Newest first. The errors of one beat share its stamp, so arrival order breaks the tie;
 *  a stamp that does not parse sorts last. */
function newestFirst(errors: unknown): ReportError[] {
  if (!Array.isArray(errors)) return [];
  return errors
    .map((entry: unknown, index) => {
      const { at, message } = asRecord(entry);
      const ms = typeof at === 'string' ? Date.parse(at) : NaN;
      return {
        error: {
          message: typeof message === 'string' && message ? message : DASH,
          at: typeof at === 'string' ? at : null,
        },
        index,
        ms: Number.isNaN(ms) ? -Infinity : ms,
      };
    })
    .sort((a, b) => (a.ms === b.ms ? b.index - a.index : b.ms - a.ms))
    .map(({ error }) => error);
}

export interface ReportView {
  status: RecordRow[];
  health: RecordRow[];
  software: RecordRow[];
  errors: ReportError[];
}

/** The node's last heartbeat, as the node itself tells it. */
export function reportView(report: NodeReport): ReportView {
  const state = typeof report.state === 'string' ? report.state : '';
  return {
    status: [
      { key: 'received', label: 'Received', value: time(report.received_at) },
      {
        key: 'state',
        label: 'State',
        value: state
          ? { kind: 'badge', text: humanize(state), tone: STATE_TONE.get(state) ?? 'private' }
          : text(DASH),
      },
      { key: 'since', label: 'In this state since', value: time(report.state_since) },
      { key: 'uptime', label: 'Uptime', value: text(formatUptime(report.uptime_s)) },
      {
        key: 'config',
        label: 'Configuration version',
        value: text(report.config_version == null ? DASH : String(report.config_version)),
      },
    ],
    health: healthRows(asRecord(report.health)),
    software: softwareRows(asRecord(report.versions)),
    errors: newestFirst(report.errors),
  };
}

// ── Configuration history ────────────────────────────────────────────────────

function position(lat: number | null, lon: number | null): string {
  if (lat == null || lon == null || !Number.isFinite(lat) || !Number.isFinite(lon)) return DASH;
  return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}

interface Field {
  label: string;
  /** Every column the value is drawn from: a position has changed when either coordinate has. */
  keys: (keyof ConfigVersion)[];
  show: (c: ConfigVersion) => string;
  mono?: boolean;
}

/** One entry per column of a configuration version, so a version always differs from the one
 *  before it in at least one of these. Positions to five places, about a metre. */
const FIELDS: Field[] = [
  { label: 'Carrier frequency', keys: ['fc_hz'], show: (c) => formatMHz(c.fc_hz) },
  { label: 'Sample rate', keys: ['fs_hz'], show: (c) => formatMHz(c.fs_hz) },
  {
    label: 'RX position',
    keys: ['rx_lat', 'rx_lon'],
    show: (c) => position(c.rx_lat, c.rx_lon),
    mono: true,
  },
  { label: 'RX altitude', keys: ['rx_alt_ft'], show: (c) => measure(c.rx_alt_ft, 'ft', 1) },
  {
    label: 'TX position',
    keys: ['tx_lat', 'tx_lon'],
    show: (c) => position(c.tx_lat, c.tx_lon),
    mono: true,
  },
  { label: 'TX altitude', keys: ['tx_alt_ft'], show: (c) => measure(c.tx_alt_ft, 'ft', 1) },
  { label: 'TX callsign', keys: ['tx_callsign'], show: (c) => c.tx_callsign || DASH },
  {
    label: 'Beam width',
    keys: ['beam_width_deg'],
    show: (c) => measure(c.beam_width_deg, '°', 1),
  },
  {
    label: 'Beam azimuth',
    keys: ['beam_azimuth_deg'],
    show: (c) => measure(c.beam_azimuth_deg, '°', 1),
  },
  { label: 'Max range', keys: ['max_range_km'], show: (c) => measure(c.max_range_km, 'km', 1) },
  { label: 'CPI', keys: ['cpi_s'], show: (c) => measure(c.cpi_s, 's', 3) },
  {
    label: 'Delay tolerance',
    keys: ['delay_tolerance_us'],
    show: (c) => measure(c.delay_tolerance_us, 'µs', 2),
  },
  {
    label: 'Doppler tolerance',
    keys: ['doppler_tolerance_hz'],
    show: (c) => measure(c.doppler_tolerance_hz, 'Hz', 2),
  },
];

/** Compared as stored rather than as drawn, so a change finer than the format shows is still
 *  marked. An absent key and a null are the same nothing. */
function changed(field: Field, version: ConfigVersion, before: ConfigVersion): boolean {
  return field.keys.some((key) => (version[key] ?? null) !== (before[key] ?? null));
}

export interface ConfigFieldView {
  label: string;
  text: string;
  mono: boolean;
  changed: boolean;
}

export interface VersionView {
  version: number;
  /** The version in force has no superseded_at. */
  inForce: boolean;
  summary: string;
  createdAt: string | null;
  supersededAt: string | null;
  fields: ConfigFieldView[];
}

/** Every version newest first, whatever order they arrive in, each compared with the one after
 *  it: the order is what makes a mark true. */
export function configHistoryView(versions: readonly ConfigVersion[]): VersionView[] {
  const sorted = [...versions].sort((a, b) => b.version - a.version);
  // Whether the oldest loaded is the earliest there is: versions count from 1, and a history
  // shorter than the limit asked for is all there is.
  const oldest = sorted[sorted.length - 1];
  const complete = oldest?.version === 1 || sorted.length < CONFIG_HISTORY_LIMIT;
  return sorted.map((version, i) => {
    const before = sorted[i + 1];
    const moved = before ? FIELDS.filter((f) => changed(f, version, before)) : [];
    let summary: string;
    if (before) {
      summary = moved.length
        ? `Changed from version ${before.version}: ${moved.map((f) => f.label).join(', ')}.`
        : `The same values as version ${before.version}.`;
    } else {
      summary = complete
        ? 'The earliest configuration since this node joined your account.'
        : 'The oldest version loaded. Earlier versions are not shown.';
    }
    return {
      version: version.version,
      inForce: version.superseded_at == null,
      summary,
      createdAt: typeof version.created_at === 'string' ? version.created_at : null,
      supersededAt: typeof version.superseded_at === 'string' ? version.superseded_at : null,
      fields: FIELDS.map((field) => ({
        label: field.label,
        text: field.show(version),
        mono: field.mono === true,
        changed: moved.includes(field),
      })),
    };
  });
}

/** How many versions are drawn, and the button that shows or hides the rest (null when every
 *  version fits). */
export function versionExpander(
  total: number,
  showAll: boolean,
): { shown: number; button: string | null } {
  if (total <= SHOWN_FIRST) return { shown: total, button: null };
  if (showAll) return { shown: total, button: 'Show the newest versions only' };
  const hidden = total - SHOWN_FIRST;
  return {
    shown: SHOWN_FIRST,
    button: `Show ${hidden} older version${hidden === 1 ? '' : 's'}`,
  };
}

export function configAside(count: number): string | null {
  if (!count) return null;
  return count >= CONFIG_HISTORY_LIMIT
    ? `Newest ${CONFIG_HISTORY_LIMIT} versions`
    : `${count} version${count === 1 ? '' : 's'}`;
}

// ── History ──────────────────────────────────────────────────────────────────

/** What happened, in the owner's words. A Map, so a kind the app does not know yet falls
 *  through to its own name and never to something Object carries. */
const KIND_LABEL = new Map<string, string>([
  ['registered', 'Registered'],
  ['removed', 'Removed'],
  ['graduated', 'Graduated from probation'],
  ['returned_to_probation', 'Returned to probation'],
  ['renamed', 'Label changed'],
  ['made_private', 'Location made private'],
  ['made_public', 'Location made public'],
]);

/** What took a node off the network, back towards it, or onto it. A change of label or privacy
 *  is the owner's own housekeeping. */
const KIND_TONE = new Map<string, DotTone>([
  ['registered', 'accent'],
  ['graduated', 'success'],
  ['returned_to_probation', 'warning'],
  ['removed', 'error'],
]);

/** Whose side a decision came from. The route never says who: an owner from before the node
 *  changed hands is "an earlier owner", and the server's own jobs act automatically. */
const ACTOR_LABEL = new Map<string, string>([
  ['you', 'by you'],
  ['owner', 'by an earlier owner'],
  ['admin', 'by an administrator'],
  ['system', 'automatically'],
]);

export interface EventView {
  label: string;
  /** Null for an actor the app has no words for. */
  actor: string | null;
  tone: DotTone;
  at: string | null;
}

export function eventView(event: OwnerEvent): EventView {
  const kind = String(event.kind ?? '');
  return {
    label: KIND_LABEL.get(kind) ?? (humanize(kind) || DASH),
    actor: ACTOR_LABEL.get(event.actor) ?? null,
    tone: KIND_TONE.get(kind) ?? 'neutral',
    at: typeof event.at === 'string' ? event.at : null,
  };
}

export function eventsAside(count: number): string | null {
  if (!count) return null;
  return count >= EVENTS_LIMIT
    ? `Newest ${EVENTS_LIMIT} entries`
    : `${count} ${count === 1 ? 'entry' : 'entries'}`;
}
