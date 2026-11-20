import { Pressable, type PressableProps } from 'react-native';

import { ThemedText } from './ThemedText';
import { useTheme } from '@/theme';

export type ButtonProps = Omit<PressableProps, 'children' | 'style'> & {
  label: string;
  variant?: 'primary' | 'secondary';
};

export function Button({ label, variant = 'primary', accessibilityLabel, ...props }: ButtonProps) {
  const { colors, spacing, radius } = useTheme();
  const primary = variant === 'primary';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      style={({ pressed }) => ({
        minHeight: 44,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: spacing.xl,
        paddingVertical: spacing.lg,
        borderRadius: radius.md,
        borderWidth: primary ? 0 : 1,
        borderColor: colors.borderStrong,
        backgroundColor: primary
          ? pressed
            ? colors.accentPressed
            : colors.accent
          : pressed
            ? colors.bgCardHover
            : colors.bgCard,
      })}
      {...props}
    >
      <ThemedText
        variant="heading"
        style={{ color: primary ? colors.accentInk : colors.textPrimary }}
      >
        {label}
      </ThemedText>
    </Pressable>
  );
}
