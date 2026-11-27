/**
 * Scales, ticks and point thinning for the node charts. Pure: nothing here
 * knows about React, the theme or the screen, so the numbers can be checked on
 * their own.
 */

export type Domain = readonly [number, number];

const MINUTE_MS = 60_000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// The error bounds that pick a 10, 5 or 2 step over a 1: each sits at the
// geometric middle between two neighbouring steps, so the step chosen is the
// one whose interval count lands nearest the count asked for.
const E10 = Math.sqrt(50);
const E5 = Math.sqrt(10);
const E2 = Math.sqrt(2);
// Room for the rounding in a quotient such as 0.6 / 0.2 = 2.9999999999999996.
const EPSILON = 1e-9;

/** Maps a value in `domain` onto `range` linearly. A domain without span maps
 *  every value to the middle of the range rather than dividing by zero. */
export function linearScale(domain: Domain, range: Domain): (value: number) => number {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0;
  if (!Number.isFinite(span) || span === 0) {
    const middle = (r0 + r1) / 2;
    return () => middle;
  }
  const k = (r1 - r0) / span;
  return (value) => r0 + (value - d0) * k;
}

/** The smallest and largest finite values, or null when there is none. */
export function extent(values: Iterable<number | null | undefined>): [number, number] | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (const value of values) {
    if (value == null || !Number.isFinite(value)) continue;
    if (value < lo) lo = value;
    if (value > hi) hi = value;
  }
  return lo <= hi ? [lo, hi] : null;
}

export interface NiceScale {
  /** The domain widened out to the first and last tick. */
  min: number;
  max: number;
  step: number;
  ticks: number[];
}

/** Decimal places that write every multiple of a 1, 2 or 5 x 10^k step. */
export function stepDecimals(step: number): number {
  if (!(step > 0) || !Number.isFinite(step)) return 0;
  return Math.max(0, -Math.floor(Math.log10(step) + EPSILON));
}

/** A tick's text, with as many decimals as its step needs and no more. */
export function tickLabel(value: number, step: number): string {
  return value.toFixed(stepDecimals(step));
}

function roundTo(value: number, decimals: number): number {
  // `+ 0` turns a -0 into 0, which would otherwise print as "-0".
  return Number(value.toFixed(decimals)) + 0;
}

/**
 * Ticks on a step of 1, 2 or 5 times a power of ten, about `count` intervals
 * across [lo, hi], with the domain widened out to the first and last tick.
 * A domain without span is opened around its value so the value sits in the
 * middle (0 alone becomes 0..1), and an empty one (no finite bound) becomes
 * 0..1, so a chart always has an axis to draw.
 */
export function niceTicks(lo: number, hi: number, count = 5): NiceScale {
  let a = Math.min(lo, hi);
  let b = Math.max(lo, hi);
  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    a = 0;
    b = 1;
  } else if (a === b) {
    const pad = Math.abs(a);
    if (pad === 0) b = 1;
    else {
      a -= pad;
      b += pad;
    }
  }
  const intervals = Math.max(1, Math.round(count));
  const raw = (b - a) / intervals;
  let unit = 10 ** Math.floor(Math.log10(raw));
  const error = raw / unit;
  let factor = error >= E10 ? 10 : error >= E5 ? 5 : error >= E2 ? 2 : 1;
  if (factor === 10) {
    factor = 1;
    unit *= 10;
  }
  let step = factor * unit;
  if (!Number.isFinite(step) || step <= 0) return { min: a, max: b, step: b - a, ticks: [a, b] };
  let first = Math.floor(a / step + EPSILON);
  let last = Math.ceil(b / step - EPSILON);
  // Widening to whole steps can add up to two intervals; past half again the
  // count asked for, the next step up (1, 2, 5, 10, ...) reads better.
  for (let i = 0; last - first > Math.ceil(intervals * 1.5) && i < 4; i++) {
    if (factor === 5) {
      factor = 1;
      unit *= 10;
    } else factor = factor === 1 ? 2 : 5;
    step = factor * unit;
    first = Math.floor(a / step + EPSILON);
    last = Math.ceil(b / step - EPSILON);
  }
  const decimals = stepDecimals(step);
  const ticks: number[] = [];
  for (let i = first; i <= last; i++) ticks.push(roundTo(i * step, decimals));
  return { min: ticks[0], max: ticks[ticks.length - 1], step, ticks };
}

/* ── Time ──────────────────────────────────────────────────────────────── */

// Clock times are the viewer's own, on a 24-hour clock, as on the web
// dashboard: "14:00" reads better on an axis than "02 PM", and is written
// here rather than by Intl so every device prints the same.
function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** A moment as HH:MM on the local clock. */
export function clock(ms: number): string {
  const at = new Date(ms);
  return `${pad2(at.getHours())}:${pad2(at.getMinutes())}`;
}

/** A moment's local date, as "27 Nov". */
export function dayLabel(ms: number): string {
  const at = new Date(ms);
  return `${at.getDate()} ${MONTHS[at.getMonth()]}`;
}

function sameDay(a: number, b: number): boolean {
  return new Date(a).toDateString() === new Date(b).toDateString();
}

/** Steps a time axis can take, in minutes: every one divides an hour or a day,
 *  so the ticks land on round local times. */
const TIME_STEPS_MIN = [5, 10, 15, 30, 60, 120, 180, 360, 720, 1440];

export interface TimeTick {
  t: number;
  /** HH:MM, local. */
  label: string;
  /** The date under a tick, only when the window spans more than one day:
   *  on the first tick, and on the first tick of each new day. */
  day: string | null;
}

/**
 * Ticks on round local times across [start, end]: the smallest step that
 * keeps the count under `maxTicks`, from five minutes for an hour's window up
 * to a day for three days'. Steps of an hour or more are counted on the local
 * clock (setHours, not a sum of milliseconds), so a change of clocks keeps
 * them on the hour.
 */
export function timeTicks(start: number, end: number, maxTicks = 6): TimeTick[] {
  const span = end - start;
  if (!Number.isFinite(span) || span <= 0) return [];
  const limit = Math.max(2, Math.floor(maxTicks));
  const minutes =
    TIME_STEPS_MIN.find((m) => span / (m * MINUTE_MS) < limit) ??
    TIME_STEPS_MIN[TIME_STEPS_MIN.length - 1];
  const hours = minutes / 60;
  const at = new Date(start);
  if (minutes < 60) {
    at.setSeconds(0, 0);
    if (at.getTime() < start) at.setMinutes(at.getMinutes() + 1);
    for (let i = 0; at.getMinutes() % minutes !== 0 && i < 60; i++) {
      at.setMinutes(at.getMinutes() + 1);
    }
  } else {
    at.setMinutes(0, 0, 0);
    if (at.getTime() < start) at.setHours(at.getHours() + 1);
    for (let i = 0; at.getHours() % hours !== 0 && i < 24; i++) at.setHours(at.getHours() + 1);
  }
  const spansDays = !sameDay(start, end);
  const ticks: TimeTick[] = [];
  for (let i = 0; at.getTime() <= end && i < 200; i++) {
    const t = at.getTime();
    const previous = ticks[ticks.length - 1];
    const newDay = spansDays && (!previous || !sameDay(previous.t, t));
    ticks.push({ t, label: clock(t), day: newDay ? dayLabel(t) : null });
    if (minutes < 60) at.setMinutes(at.getMinutes() + minutes);
    else at.setHours(at.getHours() + hours);
  }
  return ticks;
}

/* ── Hit-testing and thinning ──────────────────────────────────────────── */

/** The index of the value in ascending `sorted` nearest to `x`; -1 when there
 *  is none to pick. A tie goes to the earlier value. */
export function nearestIndex(sorted: readonly number[], x: number): number {
  const n = sorted.length;
  if (n === 0 || Number.isNaN(x)) return -1;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && x - sorted[lo - 1] <= sorted[lo] - x) return lo - 1;
  return lo;
}

/** Which of `count` equal bands from `start`, each `band` wide, holds `x`,
 *  clamped to the first and last; -1 when there are no bands. */
export function bandIndex(x: number, start: number, band: number, count: number): number {
  if (count <= 0 || !(band > 0) || Number.isNaN(x)) return -1;
  return Math.min(count - 1, Math.max(0, Math.floor((x - start) / band)));
}

/** Which of `items` to keep when they are cut into `runs` runs of neighbours:
 *  the two ends, each run's smallest and largest of every value, and the
 *  first gap between any two kept items that had one between them. */
function keptInRuns<T>(
  items: readonly T[],
  runs: number,
  values: readonly ((item: T) => number | null)[],
  isGap: (item: T) => boolean,
): boolean[] {
  const n = items.length;
  const size = Math.ceil(n / runs);
  const kept = new Array<boolean>(n).fill(false);
  kept[0] = true;
  kept[n - 1] = true;
  for (let from = 0; from < n; from += size) {
    const to = Math.min(n, from + size);
    for (const value of values) {
      let lo = -1;
      let hi = -1;
      for (let i = from; i < to; i++) {
        const v = value(items[i]);
        if (v === null || !Number.isFinite(v)) continue;
        if (lo < 0 || v < (value(items[lo]) as number)) lo = i;
        if (hi < 0 || v > (value(items[hi]) as number)) hi = i;
      }
      if (lo >= 0) kept[lo] = true;
      if (hi >= 0) kept[hi] = true;
    }
  }
  // A gap is put back between two kept items, unless one of them is a gap.
  let gap = -1;
  let broken = false;
  for (let i = 0; i < n; i++) {
    if (!kept[i]) {
      if (gap < 0 && isGap(items[i])) gap = i;
      continue;
    }
    const here = isGap(items[i]);
    if (gap >= 0 && !broken && !here) kept[gap] = true;
    gap = -1;
    broken = here;
  }
  return kept;
}

const countKept = (kept: readonly boolean[]) => kept.filter(Boolean).length;

/**
 * At most `maxPoints` of `items`, in their order: the first and the last, and
 * in each run of neighbours the smallest and the largest of every value, so a
 * peak or a dip survives the thinning. An item whose values are all null (a
 * gap in a line) is kept between any two kept items that had one between them,
 * so a line broken anywhere stays broken there. A list under the cap comes back
 * as it is. The cap never drops below what one run keeps plus the two ends,
 * with a gap after each where there are gaps.
 */
export function decimate<T>(
  items: readonly T[],
  maxPoints: number,
  values: readonly ((item: T) => number | null)[],
): readonly T[] {
  const n = items.length;
  const isGap = (item: T) => values.every((value) => value(item) === null);
  const perRun = Math.max(1, 2 * values.length);
  // K items kept need at most K - 1 gaps between them.
  const least = items.some(isGap) ? 2 * (perRun + 2) - 1 : perRun + 2;
  const cap = Math.max(least, Number.isFinite(maxPoints) ? Math.floor(maxPoints) : 0);
  if (n <= cap) return items;
  // The gaps put back take places of their own: fewer, longer runs until
  // everything kept fits under the cap.
  let runs = Math.max(1, Math.floor((cap - 2) / perRun));
  let kept = keptInRuns(items, runs, values, isGap);
  for (let count = countKept(kept); count > cap && runs > 1; count = countKept(kept)) {
    runs = Math.max(1, Math.min(runs - 1, Math.floor((runs * cap) / count)));
    kept = keptInRuns(items, runs, values, isGap);
  }
  return items.filter((_, i) => kept[i]);
}
