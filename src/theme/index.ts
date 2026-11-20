import { DefaultTheme, type Theme } from 'expo-router';
import { useColorScheme } from 'react-native';

import { palette, radius, spacing, type, type ColorScheme, type Palette } from './tokens';

export type { ColorScheme, Palette, TypeVariant } from './tokens';

export type AppTheme = {
  scheme: ColorScheme;
  colors: Palette;
  spacing: typeof spacing;
  radius: typeof radius;
  type: typeof type;
};

function buildAppTheme(scheme: ColorScheme): AppTheme {
  return { scheme, colors: palette[scheme], spacing, radius, type };
}

const appThemes: Record<ColorScheme, AppTheme> = {
  light: buildAppTheme('light'),
  dark: buildAppTheme('dark'),
};

export function useTheme(): AppTheme {
  return appThemes[useColorScheme() === 'dark' ? 'dark' : 'light'];
}

function buildNavigationTheme(scheme: ColorScheme): Theme {
  const colors = palette[scheme];
  return {
    dark: scheme === 'dark',
    colors: {
      primary: colors.accent,
      background: colors.bgPrimary,
      card: colors.bgCard,
      text: colors.textPrimary,
      border: colors.border,
      notification: colors.error,
    },
    fonts: DefaultTheme.fonts,
  };
}

export const navigationThemes: Record<ColorScheme, Theme> = {
  light: buildNavigationTheme('light'),
  dark: buildNavigationTheme('dark'),
};
