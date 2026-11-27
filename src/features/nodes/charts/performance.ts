// The rules and geometry behind a node's "What this node detects" panel, ported from the web's
// dashboard/src/pages/user/nodeDetail/PerformancePanel.tsx and contribution/figures.ts. No React
// here: the panel, the grid and the bearing chart read every text and coordinate from these.
import type { NodePerformance, RangeBound, RankStatus, SystemConstantBound } from '@/api';

export const DASH = '—';

/** A floor on samples: a cell under it is greyed, however it reads. A sample is one aircraft in
 *  one 10 s step, so a few can be a single aircraft. */
export const EVIDENCE_FLOOR = 30;

/** Read first when listed: the class the network sees the most of. */
export const DEFAULT_CLASS = 'narrowbody';

/** A Map, not a lookup on an object: the keys come from the server, and `constructor` would
 *  otherwise resolve up the prototype chain. */
const CLASS_LABELS = new Map([
  ['military_transport', 'Military transport'],
  ['widebody', 'Widebody'],
  ['regional_jet', 'Regional jet'],
  ['narrowbody', 'Narrowbody'],
  ['turboprop', 'Turboprop'],
  ['bizjet', 'Business jet'],
  ['light_GA', 'Light aircraft'],
  ['helicopter', 'Helicopter'],
  ['unknown', 'Unknown type'],
]);

export function classLabel(key: string): string {
  return CLASS_LABELS.get(key) ?? key.replace(/_/g, ' ');
}

/** The class the panel shows: the one picked while it is still listed, else the default class
 *  when listed, else the first. `listed` false with a pick means a poll dropped the picked class,
 *  and the pick ends so the view does not jump back if the class returns. */
export function chosenClass(
  classes: readonly string[],
  picked: string | null,
): { chosen: string | undefined; listed: boolean } {
  const listed = picked !== null && classes.includes(picked);
  if (listed) return { chosen: picked, listed };
  return { chosen: classes.includes(DEFAULT_CLASS) ? DEFAULT_CLASS : classes[0], listed };
}

/** A bin as the analysis keys it and as an axis prints it. */
export interface Bin {
  key: string;
  label: string;
}

/** Highest first, so the table reads the way the sky does. */
export const ALTITUDES: readonly Bin[] = [
  { key: '20-45kft', label: '20–45' },
  { key: '10-20kft', label: '10–20' },
  { key: '5-10kft', label: '5–10' },
  { key: '0-5kft', label: '0–5' },
];

export const RANGES: readonly Bin[] = [
  { key: '0-20km', label: '0–20' },
  { key: '20-40km', label: '20–40' },
  { key: '40-60km', label: '40–60' },
  { key: '60-100km', label: '60–100' },
];

export interface Reading {
  pd: number | null;
  evidence: number;
}

/** One cell of a class's table. A cell the file leaves out is one nothing was measured in. */
export function readCell(
  performance: NodePerformance,
  cls: string,
  range: Bin,
  altitude: Bin,
): Reading {
  return {
    pd: performance.pd_by_class_range_alt[cls]?.[range.key]?.[altitude.key] ?? null,
    evidence: performance.evidence_by_class_range_alt[cls]?.[range.key]?.[altitude.key] ?? 0,
  };
}

/** A detection share, 0 to 1, as a whole percentage. */
export function pdText(pd: number | null): string {
  return pd === null ? DASH : `${(pd * 100).toFixed(0)}%`;
}

/** Five digits and a comma are wider than a phone's cell holds. */
export function compactCount(n: number): string {
  return n >= 10_000 ? `${Math.round(n / 1000)}k` : n.toLocaleString();
}

/** The share of accent in a heated cell's ground. The top of the ramp is as far as the text ink
 *  keeps AA on the dark theme's card (4.9:1 at 45%), and the foot stays clear of a greyed cell's
 *  ground. */
export function heatShare(pd: number): number {
  return 0.12 + 0.33 * pd;
}

export function cellDetail(cls: string, range: Bin, altitude: Bin, { pd, evidence }: Reading) {
  const place = `${classLabel(cls)}, ${range.label} km, ${altitude.label} kft`;
  const samples = evidence.toLocaleString();
  return pd === null
    ? `${place}: no figure, ${samples} samples`
    : `${place}: ${pdText(pd)} of ${samples} samples`;
}

export interface GridCell {
  range: Bin;
  altitude: Bin;
  reading: Reading;
  /** False for a cell with no figure or under the evidence floor: drawn greyed. */
  heated: boolean;
  /** The cell's sentence, read out for it and matching the web's title. */
  detail: string;
  pdText: string;
  countText: string;
}

/** The 4x4 table for a class, highest altitude first, nearest range first. */
export function gridRows(
  performance: NodePerformance,
  cls: string,
): { altitude: Bin; cells: GridCell[] }[] {
  return ALTITUDES.map((altitude) => ({
    altitude,
    cells: RANGES.map((range) => {
      const reading = readCell(performance, cls, range, altitude);
      return {
        range,
        altitude,
        reading,
        heated: reading.pd !== null && reading.evidence >= EVIDENCE_FLOOR,
        detail: cellDetail(cls, range, altitude, reading),
        pdText: pdText(reading.pd),
        countText: compactCount(reading.evidence),
      };
    }),
  }));
}

/** What the tapped cell's detail lists, label then value, as the web's sheet table. */
export function cellSheetRows(range: Bin, altitude: Bin, reading: Reading): [string, string][] {
  return [
    ['Range', `${range.label} km`],
    ['Altitude', `${altitude.label} kft`],
    ['Detected', pdText(reading.pd)],
    ['Samples', reading.evidence.toLocaleString()],
  ];
}

export const UNDER_FLOOR_TEXT = `Fewer than ${EVIDENCE_FLOOR} samples here, so read this as a rough guide`;

export const GRID_KEY_TEXT =
  `Each cell: the share detected, and how many samples that rests on. Greyed under ${EVIDENCE_FLOOR} samples. ` +
  'A sample is one aircraft in one 10 s step.';

type TowerStatus = NonNullable<NodePerformance['tower']['status']>;

/** What each tower match status is called under a node's sensitivity. */
const TOWER_STATUS = new Map<string, string>([
  ['matched', 'Matched'],
  ['frequency_mismatch', 'Frequency mismatch'],
  ['not_found', 'Not found'],
  ['unsupported_region', 'Region not covered'],
]);

function towerStatusText(status: TowerStatus): string {
  return TOWER_STATUS.get(status) ?? status.replace(/_/g, ' ');
}

/** What the panel, the leaderboard and the admin table say about a node with no rank. */
export const RANK_STATUS_TEXT: Readonly<Record<RankStatus, string>> = {
  no_opportunities:
    'No ADS-B aircraft have crossed its coverage lately, so there is nothing to measure it against',
  low_evidence:
    'Not enough solid evidence to rank it fairly yet: few samples, no clear detection curve, or no tags or claims to check its setup',
  low_ceiling:
    'It misses more than half of even its easiest aircraft, so its sensitivity cannot rank it fairly',
  tower_unknown:
    "Its transmitter is not matched to a known tower yet, or its tower's licence lists no power, so its sensitivity cannot be worked out",
  config_suspect:
    'Its detections do not line up with its configured site, so its position or settings need checking',
  synthetic: 'A simulated node, and only real nodes are ranked',
};

/** The sentence for a rank status; null for one this build does not know. */
function rankStatusText(status: RankStatus): string | null {
  return Object.prototype.hasOwnProperty.call(RANK_STATUS_TEXT, status)
    ? RANK_STATUS_TEXT[status]
    : null;
}

/** A range in whole kilometres. A bound that is not a measurement says what stopped it: the
 *  processing window or the amount of data so far. */
export function formatRange(
  km: number | null | undefined,
  bound: RangeBound | null | undefined,
): string {
  if (km == null) return DASH;
  const rounded = Math.round(km);
  if (bound === 'window') return `≥ ${rounded} km, processing window`;
  if (bound === 'evidence') return `≥ ${rounded} km, more data needed`;
  return `${rounded} km`;
}

/** The system constant in dB to one decimal, with its spread when known. An "at least" figure is
 *  a floor, so it carries no spread. */
export function formatSystemConstant(
  db: number | null | undefined,
  sigma: number | null | undefined,
  bound?: SystemConstantBound | null,
): string {
  if (db == null) return DASH;
  if (bound === 'at_least') return `≥ ${db.toFixed(1)} dB`;
  if (sigma == null) return `${db.toFixed(1)} dB`;
  return `${db.toFixed(1)} ± ${sigma.toFixed(1)} dB`;
}

export interface Fact {
  label: 'Rank' | 'Sensitivity' | 'Configuration';
  value: string;
  /** The configuration looks wrong: drawn in the warning tone. */
  warning: boolean;
  note: string | null;
  reason: string | null;
}

/**
 * Rank, sensitivity and configuration. A rank status's sentence prints once, in the fact it
 * explains: `tower_unknown` under Sensitivity and `config_suspect` under Configuration while those
 * show the state, and under Rank otherwise. The server decides what is suspect; this only reads
 * `rank_status`.
 */
export function headlineFacts(performance: NodePerformance): Fact[] {
  const { rank, rank_status: status, tower, tag_delay_residual_mad_us: residual } = performance;
  const towerUnknown = tower.status !== 'matched' || tower.eirp_dbm == null;
  const suspect = residual != null && status === 'config_suspect';
  const explainedElsewhere = suspect || (towerUnknown && status === 'tower_unknown');
  const fromClaims = performance.delay_residual_source === 'claims';
  const residualText =
    residual != null ? `${residual.toFixed(2)} µs ${fromClaims ? 'claim' : 'tag'} residual` : null;
  const ranked = typeof rank === 'number';
  const towerNote = tower.callsign
    ? `Tower ${tower.callsign}${
        tower.status && tower.status !== 'matched' ? ` (${towerStatusText(tower.status)})` : ''
      }`
    : null;

  return [
    {
      label: 'Rank',
      value: ranked ? `#${rank}` : 'Not ranked',
      warning: false,
      note: null,
      reason: !ranked && status && !explainedElsewhere ? rankStatusText(status) : null,
    },
    {
      label: 'Sensitivity',
      value: formatSystemConstant(
        performance.system_constant_db,
        performance.system_constant_sigma_db,
        performance.system_constant_bound,
      ),
      warning: false,
      note: towerNote,
      reason: towerUnknown ? RANK_STATUS_TEXT.tower_unknown : null,
    },
    {
      label: 'Configuration',
      value: !residualText
        ? 'Not enough tags or claims to check yet'
        : suspect
          ? residualText
          : `${residualText}, in line with its site`,
      warning: suspect,
      note: fromClaims ? 'Read from its claims, as it has too few tags' : null,
      reason: suspect ? RANK_STATUS_TEXT.config_suspect : null,
    },
  ];
}

/** The card header's note: the analysis window and how many samples it rests on. */
export function windowText(performance: NodePerformance): string {
  const [from, to] = performance.window;
  return `${from} to ${to}, ${performance.opportunities.toLocaleString()} ADS-B samples`;
}

/** What the figures count, and why a node that tags few aircraft says little yet. */
export function numeratorText(numerator: NodePerformance['numerator']): string {
  const counted =
    numerator === 'tags'
      ? "These figures count the node's own ADS-B tags."
      : 'These figures count claims that pass the quality gate.';
  return (
    `${counted} A node that tags few aircraft can't be scored yet: few of its detections count ` +
    'here, so its figures say little about what it sees.'
  );
}

/* ── Bearing chart ─────────────────────────────────────────────────────── */

/** Each bin covers 5 degrees, bin i centred on bearing i * 5, so 72 bins go round once. */
export const BEARING_STEP_DEG = 5;
const BEARING_POSITIONS = 360 / BEARING_STEP_DEG;

/** The rings drawn and labelled, as shares of the outer radius. */
export const PD_RINGS: readonly number[] = [0.25, 0.5, 0.75, 1];

export const COMPASS: readonly (readonly [number, string])[] = [
  [0, 'N'],
  [90, 'E'],
  [180, 'S'],
  [270, 'W'],
];

const measured = (pd: number | null | undefined): pd is number =>
  typeof pd === 'number' && Number.isFinite(pd);

/**
 * The runs of the line through the measured bins, as bin indices: each run starts a new stroke, so
 * a bin with no figure leaves a gap rather than a chord across bearings where nothing was
 * measured. 355° and 0° are neighbours: when the first and the last bins are both measured, the
 * last run carries on to bin 0, as the web's line does.
 */
export function bearingSegments(bins: readonly (number | null)[]): number[][] {
  const segments: number[][] = [];
  bins.forEach((pd, i) => {
    if (!measured(pd)) return;
    if (i > 0 && measured(bins[i - 1])) segments[segments.length - 1].push(i);
    else segments.push([i]);
  });
  if (measured(bins[0]) && measured(bins[bins.length - 1])) segments[segments.length - 1].push(0);
  return segments;
}

/** The bins that carry a figure, each drawn as a dot. */
export function measuredBins(bins: readonly (number | null)[]): number[] {
  return bins.flatMap((pd, i) => (measured(pd) ? [i] : []));
}

export interface Polar {
  cx: number;
  cy: number;
  /** The radius of the 100% ring. */
  radius: number;
}

/** Where a share lies on a bearing: north up, bearings clockwise, 0 at the centre and 1 on the
 *  outer ring. */
export function polarPoint(bearingDeg: number, share: number, { cx, cy, radius }: Polar) {
  const angle = (bearingDeg * Math.PI) / 180;
  const r = radius * Math.min(Math.max(share, 0), 1);
  return { x: cx + r * Math.sin(angle), y: cy - r * Math.cos(angle) };
}

/** A bin's point on the chart; only called for a measured bin. */
export function binPoint(bins: readonly (number | null)[], index: number, polar: Polar) {
  return polarPoint(index * BEARING_STEP_DEG, bins[index] ?? 0, polar);
}

/** The SVG path of the line: one move per run, a line to each next bin in it. */
export function bearingPath(bins: readonly (number | null)[], polar: Polar): string {
  const at = (index: number) => {
    const { x, y } = binPoint(bins, index, polar);
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  };
  return bearingSegments(bins)
    .map((run) => run.map((index, k) => `${k === 0 ? 'M' : 'L'}${at(index)}`).join(''))
    .join('');
}

/** The bin nearest a touch, by its bearing from the centre alone, wrapping past 355° to bin 0. */
export function nearestBin(x: number, y: number, { cx, cy }: Pick<Polar, 'cx' | 'cy'>): number {
  const degrees = (Math.atan2(x - cx, cy - y) * 180) / Math.PI;
  const bearing = (degrees + 360) % 360;
  return Math.round(bearing / BEARING_STEP_DEG) % BEARING_POSITIONS;
}

/** The touch readout for a bin, the web tooltip's label and line: "{bearing}°", "Detected {pct}". */
export function bearingReadout(bins: readonly (number | null)[], index: number): string {
  return `${index * BEARING_STEP_DEG}° · Detected ${pdText(bins[index] ?? null)}`;
}

/** The chart in one sentence, for a screen reader. */
export function bearingSummary(bins: readonly (number | null)[]): string {
  const shown = measuredBins(bins);
  const title = 'Detection by bearing';
  if (shown.length === 0) return `${title}: nothing measured at any bearing yet`;
  const at = (index: number) => `${pdText(bins[index] ?? null)} at ${index * BEARING_STEP_DEG}°`;
  if (shown.length === 1)
    return `${title}: measured at 1 of ${bins.length} bearings, ${at(shown[0])}`;
  const byPd = [...shown].sort((a, b) => (bins[a] ?? 0) - (bins[b] ?? 0));
  return (
    `${title}: measured at ${shown.length} of ${bins.length} bearings, ` +
    `lowest ${at(byPd[0])}, highest ${at(byPd[byPd.length - 1])}`
  );
}

/* ── Colour ────────────────────────────────────────────────────────────── */

function parseHex(colour: string): [number, number, number] | null {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(colour)?.[1];
  if (!hex) return null;
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [number, number, number];
}

/** `share` of `fg` over `bg`, as CSS color-mix in srgb does; `fg` alone when either is not hex. */
export function mixColour(fg: string, bg: string, share: number): string {
  const a = parseHex(fg);
  const b = parseHex(bg);
  if (!a || !b) return fg;
  const [r, g, bl] = a.map((channel, i) => Math.round(channel * share + b[i] * (1 - share)));
  return `rgb(${r}, ${g}, ${bl})`;
}
