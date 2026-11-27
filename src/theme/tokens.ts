// Colours and radii are ported from the web dashboard's design tokens:
// packages/shared/css/tokens.css in retina-server (light :root block, dark block).
// Spacing and type sizes follow the literal px values the dashboard uses, with
// body and label text enlarged for phones.
import { Platform, type TextStyle } from 'react-native';

export type ColorScheme = 'light' | 'dark';

export type Palette = {
  bgPrimary: string;
  bgCard: string;
  bgCardHover: string;
  bgSunk: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  border: string;
  borderStrong: string;
  accent: string;
  accentPressed: string;
  accentWash: string;
  accentInk: string;
  success: string;
  warning: string;
  error: string;
  errorInk: string;
  warningInk: string;
  shadow: string;
};

export const palette: Record<ColorScheme, Palette> = {
  light: {
    bgPrimary: '#f1f5f9',
    bgCard: '#ffffff',
    bgCardHover: '#f8fafc',
    bgSunk: '#f1f5f9',
    textPrimary: '#0f172a',
    textSecondary: '#475569',
    textMuted: '#94a3b8',
    border: '#e2e8f0',
    borderStrong: '#cbd5e1',
    accent: '#3b82f6',
    accentPressed: '#2563eb',
    accentWash: 'rgba(59, 130, 246, 0.10)',
    accentInk: '#ffffff',
    success: '#10b981',
    warning: '#f59e0b',
    error: '#ef4444',
    errorInk: '#b91c1c',
    warningInk: '#b45309',
    shadow: 'rgba(15, 23, 42, 0.14)',
  },
  dark: {
    bgPrimary: '#0d1b2a',
    bgCard: '#132240',
    bgCardHover: '#1a2b4d',
    bgSunk: '#0f2035',
    textPrimary: '#e2e8f0',
    textSecondary: '#94a3b8',
    textMuted: '#64748b',
    border: 'rgba(100, 180, 255, 0.14)',
    borderStrong: 'rgba(100, 180, 255, 0.28)',
    accent: '#38bdf8',
    accentPressed: '#7dd3fc',
    accentWash: 'rgba(56, 189, 248, 0.16)',
    accentInk: '#082f49',
    success: '#4ade80',
    warning: '#fbbf24',
    error: '#f43f5e',
    errorInk: '#fca5a5',
    warningInk: '#fcd34d',
    shadow: 'rgba(0, 0, 0, 0.5)',
  },
};

export const radius = { sm: 4, md: 8 } as const;

export const spacing = { xs: 4, sm: 6, md: 8, lg: 12, xl: 16, xxl: 24 } as const;

export type TypeVariant =
  'title' | 'figure' | 'heading' | 'body' | 'label' | 'caption' | 'micro' | 'mono';

export const type: Record<TypeVariant, TextStyle> = {
  title: { fontSize: 28, lineHeight: 34, fontWeight: '700' },
  figure: { fontSize: 24, lineHeight: 30, fontWeight: '700' },
  heading: { fontSize: 15, lineHeight: 22, fontWeight: '600' },
  body: { fontSize: 15, lineHeight: 22 },
  label: { fontSize: 13, lineHeight: 20, fontWeight: '600' },
  caption: { fontSize: 12, lineHeight: 18, fontWeight: '500' },
  micro: { fontSize: 11, lineHeight: 16, fontWeight: '500' },
  mono: {
    fontSize: 13,
    lineHeight: 20,
    fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
  },
};
