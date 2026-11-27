import { Text, type TextProps } from 'react-native';

import { useTheme, type Palette, type TypeVariant } from '@/theme';

export type TextColor = 'primary' | 'secondary' | 'muted' | 'accent' | 'error' | 'warning';

const colorKeys: Record<TextColor, keyof Palette> = {
  primary: 'textPrimary',
  secondary: 'textSecondary',
  muted: 'textMuted',
  accent: 'accent',
  error: 'errorInk',
  warning: 'warningInk',
};

export type ThemedTextProps = TextProps & {
  variant?: TypeVariant;
  color?: TextColor;
};

export function ThemedText({
  variant = 'body',
  color = 'primary',
  style,
  ...props
}: ThemedTextProps) {
  const { colors, type } = useTheme();
  return <Text style={[type[variant], { color: colors[colorKeys[color]] }, style]} {...props} />;
}
