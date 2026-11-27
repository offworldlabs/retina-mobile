import { View } from 'react-native';

import type { OwnerNodeAnalytics } from '@/api';
import { ThemedText } from '@/components';
import { TrustReputationChart } from '@/features/nodes/charts';
import { formatDb, formatPercent, formatScore } from '@/features/nodes/model';
import { useTheme } from '@/theme';
import { Card, Row } from './Card';
import { formatDuration, numberOr0 } from './format';

function Tile({ label, value }: { label: string; value: string }) {
  const { colors, spacing, radius } = useTheme();
  return (
    <View
      style={{
        flexGrow: 1,
        flexBasis: '45%',
        gap: spacing.xs,
        padding: spacing.lg,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.bgCard,
      }}
    >
      <ThemedText variant="caption" color="secondary">
        {label}
      </ThemedText>
      <ThemedText variant="figure">{value}</ThemedText>
    </View>
  );
}

/** The node's measured figures: counts, trust, availability and detection area. */
export function Figures({ analytics }: { analytics: OwnerNodeAnalytics }) {
  const { spacing } = useTheme();
  const metrics: OwnerNodeAnalytics['metrics'] = analytics.metrics ?? {};
  const trust: OwnerNodeAnalytics['trust'] = analytics.trust ?? {};
  const reputation: OwnerNodeAnalytics['reputation'] = analytics.reputation ?? {};
  const area: OwnerNodeAnalytics['detection_area'] | null = analytics.detection_area ?? null;
  const detections = numberOr0(metrics.total_detections) || numberOr0(area?.n_detections);
  return (
    <>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg }}>
        <Tile label="Total Frames" value={numberOr0(metrics.total_frames).toLocaleString()} />
        <Tile label="Total Detections" value={detections.toLocaleString()} />
        <Tile label="Total Tracks" value={numberOr0(metrics.total_tracks).toLocaleString()} />
        <Tile label="Avg SNR" value={formatDb(numberOr0(metrics.avg_snr))} />
      </View>
      <Card title="Trust & Reputation">
        <TrustReputationChart summary={analytics} />
        <Row label="Trust Score" value={formatScore(numberOr0(trust.trust_score))} />
        <Row label="ADS-B Misses" value={String(numberOr0(trust.adsb_misses))} />
        <Row label="Reputation" value={formatScore(numberOr0(reputation.reputation))} />
        <Row label="Penalties" value={String(numberOr0(reputation.n_penalties))} />
        <Row label="Blocked" value={reputation.blocked ? 'Yes' : 'No'} />
      </Card>
      <Card title="Availability">
        <Row label="Availability (7 d)" value={formatPercent(metrics.availability_7d)} />
        <Row label="Availability (24 h)" value={formatPercent(metrics.availability_24h)} />
        <Row
          label="Availability measured over"
          value={formatDuration(metrics.availability_measured_s)}
        />
      </Card>
      {area ? (
        <Card title="Detection Area">
          <Row label="Beam Width" value={`${numberOr0(area.beam_width_deg).toFixed(1)}°`} />
        </Card>
      ) : null}
    </>
  );
}

/** Where the figures go for a node the server has measured nothing of yet. */
export function NoFiguresYet() {
  return (
    <Card title="Metrics">
      <ThemedText color="secondary">
        Nothing measured for this node yet. Its metrics start with the first frames the server
        receives from it.
      </ThemedText>
    </Card>
  );
}
