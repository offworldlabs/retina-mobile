import type { ReactElement } from 'react';

import type { OwnerAnalytics, OwnerNode, OwnerSummary } from '@/api';
import { BarChart, ChartCard, plural, type BarDatum } from './BarChart';

/** A node's summary from the account's analytics, joined by node_ref as the
 *  web joins them. An own-key lookup, since the keys come from the server. */
function summaryOf(analytics: OwnerAnalytics | null, ref: string | null): OwnerSummary | null {
  if (!analytics || !ref || !Object.prototype.hasOwnProperty.call(analytics.nodes, ref))
    return null;
  return analytics.nodes[ref] ?? null;
}

const count = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0;

/** The web's detection count: the metrics' total, else the detection area's. */
function detections(summary: OwnerSummary | null): number {
  if (!summary) return 0;
  return count(summary.metrics?.total_detections) || count(summary.detection_area?.n_detections);
}

/** One bar per node; a node with neither name nor ref is numbered, since a
 *  dash would label two such bars alike. */
export function detectionBars(
  nodes: readonly OwnerNode[],
  analytics: OwnerAnalytics | null,
): BarDatum[] {
  return nodes.map((node, i) => ({
    label: node.name || node.node_ref || `Node ${i + 1}`,
    value: detections(summaryOf(analytics, node.node_ref)),
  }));
}

/** My Nodes' "Detections by Node" card, shown only with more than one node. */
export function DetectionsByNodeChart({
  nodes,
  analytics,
}: {
  nodes: readonly OwnerNode[];
  analytics: OwnerAnalytics | null;
}): ReactElement | null {
  if (nodes.length < 2) return null;
  const bars = detectionBars(nodes, analytics);
  const reading = (bar: BarDatum) =>
    `${bar.label}: ${plural(bar.value, 'detection', 'detections')}`;
  return (
    <ChartCard title="Detections by Node">
      <BarChart
        bars={bars}
        height={200}
        readout={reading}
        accessibilityLabel={`Detections by node chart. ${bars.map(reading).join(', ')}.`}
        hint="Touch a bar to read its value."
      />
    </ChartCard>
  );
}
