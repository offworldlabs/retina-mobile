import { View } from 'react-native';

import { ThemedText } from '@/components';
import { useTheme } from '@/theme';

export type NetworkSummaryProps = {
  online: number;
  total: number;
  /** Epoch ms of the last successful update. */
  updatedAt: number;
};

export function NetworkSummary({ online, total, updatedAt }: NetworkSummaryProps) {
  const { colors, spacing, radius } = useTheme();
  const updated = new Date(updatedAt).toLocaleTimeString();
  const dot =
    total === 0
      ? colors.textMuted
      : online === total
        ? colors.success
        : online === 0
          ? colors.error
          : colors.warning;
  return (
    <View
      accessible
      accessibilityLabel={`Nodes online: ${online} of ${total}. Updated ${updated}`}
      style={{
        padding: spacing.xl,
        gap: spacing.md,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.bgCard,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
        <View
          style={{
            width: spacing.md,
            height: spacing.md,
            borderRadius: radius.sm,
            backgroundColor: dot,
          }}
        />
        <ThemedText variant="label" color="secondary">
          Nodes online
        </ThemedText>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: spacing.md }}>
        <ThemedText variant="figure">{online}</ThemedText>
        <ThemedText color="secondary">of {total}</ThemedText>
      </View>
      <ThemedText variant="caption" color="muted">
        Updated {updated}
      </ThemedText>
    </View>
  );
}
