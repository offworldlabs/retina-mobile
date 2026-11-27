import { useTheme, type ColorScheme } from '@/theme';
import { palette } from '@/theme/tokens';

/**
 * Chart chrome and series colours per scheme. The web dashboard's chart tokens
 * (utils/chartTheme.ts) are the app palette's own values for grid (border),
 * axis (muted text), cursor (strong border) and tooltip ground (card), so they
 * are read from the palette here; the categorical series keep the web's order
 * and hues, a step lighter on the dark ground as there.
 */
export interface ChartTheme {
  /** Grid lines. */
  grid: string;
  /** Axis lines and tick marks. */
  axis: string;
  /** Tick labels. */
  text: string;
  /** Secondary words in and around a chart. */
  muted: string;
  /** The ground behind a touch readout. */
  readoutBg: string;
  /** Categorical series, in the web's order. */
  series: readonly string[];
  good: string;
  bad: string;
  /** A cell or mark with nothing measured in it. */
  empty: string;
  /** The touch cursor: a band behind a bar, a rule across a line. */
  cursor: string;
  /** The card a chart sits on, which ringed dots are outlined in. */
  surface: string;
}

const SERIES: Record<ColorScheme, readonly string[]> = {
  light: [
    '#3b82f6',
    '#10b981',
    '#f59e0b',
    '#ef4444',
    '#8b5cf6',
    '#ec4899',
    '#06b6d4',
    '#84cc16',
    '#f97316',
    '#14b8a6',
  ],
  dark: [
    '#60a5fa',
    '#34d399',
    '#fbbf24',
    '#f87171',
    '#a78bfa',
    '#f472b6',
    '#22d3ee',
    '#a3e635',
    '#fb923c',
    '#2dd4bf',
  ],
};

function buildChartTheme(scheme: ColorScheme): ChartTheme {
  const colors = palette[scheme];
  return {
    grid: colors.border,
    axis: colors.textMuted,
    // Tick labels one step darker than the web's axis ink, which is too faint
    // to read at phone sizes on a white card.
    text: colors.textSecondary,
    muted: colors.textMuted,
    readoutBg: colors.bgSunk,
    series: SERIES[scheme],
    good: colors.success,
    bad: colors.error,
    empty: colors.bgSunk,
    cursor: colors.borderStrong,
    surface: colors.bgCard,
  };
}

const CHART_THEMES: Record<ColorScheme, ChartTheme> = {
  light: buildChartTheme('light'),
  dark: buildChartTheme('dark'),
};

/** The chart colours for the scheme on screen; one object per scheme, so a
 *  chart repaints on a scheme change and not otherwise. */
export function useChartTheme(): ChartTheme {
  return CHART_THEMES[useTheme().scheme];
}
