import { View } from 'react-native';

import { ThemedText } from '@/components';
import { useTheme } from '@/theme';

export type NoticeProps = {
  text: string;
  tone?: 'info' | 'warning';
};

export function Notice({ text, tone = 'info' }: NoticeProps) {
  const { colors, spacing, radius } = useTheme();
  const warning = tone === 'warning';
  return (
    <View
      accessible
      accessibilityRole={warning ? 'alert' : undefined}
      style={{
        padding: spacing.lg,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: warning ? colors.warning : colors.border,
        backgroundColor: warning ? colors.bgSunk : colors.bgCard,
      }}
    >
      <ThemedText variant="label" color={warning ? 'warning' : 'secondary'}>
        {text}
      </ThemedText>
    </View>
  );
}
