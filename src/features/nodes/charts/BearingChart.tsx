import { useState } from 'react';
import { View } from 'react-native';
import Svg, { Circle, Line, Path, Text as SvgText } from 'react-native-svg';

import { ThemedText } from '@/components';
import { useTheme } from '@/theme';

import {
  BEARING_STEP_DEG,
  bearingPath,
  bearingReadout,
  bearingSummary,
  binPoint,
  COMPASS,
  measuredBins,
  nearestBin,
  PD_RINGS,
  pdText,
  polarPoint,
  type Polar,
} from './performance';
import { ChartReadout, useChartTouch, type TouchPoint } from './Readout';
import { useChartTheme } from './theme';

/** A compass wants to be square, so it stops growing with the card. */
const MAX_SIZE = 320;
/** The 100% ring's radius as a share of half the chart, as the web's outerRadius="82%". */
const OUTER = 0.82;
/** The compass letters sit this far outside the 100% ring. */
const LABEL_OFFSET = 14;
/** The ring labels run along this bearing, as the web's radius axis at 45 degrees. */
const RING_LABEL_BEARING = 45;

const HINT = 'Touch or drag around the chart to read a bearing.';
const BIN_COUNT = 360 / BEARING_STEP_DEG;

/**
 * Share detected in each 5° of bearing, north up and clockwise, with rings at 25, 50, 75 and 100%.
 * A bin with no figure breaks the line; every measured bin has a dot, so a lone one still shows.
 *
 * Touch and the page's scroll, as on every chart of the page (useChartTouch): a touch is never
 * claimed at its start, so a tap reads the bin nearest the finger by its bearing from the centre;
 * a vertical drag is left to the ScrollView, which scrolls the page and clears the readout; a
 * sideways drag makes the chart the responder with the native responder blocked, so the finger
 * can then sweep round the compass, reading bin after bin, while the page holds still. A screen
 * reader steps through the bins with the adjustable actions instead.
 */
export function BearingChart({ bins }: { bins: readonly (number | null)[] }) {
  const { colors, spacing } = useTheme();
  const chart = useChartTheme();
  const [size, setSize] = useState(0);
  const { point, touchProps } = useChartTouch();
  // A screen reader's step holds until the next touch moves the finger's point.
  const [stepped, setStepped] = useState<{ index: number; over: TouchPoint | null } | null>(null);

  const polar: Polar = { cx: size / 2, cy: size / 2, radius: (size / 2) * OUTER };
  const ink = chart.series[0] ?? colors.accent;
  const active =
    stepped && stepped.over === point
      ? stepped.index
      : point && size > 0
        ? nearestBin(point.x, point.y, polar)
        : null;
  const readout = active === null ? null : bearingReadout(bins, active);
  const step = (by: number) => {
    const from = active ?? (by > 0 ? -1 : 0);
    setStepped({ index: (from + by + BIN_COUNT) % BIN_COUNT, over: point });
  };

  const path = size > 0 ? bearingPath(bins, polar) : '';
  const activePd = active === null ? null : (bins[active] ?? null);
  const cursorEnd = active === null ? null : polarPoint(active * BEARING_STEP_DEG, 1, polar);

  return (
    <View style={{ gap: spacing.md }}>
      <ThemedText variant="label" accessibilityRole="header">
        Detection by bearing
      </ThemedText>
      <ThemedText variant="caption" color="muted">
        Share detected in each 5° of bearing. A gap means nothing was measured there.
      </ThemedText>
      <ChartReadout text={readout} hint={HINT} />
      <View
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={bearingSummary(bins)}
        accessibilityValue={readout ? { text: readout } : undefined}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(event) =>
          step(event.nativeEvent.actionName === 'increment' ? 1 : -1)
        }
        onLayout={(event) => setSize(Math.floor(event.nativeEvent.layout.width))}
        style={{ width: '100%', maxWidth: MAX_SIZE, aspectRatio: 1, alignSelf: 'center' }}
        {...touchProps}
      >
        {size > 0 && (
          <View style={{ pointerEvents: 'none' }}>
            <Svg width={size} height={size}>
              {PD_RINGS.map((share) => (
                <Circle
                  key={share}
                  cx={polar.cx}
                  cy={polar.cy}
                  r={polar.radius * share}
                  fill="none"
                  stroke={share === 1 ? chart.axis : chart.grid}
                  strokeWidth={1}
                />
              ))}
              {COMPASS.map(([bearing]) => {
                const end = polarPoint(bearing, 1, polar);
                return (
                  <Line
                    key={bearing}
                    x1={polar.cx}
                    y1={polar.cy}
                    x2={end.x}
                    y2={end.y}
                    stroke={chart.grid}
                    strokeWidth={1}
                  />
                );
              })}
              {PD_RINGS.map((share) => {
                const at = polarPoint(RING_LABEL_BEARING, share, polar);
                return (
                  <SvgText
                    key={share}
                    x={at.x + 3}
                    y={at.y - 3}
                    fontSize={10}
                    fill={chart.muted}
                    textAnchor="start"
                  >
                    {pdText(share)}
                  </SvgText>
                );
              })}
              {COMPASS.map(([bearing, letter]) => {
                const at = polarPoint(bearing, 1, {
                  ...polar,
                  radius: polar.radius + LABEL_OFFSET,
                });
                return (
                  <SvgText
                    key={letter}
                    x={at.x}
                    y={at.y + 4}
                    fontSize={12}
                    fontWeight="600"
                    fill={chart.text}
                    textAnchor="middle"
                  >
                    {letter}
                  </SvgText>
                );
              })}
              {cursorEnd && (
                <Line
                  x1={polar.cx}
                  y1={polar.cy}
                  x2={cursorEnd.x}
                  y2={cursorEnd.y}
                  stroke={chart.cursor}
                  strokeWidth={1}
                />
              )}
              {path !== '' && (
                <Path
                  d={path}
                  fill="none"
                  stroke={ink}
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              )}
              {measuredBins(bins).map((index) => {
                const at = binPoint(bins, index, polar);
                return <Circle key={index} cx={at.x} cy={at.y} r={3} fill={ink} />;
              })}
              {active !== null && activePd !== null && (
                <Circle
                  cx={binPoint(bins, active, polar).x}
                  cy={binPoint(bins, active, polar).y}
                  r={5}
                  fill={ink}
                  stroke={colors.bgCard}
                  strokeWidth={2}
                />
              )}
            </Svg>
          </View>
        )}
      </View>
    </View>
  );
}
