import { Pressable, type PressableProps } from 'react-native';

import { ThemedText } from './ThemedText';
import { useTheme } from '@/theme';

export type ButtonProps = Omit<PressableProps, 'children' | 'style'> & {
  label: string;
  variant?: 'primary' | 'secondary';
};

export function Button({
  label,
  variant = 'primary',
  accessibilityLabel,
  disabled,
  ...props
}: ButtonProps) {
  const { colors, spacing, radius } = useTheme();
  const primary = variant === 'primary';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      // Pressable also puts `disabled` into accessibilityState, so screen readers hear it.
      disabled={disabled}
      style={({ pressed }) => ({
        opacity: disabled ? 0.5 : 1,
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
