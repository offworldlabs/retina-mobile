import type { ReactNode } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { ThemedText } from '@/components';
import { useTheme } from '@/theme';

export type StateBlockProps = {
  title?: string;
  message?: string;
  /** 'error' shows the message in the error colour and announces it. */
  tone?: 'default' | 'error';
  /** A spinner above the text, while something is under way. */
  busy?: boolean;
  /** The actions, stacked full width under the text. */
  children?: ReactNode;
};

/** One state of a screen, centred: an optional spinner, a title, a line of text and its actions. */
export function StateBlock({
  title,
  message,
  tone = 'default',
  busy = false,
  children,
}: StateBlockProps) {
  const { colors, spacing } = useTheme();
  const error = tone === 'error';
  return (
    <View style={{ gap: spacing.xxl }}>
      <View style={{ alignItems: 'center', gap: spacing.lg }}>
        {busy ? <ActivityIndicator size="large" color={colors.accent} /> : null}
        {title ? (
          <ThemedText variant="title" accessibilityRole="header" style={{ textAlign: 'center' }}>
            {title}
          </ThemedText>
        ) : null}
        {message ? (
          <ThemedText
            color={error ? 'error' : 'secondary'}
            accessibilityRole={error ? 'alert' : undefined}
            style={{ textAlign: 'center' }}
          >
            {message}
          </ThemedText>
        ) : null}
      </View>
      {children ? <View style={{ gap: spacing.lg }}>{children}</View> : null}
    </View>
  );
}
