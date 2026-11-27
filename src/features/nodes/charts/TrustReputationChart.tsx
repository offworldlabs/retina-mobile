import type { ReactElement } from 'react';

import type { OwnerSummary } from '@/api';
import { BarChart, type BarDatum } from './BarChart';

const num = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0;

const DB_LABEL = 'Avg SNR';

/** The three bars as the web's NodeFigures computes them: the average SNR in
 *  dB beside the trust score and reputation as percentages, a missing figure
 *  drawn as 0. */
export function trustBars(summary: OwnerSummary): BarDatum[] {
  const metrics = (summary.metrics ?? {}) as Record<string, unknown>;
  const trust = (summary.trust ?? {}) as Record<string, unknown>;
  const reputation = (summary.reputation ?? {}) as Record<string, unknown>;
  return [
    { label: DB_LABEL, value: num(metrics.avg_snr) },
    { label: 'Trust', value: num(trust.trust_score) * 100 },
    { label: 'Reputation', value: num(reputation.reputation) * 100 },
  ];
}

/** A bar's figure, written as the node page writes it in its tiles and rows. */
function figure(bar: BarDatum): string {
  return bar.label === DB_LABEL ? `${bar.value.toFixed(1)} dB` : `${bar.value.toFixed(1)}%`;
}

/** The node page's "Trust & Reputation" bars; the card around them is the page's. */
export function TrustReputationChart({ summary }: { summary: OwnerSummary }): ReactElement {
  const bars = trustBars(summary);
  return (
    <BarChart
      bars={bars}
      height={180}
      readout={(bar) => `${bar.label}: ${figure(bar)}`}
      accessibilityLabel={`Trust and reputation chart. ${bars.map((bar) => `${bar.label} ${figure(bar)}`).join(', ')}.`}
      hint="Touch a bar to read its value."
    />
  );
}
