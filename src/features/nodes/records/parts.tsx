import { View } from 'react-native';

import { ThemedText } from '@/components';
import { useTheme, type Palette, type TypeVariant } from '@/theme';

import {
  DASH,
  moment,
  type BadgeTone,
  type DotTone,
  type RecordRow,
  type RecordValue,
} from './values';

const BADGE_COLOR: Record<BadgeTone, keyof Palette> = {
  online: 'success',
  offline: 'error',
  warning: 'warning',
  info: 'accent',
  private: 'textMuted',
};

const DOT_COLOR: Record<DotTone, keyof Palette> = {
  accent: 'accent',
  success: 'success',
  warning: 'warning',
  error: 'error',
  neutral: 'textMuted',
};

/** A small round mark in a tone. Decoration: the words beside it say the same. */
export function Dot({ tone }: { tone: DotTone }) {
  const { colors, spacing, radius } = useTheme();
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={{
        width: spacing.md,
        height: spacing.md,
        borderRadius: radius.sm,
        backgroundColor: colors[DOT_COLOR[tone]],
      }}
    />
  );
}

/** A state as a pill with its tone's dot, as the node list draws a node's status. */
export function Badge({ text, tone }: { text: string; tone: BadgeTone }) {
  const { colors, spacing, radius } = useTheme();
  return (
    <View
      style={{
        alignSelf: 'flex-start',
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        paddingHorizontal: spacing.md,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.bgSunk,
      }}
    >
      <View
        style={{
          width: spacing.md,
          height: spacing.md,
          borderRadius: radius.sm,
          backgroundColor: colors[BADGE_COLOR[tone]],
        }}
      />
      <ThemedText variant="caption" color="secondary">
        {text}
      </ThemedText>
    </View>
  );
}

/** A count beside a heading, with no dot. */
export function CountBadge({ count }: { count: number }) {
  const { colors, spacing, radius } = useTheme();
  return (
    <View
      style={{
        paddingHorizontal: spacing.md,
        borderRadius: radius.md,
        backgroundColor: colors.accentWash,
      }}
    >
      <ThemedText
        variant="caption"
        color="accent"
        style={{ fontWeight: '600', fontVariant: ['tabular-nums'] }}
      >
        {count}
      </ThemedText>
    </View>
  );
}

/** The heading of one part of a card, in the reading-label's voice. */
export function Subhead({ text }: { text: string }) {
  return (
    <ThemedText
      variant="micro"
      color="secondary"
      accessibilityRole="header"
      style={{ fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.55 }}
    >
      {text}
    </ThemedText>
  );
}

/** A card's whole answer when there is nothing to list. */
export function Note({ text }: { text: string }) {
  const { spacing } = useTheme();
  return (
    <ThemedText
      variant="body"
      color="secondary"
      style={{ textAlign: 'center', paddingVertical: spacing.lg }}
    >
      {text}
    </ThemedText>
  );
}

/** A moment as how long ago it was, with the exact local time after it, wrapping under it where
 *  the line is narrow. A stamp that is missing or does not parse reads as a dash. */
export function When({
  at,
  now,
  variant = 'body',
  bold = false,
}: {
  at: string | null;
  now: number;
  variant?: TypeVariant;
  bold?: boolean;
}) {
  const { spacing } = useTheme();
  const stamp = moment(at, now);
  const weight = bold ? ({ fontWeight: '600' } as const) : undefined;
  if (!stamp) {
    return (
      <ThemedText variant={variant} style={weight}>
        {DASH}
      </ThemedText>
    );
  }
  return (
    <View
      style={{
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'baseline',
        columnGap: spacing.md,
      }}
    >
      <ThemedText variant={variant} style={weight}>
        {stamp.relative}
      </ThemedText>
      <ThemedText variant="caption" color="muted" style={{ fontVariant: ['tabular-nums'] }}>
        {stamp.exact}
      </ThemedText>
    </View>
  );
}

export function Value({ value, now }: { value: RecordValue; now: number }) {
  if (value.kind === 'badge') return <Badge text={value.text} tone={value.tone} />;
  if (value.kind === 'time') return <When at={value.at} now={now} />;
  return <ThemedText variant={value.mono ? 'mono' : 'body'}>{value.text}</ThemedText>;
}

/** One part of a card as label-and-reading rows, or its empty line. */
export function Readings({
  title,
  rows,
  empty,
  now,
}: {
  title: string;
  rows: readonly RecordRow[];
  empty: string;
  now: number;
}) {
  const { colors, spacing } = useTheme();
  return (
    <View style={{ gap: spacing.xs }}>
      <Subhead text={title} />
      {rows.length ? (
        rows.map((row, i) => (
          <View
            key={row.key}
            style={{
              flexDirection: 'row',
              alignItems: 'flex-start',
              gap: spacing.lg,
              paddingVertical: spacing.md,
              borderBottomWidth: i < rows.length - 1 ? 1 : 0,
              borderBottomColor: colors.border,
            }}
          >
            <ThemedText variant="body" color="secondary" style={{ width: '45%' }}>
              {row.label}
            </ThemedText>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Value value={row.value} now={now} />
            </View>
          </View>
        ))
      ) : (
        <ThemedText variant="caption" color="secondary">
          {empty}
        </ThemedText>
      )}
    </View>
  );
}
