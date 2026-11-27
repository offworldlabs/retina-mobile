import { useState, type ReactElement, type ReactNode } from 'react';
import { View } from 'react-native';
import Svg, { Line, Path, Rect, Text as SvgText } from 'react-native-svg';

import { ThemedText } from '@/components';
import { useTheme } from '@/theme';
import { ChartReadout, useChartTouch, type TouchPoint } from './Readout';
import { bandIndex, linearScale, niceTicks, tickLabel } from './scale';
import { useChartTheme } from './theme';

export interface BarDatum {
  label: string;
  value: number;
}

// Labels are estimated rather than measured, since the layout is needed before
// anything is drawn: 0.6 of the font size is an average advance that errs
// wide, so a label the estimate says fits does fit (the web's rule too).
const FONT = 11;
const CHAR = FONT * 0.6;
const TICK_GAP = 5;
// A bar on its side gets a 28 px row, over the 24 px minimum touch target, as
// on the web's phone layout; its label column takes at most 40% of the width.
const ROW = 28;
const CATEGORY_SHARE = 0.4;
// Each bar fills 80% of its band, Recharts' default gap.
const FILL = 0.8;
const RADIUS = 4;
// Room per value tick along a sideways chart's axis.
const VALUE_TICK_ROOM = 56;

const r1 = (v: number) => Math.round(v * 10) / 10;

/** A bar with its value end rounded, the end facing `side`. */
function barPath(
  x: number,
  y: number,
  w: number,
  h: number,
  side: 'top' | 'bottom' | 'right' | 'left',
) {
  const [X, Y, W, H] = [r1(x), r1(y), r1(w), r1(h)];
  const r = r1(Math.max(0, Math.min(RADIUS, W / 2, H / 2)));
  if (r === 0) return `M${X},${Y}h${W}v${H}h${-W}Z`;
  switch (side) {
    case 'top':
      return `M${X},${Y + H}V${Y + r}Q${X},${Y} ${X + r},${Y}H${X + W - r}Q${X + W},${Y} ${X + W},${Y + r}V${Y + H}Z`;
    case 'bottom':
      return `M${X},${Y}H${X + W}V${Y + H - r}Q${X + W},${Y + H} ${X + W - r},${Y + H}H${X + r}Q${X},${Y + H} ${X},${Y + H - r}Z`;
    case 'right':
      return `M${X},${Y}H${X + W - r}Q${X + W},${Y} ${X + W},${Y + r}V${Y + H - r}Q${X + W},${Y + H} ${X + W - r},${Y + H}H${X}Z`;
    case 'left':
      return `M${X + W},${Y}V${Y + H}H${X + r}Q${X},${Y + H} ${X},${Y + H - r}V${Y + r}Q${X},${Y} ${X + r},${Y}Z`;
  }
}

/** A label cut with an ellipsis to the characters that fit in `room` px. */
function fit(label: string, room: number): string {
  const chars = Math.max(1, Math.floor(room / CHAR));
  return label.length > chars ? `${label.slice(0, Math.max(1, chars - 1))}…` : label;
}

interface Tick {
  at: number;
  text: string;
}

interface BarShape {
  d: string;
  label: string;
  labelX: number;
  labelY: number;
  /** The band behind the bar, drawn as the cursor when it is touched. */
  band: { x: number; y: number; w: number; h: number };
}

interface BarLayout {
  sideways: boolean;
  height: number;
  /** The plot's edges. */
  left: number;
  right: number;
  top: number;
  bottom: number;
  ticks: Tick[];
  bars: BarShape[];
  hit: (point: TouchPoint) => number;
}

/**
 * Where everything goes. Bars stand upright when every label fits flat under
 * its bar; otherwise (a phone and several long node names) they turn on their
 * side, one 28 px row each with the labels in a column on the left, which is
 * what the web dashboard does at phone width. The value axis always takes 0,
 * so a bar's length is its value.
 */
function layoutBars(
  data: readonly BarDatum[],
  width: number,
  plotHeight: number,
): BarLayout | null {
  const n = data.length;
  if (n === 0 || width <= 0) return null;
  const values = data.map((bar) => (Number.isFinite(bar.value) ? bar.value : 0));
  const lo = Math.min(0, ...values);
  const hi = Math.max(0, ...values);
  const longest = Math.max(...data.map((bar) => bar.label.length));

  const yScale = niceTicks(lo, hi, 4);
  const yTexts = yScale.ticks.map((t) => tickLabel(t, yScale.step));
  const yAxis = Math.ceil(Math.max(...yTexts.map((t) => t.length)) * CHAR) + 8;
  const uprightBand = (width - yAxis - 8) / n;

  if (longest * CHAR + TICK_GAP <= uprightBand) {
    const [left, right, top, bottom] = [yAxis, width - 8, 8, 8 + plotHeight];
    const y = linearScale([yScale.min, yScale.max], [bottom, top]);
    const zero = y(0);
    const band = (right - left) / n;
    return {
      sideways: false,
      height: bottom + FONT + 12,
      left,
      right,
      top,
      bottom,
      ticks: yScale.ticks.map((t, i) => ({ at: y(t), text: yTexts[i] })),
      bars: values.map((value, i) => {
        const end = y(value);
        const x = left + i * band + (band * (1 - FILL)) / 2;
        return {
          d: barPath(
            x,
            Math.min(zero, end),
            band * FILL,
            Math.abs(zero - end),
            value < 0 ? 'bottom' : 'top',
          ),
          label: fit(data[i].label, band - 2),
          labelX: left + (i + 0.5) * band,
          labelY: bottom + FONT + 4,
          band: { x: left + i * band, y: top, w: band, h: bottom - top },
        };
      }),
      hit: (point) => bandIndex(point.x, left, band, n),
    };
  }

  const left = Math.min(Math.ceil(longest * CHAR + 8), Math.floor(width * CATEGORY_SHARE));
  const [right, top] = [width - 12, 4];
  const bottom = top + n * ROW;
  const xScale = niceTicks(lo, hi, Math.max(2, Math.floor((right - left) / VALUE_TICK_ROOM)));
  const x = linearScale([xScale.min, xScale.max], [left, right]);
  const zero = x(0);
  return {
    sideways: true,
    height: bottom + FONT + 12,
    left,
    right,
    top,
    bottom,
    ticks: xScale.ticks.map((t) => ({ at: x(t), text: tickLabel(t, xScale.step) })),
    bars: values.map((value, i) => {
      const end = x(value);
      const y = top + i * ROW + (ROW * (1 - FILL)) / 2;
      return {
        d: barPath(
          Math.min(zero, end),
          y,
          Math.abs(end - zero),
          ROW * FILL,
          value < 0 ? 'left' : 'right',
        ),
        label: fit(data[i].label, left - 8),
        labelX: left - 6,
        labelY: top + (i + 0.5) * ROW + FONT * 0.35,
        band: { x: left, y: top + i * ROW, w: right - left, h: ROW },
      };
    }),
    hit: (point) => bandIndex(point.y, top, ROW, n),
  };
}

interface BarChartProps {
  bars: readonly BarDatum[];
  /** The plot's height when the bars stand upright. */
  height: number;
  /** A bar's readout text. */
  readout: (bar: BarDatum) => string;
  accessibilityLabel: string;
  hint?: string;
}

/** Bars of one series, with a touch readout of the bar under the finger. */
export function BarChart({ bars, height, readout, accessibilityLabel, hint }: BarChartProps) {
  const chart = useChartTheme();
  const { spacing } = useTheme();
  const [width, setWidth] = useState(0);
  const { point, touchProps } = useChartTouch();
  const layout = layoutBars(bars, width, height);
  const selected = layout && point ? layout.hit(point) : -1;
  const reading = selected >= 0 ? readout(bars[selected]) : null;

  return (
    <View style={{ gap: spacing.sm }}>
      <ChartReadout text={reading} hint={hint} />
      <View
        accessible
        accessibilityRole="image"
        accessibilityLabel={accessibilityLabel}
        onLayout={(event) => setWidth(Math.floor(event.nativeEvent.layout.width))}
        style={{ height: layout ? layout.height : height + FONT + 20 }}
        {...touchProps}
      >
        {layout ? (
          <View style={{ pointerEvents: 'none' }}>
            <Svg width={width} height={layout.height}>
              {selected >= 0 ? (
                <Rect
                  x={layout.bars[selected].band.x}
                  y={layout.bars[selected].band.y}
                  width={layout.bars[selected].band.w}
                  height={layout.bars[selected].band.h}
                  fill={chart.cursor}
                  opacity={0.5}
                />
              ) : null}
              {layout.ticks.map((tick) =>
                layout.sideways ? (
                  <Line
                    key={`g${tick.text}`}
                    x1={tick.at}
                    x2={tick.at}
                    y1={layout.top}
                    y2={layout.bottom}
                    stroke={chart.grid}
                    strokeDasharray="3 3"
                  />
                ) : (
                  <Line
                    key={`g${tick.text}`}
                    x1={layout.left}
                    x2={layout.right}
                    y1={tick.at}
                    y2={tick.at}
                    stroke={chart.grid}
                    strokeDasharray="3 3"
                  />
                ),
              )}
              {layout.bars.map((bar, i) => (
                <Path key={`b${i}`} d={bar.d} fill={chart.series[0]} />
              ))}
              <Line
                x1={layout.left}
                x2={layout.sideways ? layout.left : layout.right}
                y1={layout.bottom}
                y2={layout.sideways ? layout.top : layout.bottom}
                stroke={chart.axis}
              />
              <Line
                x1={layout.left}
                x2={layout.sideways ? layout.right : layout.left}
                y1={layout.sideways ? layout.bottom : layout.top}
                y2={layout.bottom}
                stroke={chart.axis}
              />
              {layout.ticks.map((tick, i) =>
                layout.sideways ? (
                  <SvgText
                    key={`t${tick.text}`}
                    x={tick.at}
                    y={layout.bottom + FONT + 4}
                    fontSize={FONT}
                    fill={chart.text}
                    textAnchor={
                      i === layout.ticks.length - 1 ? 'end' : i === 0 ? 'start' : 'middle'
                    }
                  >
                    {tick.text}
                  </SvgText>
                ) : (
                  <SvgText
                    key={`t${tick.text}`}
                    x={layout.left - 4}
                    y={tick.at + FONT * 0.35}
                    fontSize={FONT}
                    fill={chart.text}
                    textAnchor="end"
                  >
                    {tick.text}
                  </SvgText>
                ),
              )}
              {layout.bars.map((bar, i) => (
                <SvgText
                  key={`l${i}`}
                  x={bar.labelX}
                  y={bar.labelY}
                  fontSize={FONT}
                  fill={chart.text}
                  textAnchor={layout.sideways ? 'end' : 'middle'}
                >
                  {bar.label}
                </SvgText>
              ))}
            </Svg>
          </View>
        ) : null}
      </View>
    </View>
  );
}

/** A chart's card, as the node pages draw theirs. */
export function ChartCard({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}): ReactElement {
  const { colors, spacing, radius } = useTheme();
  return (
    <View
      style={{
        padding: spacing.xl,
        gap: spacing.lg,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.bgCard,
      }}
    >
      <ThemedText variant="heading" accessibilityRole="header">
        {title}
      </ThemedText>
      {children}
    </View>
  );
}

/** "1 detection", "1,234 detections", as the web counts them. */
export function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}
