import type { ReactNode } from 'react';
import { Platform, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from './ThemedText';
import { useTheme } from '@/theme';

export type ScreenProps = {
  title: string;
  children: ReactNode;
  /** Add the bottom safe-area inset on Android; leave off inside the tab bar, which already insets. */
  bottomInset?: boolean;
};

export function Screen({ title, children, bottomInset = false }: ScreenProps) {
  const { colors, spacing } = useTheme();
  const insets = useSafeAreaInsets();
  const android = Platform.OS === 'android';
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bgPrimary }}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{
        padding: spacing.xl,
        gap: spacing.xl,
        paddingTop: spacing.xl + (android ? insets.top : 0),
        paddingBottom: spacing.xl + (android && bottomInset ? insets.bottom : 0),
        paddingLeft: spacing.xl + (android ? insets.left : 0),
        paddingRight: spacing.xl + (android ? insets.right : 0),
      }}
    >
      <ThemedText variant="title" accessibilityRole="header">
        {title}
      </ThemedText>
      {children}
    </ScrollView>
  );
}
