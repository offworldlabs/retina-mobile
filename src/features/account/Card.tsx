import type { ReactNode } from 'react';
import { View } from 'react-native';

import { ThemedText } from '@/components';
import { useTheme } from '@/theme';

export type CardProps = {
  title: string;
  /** Shown at the right of the title, such as a button for the whole card. */
  action?: ReactNode;
  children?: ReactNode;
};

/** A titled card of the account screens. */
export function Card({ title, action, children }: CardProps) {
  const { colors, spacing, radius } = useTheme();
  return (
    <View
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
        <ThemedText variant="heading" accessibilityRole="header" style={{ flex: 1 }}>
          {title}
        </ThemedText>
        {action}
      </View>
      {children}
    </View>
  );
}
