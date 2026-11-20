import type { ReactNode } from 'react';
import { View } from 'react-native';

import { ThemedText } from './ThemedText';
import { useTheme } from '@/theme';

export type PlaceholderProps = {
  title: string;
  description: string;
  children?: ReactNode;
};

export function Placeholder({ title, description, children }: PlaceholderProps) {
  const { colors, spacing, radius } = useTheme();
  return (
    <View
      accessible
      accessibilityLabel={`${title}. ${description}`}
      style={{
        padding: spacing.xl,
        gap: spacing.md,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.bgCard,
      }}
    >
      <ThemedText variant="heading">{title}</ThemedText>
      <ThemedText color="secondary">{description}</ThemedText>
      {children}
    </View>
  );
}
