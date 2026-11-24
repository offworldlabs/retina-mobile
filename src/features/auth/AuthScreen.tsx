import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components';
import { useTheme } from '@/theme';

export type AuthScreenProps = {
  children: ReactNode;
  title?: string;
  /** Centre the content vertically, for a screen that shows one state at a time. */
  centered?: boolean;
};

/**
 * A modal of the sign-in flow: the look and insets of Screen, with the keyboard kept off the
 * content and taps on buttons going through while it is up.
 */
export function AuthScreen({ children, title, centered = false }: AuthScreenProps) {
  const { colors, spacing } = useTheme();
  const insets = useSafeAreaInsets();
  const android = Platform.OS === 'android';
  return (
    <KeyboardAvoidingView
      // As Expo's keyboard guide has it: padding on iOS, while Android resizes the window itself.
      behavior={android ? undefined : 'padding'}
      style={{ flex: 1, backgroundColor: colors.bgPrimary }}
    >
      <ScrollView
        style={{ flex: 1 }}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={android ? 'on-drag' : 'interactive'}
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: centered ? 'center' : 'flex-start',
          padding: spacing.xl,
          gap: spacing.xl,
          paddingTop: spacing.xl + (android ? insets.top : 0),
          paddingBottom: spacing.xl + (android ? insets.bottom : 0),
          paddingLeft: spacing.xl + (android ? insets.left : 0),
          paddingRight: spacing.xl + (android ? insets.right : 0),
        }}
      >
        {title ? (
          <ThemedText variant="title" accessibilityRole="header">
            {title}
          </ThemedText>
        ) : null}
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
