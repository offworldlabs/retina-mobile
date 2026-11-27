import { useState, type ReactElement } from 'react';
import { Pressable, View } from 'react-native';

import { userMessage, type SnrSeries } from '@/api';
import { ThemedText } from '@/components';
import { Notice } from '@/features/network';
import { useNow } from '@/features/nodes/clock';
import { useTheme } from '@/theme';
import { ChartCard } from './BarChart';
import { clock, dayLabel } from './scale';
import { lastHours, SnrChart } from './SnrChart';

/** The windows a viewer can pick, in hours; the server takes 1 to 72. */
export const SNR_HOURS: readonly number[] = [1, 6, 24, 72];
/** The web's window for the owned SNR series. */
export const DEFAULT_SNR_HOURS = 24;
/** The contract's bucket, which titles the card until a series names its own. */
const BUCKET_S = 300;

/** The card's title: what it shows over which window, in which buckets. */
export function seriesTitle(hours: number, bucketS: number): string {
  const bucket = bucketS % 60 === 0 ? `${bucketS / 60}-minute` : `${bucketS}-second`;
  return `SNR, ${lastHours(hours).replace(/^the /, '')} · ${bucket} buckets`;
}

/** How recent the series is: its newest detection, with the date when that
 *  was not on the day the answer came. */
export function throughLabel(throughMs: number, answeredAt: number): string {
  const sameDay = new Date(throughMs).toDateString() === new Date(answeredAt).toDateString();
  return `through ${clock(throughMs)}${sameDay ? '' : ` on ${dayLabel(throughMs)}`}`;
}

// How often the window's end moves on while the page is on screen. The server
// keeps a series for a minute; a quarter of that keeps the "loaded at" time
// within its minute. The chart's window ends at this time, as the web's ends
// when its answer came, and keeps moving when a refresh brings back the same
// series.
const CLOCK_MS = 15_000;

/** When the series on screen came in, to the clock's step: taken when a new
 *  series object arrives and kept while it stays on screen. */
function useLoadedAt(series: SnrSeries | null, now: number): number | null {
  const [seen, setSeen] = useState(() => ({ series, at: series ? now : null }));
  if (seen.series !== series) {
    const next = { series, at: series ? now : null };
    setSeen(next);
    return next.at;
  }
  return seen.at;
}

function HoursSwitch({ hours, onChange }: { hours: number; onChange: (hours: number) => void }) {
  const { colors, spacing, radius } = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: spacing.sm }}>
      {SNR_HOURS.map((option) => {
        const selected = option === hours;
        const text = `${option} h`;
        return (
          <Pressable
            key={option}
            accessibilityRole="button"
            accessibilityLabel={text}
            accessibilityState={{ selected }}
            onPress={() => {
              if (!selected) onChange(option);
            }}
            style={({ pressed }) => ({
              flex: 1,
              minHeight: 44,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: radius.md,
              borderWidth: 1,
              borderColor: selected ? colors.accent : colors.borderStrong,
              backgroundColor: selected
                ? colors.accent
                : pressed
                  ? colors.bgCardHover
                  : colors.bgCard,
            })}
          >
            <ThemedText
              variant="label"
              style={{ color: selected ? colors.accentInk : colors.textPrimary }}
            >
              {text}
            </ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

function EmptyState({ text }: { text: string }) {
  const { spacing } = useTheme();
  return (
    <View
      style={{
        minHeight: 160,
        alignItems: 'center',
        justifyContent: 'center',
        padding: spacing.xl,
      }}
    >
      <ThemedText color="secondary" style={{ textAlign: 'center' }}>
        {text}
      </ThemedText>
    </View>
  );
}

interface SnrPanelProps {
  series: SnrSeries | null;
  hours: number;
  onHoursChange: (hours: number) => void;
  isLoading: boolean;
  error: unknown | null;
}

/** An owned node's detection SNR per bucket over the window picked, as the
 *  web's owned SNR card shows it, with the window switch the app adds. */
export function SnrPanel({
  series,
  hours,
  onHoursChange,
  isLoading,
  error,
}: SnrPanelProps): ReactElement {
  const { spacing } = useTheme();
  const now = useNow(CLOCK_MS);
  const at = useLoadedAt(series, now);
  // The window asked for titles the card until an answer names its own.
  const window = series?.hours ?? hours;

  let notice: string | null = null;
  if (error) {
    const message = userMessage(error);
    notice =
      series && at !== null
        ? `Could not refresh this node's SNR history: ${message.replace(/\.$/, '')}. Showing what was loaded at ${clock(at)}.`
        : `Could not load this node's SNR history: ${message}`;
  }

  let body: ReactElement | null = null;
  if (series && series.points.length > 0) {
    body = <SnrChart series={series} at={now} />;
  } else if (series) {
    body = <EmptyState text={`No detections from this node in ${lastHours(window)}.`} />;
  } else if (isLoading) {
    body = <EmptyState text="Loading…" />;
  }

  return (
    <ChartCard title={seriesTitle(window, series?.bucket_s ?? BUCKET_S)}>
      {series?.through_ms != null && at !== null ? (
        <ThemedText variant="caption" color="muted" style={{ marginTop: -spacing.md }}>
          {throughLabel(series.through_ms, at)}
        </ThemedText>
      ) : null}
      <HoursSwitch hours={hours} onChange={onHoursChange} />
      {notice ? <Notice tone="warning" text={notice} /> : null}
      {body}
    </ChartCard>
  );
}
