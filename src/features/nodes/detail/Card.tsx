import type { ReactNode } from 'react';
import { View } from 'react-native';

import { ThemedText } from '@/components';
import { useTheme } from '@/theme';

export function Card({ title, children }: { title?: string; children: ReactNode }) {
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
      {title ? (
        <ThemedText variant="heading" accessibilityRole="header">
          {title}
        </ThemedText>
      ) : null}
      {children}
    </View>
  );
}

/** A label with its value beside it, wrapping under it when the value is long. */
export function Row({ label, value }: { label: string; value: string }) {
  const { spacing } = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'space-between',
        gap: spacing.md,
      }}
    >
      <ThemedText color="secondary">{label}</ThemedText>
      <ThemedText style={{ flexShrink: 1 }}>{value}</ThemedText>
    </View>
  );
}
