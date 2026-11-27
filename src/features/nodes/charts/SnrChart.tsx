import { useState, type ReactElement } from 'react';
import { View } from 'react-native';
import Svg, { Circle, Line, Path, Text as SvgText } from 'react-native-svg';

import type { SnrSeries } from '@/api';
import { ThemedText } from '@/components';
import { useTheme } from '@/theme';
import { plural } from './BarChart';
import { ChartReadout, useChartTouch } from './Readout';
import {
  clock,
  decimate,
  extent,
  linearScale,
  nearestIndex,
  niceTicks,
  tickLabel,
  timeTicks,
} from './scale';
import { useChartTheme } from './theme';

const HOUR_MS = 3_600_000;
/** The most buckets drawn: 72 hours of five-minute buckets is 864, more than a
 *  phone has pixels for. Thinning keeps each run's highs and lows. */
export const MAX_DRAWN_POINTS = 300;

const FONT = 11;
const CHAR = FONT * 0.6;
const PLOT_HEIGHT = 190;
// Room per time label along the axis: "00:00" or "27 Nov" and a gap after it.
const TIME_TICK_ROOM = 48;

/** One bucket on the chart. A gap stands where the server sent no bucket, so
 *  the lines break there rather than drawing straight through a stretch with
 *  no detection. */
export interface SnrBucket {
  /** The bucket's start, epoch ms. */
  t_ms: number;
  median_db: number | null;
  p90_db: number | null;
  count: number;
  /** For a gap: where the next bucket with detections starts, epoch ms. */
  gap_until?: number;
}

type Percentile = 'median_db' | 'p90_db';

const finiteOrNull = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

/** The series' points, oldest first, with a gap after any bucket the next one
 *  does not follow on from. One gap is enough to break a line, however many
 *  buckets went empty. A point without a time is left out. */
export function withGaps(series: SnrSeries): SnrBucket[] {
  const step = series.bucket_s * 1000;
  const points = series.points
    .filter((point) => Number.isFinite(point.t_ms))
    .sort((a, b) => a.t_ms - b.t_ms);
  const buckets: SnrBucket[] = [];
  points.forEach((point, i) => {
    const previous = points[i - 1];
    if (previous && step > 0 && point.t_ms - previous.t_ms > step) {
      buckets.push({
        t_ms: previous.t_ms + step,
        median_db: null,
        p90_db: null,
        count: 0,
        gap_until: point.t_ms,
      });
    }
    buckets.push({
      t_ms: point.t_ms,
      median_db: finiteOrNull(point.median_db),
      p90_db: finiteOrNull(point.p90_db),
      count: finiteOrNull(point.count) ?? 0,
    });
  });
  return buckets;
}

/** Whether the line through `key` has nothing either side of this bucket, so
 *  only a dot can show it. */
function isolated(buckets: readonly SnrBucket[], index: number, key: Percentile): boolean {
  if (buckets[index]?.[key] == null) return false;
  return buckets[index - 1]?.[key] == null && buckets[index + 1]?.[key] == null;
}

/** A bucket's readout in the web tooltip's words: its window, its two
 *  percentiles and how many detections they are of; for a gap, that nothing
 *  was detected. */
export function bucketReadout(bucket: SnrBucket, bucketMs: number): string {
  const window = `${clock(bucket.t_ms)}–${clock(bucket.gap_until ?? bucket.t_ms + bucketMs)}`;
  if (bucket.median_db === null) return `${window} · No detections`;
  const parts = [window, `Median ${bucket.median_db.toFixed(1)} dB`];
  if (bucket.p90_db !== null) parts.push(`90th percentile ${bucket.p90_db.toFixed(1)} dB`);
  parts.push(plural(bucket.count, 'detection', 'detections'));
  return parts.join(' · ');
}

/** "the last 24 hours", "the last hour". */
export function lastHours(hours: number): string {
  return hours === 1 ? 'the last hour' : `the last ${hours} hours`;
}

/** The chart in words, as the web prints it under the chart: the latest
 *  bucket and the window's total. Null when no bucket has a reading. */
export function seriesSummary(series: SnrSeries, buckets: readonly SnrBucket[]): string | null {
  const latest = [...buckets].reverse().find((bucket) => bucket.median_db !== null);
  if (!latest || latest.median_db === null) return null;
  const total = series.points.reduce((sum, point) => sum + (finiteOrNull(point.count) ?? 0), 0);
  const p90 = latest.p90_db !== null ? `, 90th percentile ${latest.p90_db.toFixed(1)} dB` : '';
  return (
    `Latest bucket, ${clock(latest.t_ms)}–${clock(latest.t_ms + series.bucket_s * 1000)}: ` +
    `median ${latest.median_db.toFixed(1)} dB${p90}, of ${plural(latest.count, 'detection', 'detections')}. ` +
    `${plural(total, 'detection', 'detections')} in ${lastHours(series.hours)}.`
  );
}

/** A polyline through one percentile, lifted over every gap. */
function linePath(
  buckets: readonly SnrBucket[],
  key: Percentile,
  x: (t: number) => number,
  y: (v: number) => number,
): string {
  let d = '';
  let pen = false;
  for (const bucket of buckets) {
    const value = bucket[key];
    if (value === null) {
      pen = false;
      continue;
    }
    d += `${pen ? 'L' : 'M'}${x(bucket.t_ms).toFixed(1)},${y(value).toFixed(1)}`;
    pen = true;
  }
  return d;
}

function Swatch({ colour, dashed }: { colour: string; dashed?: boolean }) {
  return (
    <Svg width={18} height={10}>
      <Line
        x1={1}
        x2={17}
        y1={5}
        y2={5}
        stroke={colour}
        strokeWidth={2}
        strokeDasharray={dashed ? '5 3' : undefined}
      />
    </Svg>
  );
}

/**
 * An owned node's SNR per bucket: the median as a solid line, the 90th
 * percentile dashed (so the two part without colour), a dot for a bucket with
 * no neighbour. The window is the one the server read, ending now (`at`), so a
 * quiet hour is empty axis rather than an axis that starts later.
 */
export function SnrChart({ series, at }: { series: SnrSeries; at: number }): ReactElement {
  const chart = useChartTheme();
  const { spacing } = useTheme();
  const [width, setWidth] = useState(0);
  const { point, touchProps } = useChartTouch();

  const all = withGaps(series);
  const buckets = decimate(all, MAX_DRAWN_POINTS, [(b) => b.median_db, (b) => b.p90_db]);
  const bucketMs = series.bucket_s * 1000;
  const first = buckets.length > 0 ? buckets[0].t_ms : at;
  const last = buckets.length > 0 ? buckets[buckets.length - 1].t_ms : at;
  const start = Math.min(at - series.hours * HOUR_MS, first);
  const end = Math.max(at, last);

  const range = extent(buckets.flatMap((b) => [b.median_db, b.p90_db]));
  const yScale = niceTicks(range?.[0] ?? NaN, range?.[1] ?? NaN, 4);
  const yTexts = yScale.ticks.map((t) => tickLabel(t, yScale.step));
  const left = Math.ceil(Math.max(...yTexts.map((t) => t.length)) * CHAR) + 8;
  const right = Math.max(left + 1, width - 8);
  const top = 8;
  const bottom = top + PLOT_HEIGHT;
  const xTicks = timeTicks(start, end, Math.max(2, Math.floor((right - left) / TIME_TICK_ROOM)));
  const withDays = xTicks.some((tick) => tick.day !== null);
  const height = bottom + FONT + 10 + (withDays ? FONT + 4 : 0);

  const x = linearScale([start, end], [left, right]);
  const y = linearScale([yScale.min, yScale.max], [bottom, top]);
  const xs = buckets.map((b) => x(b.t_ms));
  const selected = point && width > 0 ? nearestIndex(xs, point.x) : -1;
  const active = selected >= 0 ? buckets[selected] : null;

  const summary = seriesSummary(series, all);
  const label =
    `SNR chart, median and 90th percentile per bucket in dB, ${lastHours(series.hours)}. ` +
    (summary ?? `No detections from this node in ${lastHours(series.hours)}.`);

  // Where a time label can sit without running off either edge.
  const labelAnchor = (px: number, text: string) =>
    px - (text.length * CHAR) / 2 < 0
      ? 'start'
      : px + (text.length * CHAR) / 2 > width
        ? 'end'
        : 'middle';

  return (
    <View style={{ gap: spacing.sm }}>
      <ChartReadout
        text={active ? bucketReadout(active, bucketMs) : null}
        hint="Touch or drag along the chart to read a bucket."
      />
      <View
        accessible
        accessibilityRole="image"
        accessibilityLabel={label}
        onLayout={(event) => setWidth(Math.floor(event.nativeEvent.layout.width))}
        style={{ height }}
        {...touchProps}
      >
        {width > 0 ? (
          <View style={{ pointerEvents: 'none' }}>
            <Svg width={width} height={height}>
              {yScale.ticks.map((t) => (
                <Line
                  key={`gy${t}`}
                  x1={left}
                  x2={right}
                  y1={y(t)}
                  y2={y(t)}
                  stroke={chart.grid}
                  strokeDasharray="3 3"
                />
              ))}
              {xTicks.map((tick) => (
                <Line
                  key={`gx${tick.t}`}
                  x1={x(tick.t)}
                  x2={x(tick.t)}
                  y1={top}
                  y2={bottom}
                  stroke={chart.grid}
                  strokeDasharray="3 3"
                />
              ))}
              <Line x1={left} x2={left} y1={top} y2={bottom} stroke={chart.axis} />
              <Line x1={left} x2={right} y1={bottom} y2={bottom} stroke={chart.axis} />
              {yScale.ticks.map((t, i) => (
                <SvgText
                  key={`ty${t}`}
                  x={left - 4}
                  y={y(t) + FONT * 0.35}
                  fontSize={FONT}
                  fill={chart.text}
                  textAnchor="end"
                >
                  {yTexts[i]}
                </SvgText>
              ))}
              {xTicks.map((tick) => (
                <SvgText
                  key={`tx${tick.t}`}
                  x={x(tick.t)}
                  y={bottom + FONT + 4}
                  fontSize={FONT}
                  fill={chart.text}
                  textAnchor={labelAnchor(x(tick.t), tick.label)}
                >
                  {tick.label}
                </SvgText>
              ))}
              {xTicks.map((tick) =>
                tick.day === null ? null : (
                  <SvgText
                    key={`td${tick.t}`}
                    x={x(tick.t)}
                    y={bottom + 2 * FONT + 8}
                    fontSize={FONT}
                    fill={chart.muted}
                    textAnchor={labelAnchor(x(tick.t), tick.day)}
                  >
                    {tick.day}
                  </SvgText>
                ),
              )}
              {active ? (
                <Line
                  x1={xs[selected]}
                  x2={xs[selected]}
                  y1={top}
                  y2={bottom}
                  stroke={chart.cursor}
                  strokeWidth={1}
                />
              ) : null}
              {(
                [
                  ['median_db', chart.series[0], undefined],
                  ['p90_db', chart.series[1], '5 3'],
                ] as const
              ).map(([key, colour, dash]) => {
                const d = linePath(buckets, key, x, y);
                return d === '' ? null : (
                  <Path
                    key={key}
                    d={d}
                    stroke={colour}
                    strokeWidth={2}
                    strokeDasharray={dash}
                    strokeLinejoin="round"
                    fill="none"
                  />
                );
              })}
              {buckets.flatMap((bucket, i) =>
                (['median_db', 'p90_db'] as const).map((key, k) => {
                  const value = bucket[key];
                  if (value === null || !isolated(buckets, i, key)) return null;
                  return (
                    <Circle
                      key={`d${key}${bucket.t_ms}`}
                      cx={xs[i]}
                      cy={y(value)}
                      r={3}
                      fill={chart.series[k]}
                    />
                  );
                }),
              )}
              {active
                ? (['median_db', 'p90_db'] as const).map((key, k) => {
                    const value = active[key];
                    if (value === null) return null;
                    return (
                      <Circle
                        key={`a${key}`}
                        cx={xs[selected]}
                        cy={y(value)}
                        r={4}
                        fill={chart.series[k]}
                        stroke={chart.surface}
                        strokeWidth={2}
                      />
                    );
                  })
                : null}
            </Svg>
          </View>
        ) : null}
      </View>
      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          justifyContent: 'center',
          gap: spacing.lg,
        }}
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
          <Swatch colour={chart.series[0]} />
          <ThemedText variant="caption" color="secondary">
            Median (dB)
          </ThemedText>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
          <Swatch colour={chart.series[1]} dashed />
          <ThemedText variant="caption" color="secondary">
            90th percentile (dB)
          </ThemedText>
        </View>
      </View>
      {summary ? (
        <ThemedText
          variant="caption"
          color="muted"
          importantForAccessibility="no"
          accessibilityElementsHidden
        >
          {summary}
        </ThemedText>
      ) : null}
    </View>
  );
}
