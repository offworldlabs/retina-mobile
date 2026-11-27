import { useRef, useState, type ReactElement } from 'react';
import {
  PanResponder,
  View,
  type GestureResponderEvent,
  type GestureResponderHandlers,
  type ViewProps,
} from 'react-native';

import { ThemedText } from '@/components';
import { useTheme } from '@/theme';
import { useChartTheme } from './theme';

/** Where a finger is on a chart, in the chart's own coordinates. */
export interface TouchPoint {
  x: number;
  y: number;
}

type TouchProps = GestureResponderHandlers &
  Pick<ViewProps, 'onTouchStart' | 'onTouchMove' | 'onTouchEnd' | 'onTouchCancel'>;

// A move this far sideways, and clearly more sideways than down, is a scrub
// along the chart rather than the start of a scroll.
const SCRUB_SLOP = 6;
const SCRUB_RATIO = 1.5;

/**
 * The finger's place on a chart, for its readout. Charts sit in a vertical
 * ScrollView, so a touch is never claimed at its start: the raw touch events
 * place the readout (they reach the view whoever holds the responder), a
 * vertical move is left to the ScrollView, whose native gesture then cancels
 * the touch and clears the readout, and a sideways move makes the chart the
 * responder with the native responder blocked, so the page holds still while
 * the finger scrubs. The point stays after the finger lifts, so the readout
 * can be read without a finger on the glass.
 *
 * The plot inside must have pointerEvents="none", so these events come from
 * the view these props are spread on and their locations are in its frame.
 */
export function useChartTouch(): { point: TouchPoint | null; touchProps: TouchProps } {
  const [point, setPoint] = useState<TouchPoint | null>(null);
  const origin = useRef<{ x: number; y: number; pageX: number; pageY: number } | null>(null);
  const [responder] = useState(() =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_event, gesture) =>
        Math.abs(gesture.dx) > SCRUB_SLOP &&
        Math.abs(gesture.dx) > Math.abs(gesture.dy) * SCRUB_RATIO,
      onPanResponderTerminationRequest: () => false,
      onShouldBlockNativeResponder: () => true,
    }),
  );

  const start = (event: GestureResponderEvent) => {
    const { locationX, locationY, pageX, pageY } = event.nativeEvent;
    origin.current = { x: locationX, y: locationY, pageX, pageY };
    setPoint({ x: locationX, y: locationY });
  };
  // From the page position and the start, not locationX: a move's location is
  // in the frame of whatever view is under the finger at that moment.
  const move = (event: GestureResponderEvent) => {
    const from = origin.current;
    if (!from) return;
    const { pageX, pageY } = event.nativeEvent;
    setPoint({ x: from.x + pageX - from.pageX, y: from.y + pageY - from.pageY });
  };
  const end = () => {
    origin.current = null;
  };
  const cancel = () => {
    origin.current = null;
    setPoint(null);
  };

  return {
    point,
    touchProps: {
      ...responder.panHandlers,
      onTouchStart: start,
      onTouchMove: move,
      onTouchEnd: end,
      onTouchCancel: cancel,
    },
  };
}

/** The touch readout: a caption row above the plot, sized for two lines so
 *  the plot does not move as the text comes and goes. Without a reading it
 *  shows the hint, or stays empty. */
export function ChartReadout({ text, hint }: { text: string | null; hint?: string }): ReactElement {
  const chart = useChartTheme();
  const { spacing, radius } = useTheme();
  const shown = text ?? hint ?? null;
  return (
    <View
      style={{
        minHeight: 44,
        justifyContent: 'center',
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.xs,
        borderRadius: radius.sm,
        backgroundColor: text === null ? 'transparent' : chart.readoutBg,
      }}
    >
      {shown !== null ? (
        <ThemedText variant="caption" color={text === null ? 'muted' : 'primary'}>
          {shown}
        </ThemedText>
      ) : null}
    </View>
  );
}
