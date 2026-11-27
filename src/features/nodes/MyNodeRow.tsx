import { useRouter } from 'expo-router';
import { Pressable, View } from 'react-native';

import type { OwnerAnalytics, OwnerNode } from '@/api';
import { ThemedText } from '@/components';
import {
  formatDb,
  formatMhz,
  formatPercent,
  heardAgo,
  nodeName,
  nodeStatus,
  summaryFor,
  type StatusTone,
} from './model';
import { useNow } from './clock';
import { detectionCount, trackCount } from './OverviewStats';
import { useTheme } from '@/theme';

/** How often "last heard" is read again, as on the node page. */
const CLOCK_MS = 15_000;

function Fact({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  const { spacing } = useTheme();
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.lg }}>
      <ThemedText variant="caption" color="secondary">
        {label}
      </ThemedText>
      <ThemedText variant={mono ? 'mono' : 'caption'} selectable style={{ flexShrink: 1 }}>
        {value}
      </ThemedText>
    </View>
  );
}

export function MyNodeRow({
  node,
  analytics,
}: {
  node: OwnerNode;
  analytics: OwnerAnalytics | null;
}) {
  const router = useRouter();
  const { colors, spacing, radius } = useTheme();
  const now = useNow(CLOCK_MS);
  const name = nodeName(node);
  const status = nodeStatus(node.status);
  const toneColor: Record<StatusTone, string> = {
    online: colors.success,
    offline: colors.error,
    never: colors.textMuted,
  };
  const heard = heardAgo(node.last_heartbeat, now);
  const summary = summaryFor(analytics, node.node_ref);
  const label = [name, status.label, heard && `last heard ${heard}`].filter(Boolean).join(', ');
  const hasLocation = node.rx_lat !== null && node.rx_lon !== null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => router.push({ pathname: '/nodes/[id]', params: { id: node.node_id } })}
      style={({ pressed }) => ({
        minHeight: 44,
        gap: spacing.md,
        paddingHorizontal: spacing.xl,
        paddingVertical: spacing.lg,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: pressed ? colors.bgCardHover : colors.bgCard,
      })}
    >
      <View
        style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.md }}
      >
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.sm,
            paddingHorizontal: spacing.md,
            borderRadius: radius.md,
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: colors.bgSunk,
          }}
        >
          <View
            style={{
              width: spacing.md,
              height: spacing.md,
              borderRadius: radius.sm,
              backgroundColor: toneColor[status.tone],
            }}
          />
          <ThemedText variant="caption" color="secondary">
            {status.label}
          </ThemedText>
        </View>
        {node.location_private && (
          <View
            style={{
              paddingHorizontal: spacing.md,
              borderRadius: radius.md,
              borderWidth: 1,
              borderColor: colors.border,
            }}
          >
            <ThemedText variant="caption" color="muted">
              Private
            </ThemedText>
          </View>
        )}
      </View>
      <ThemedText variant="heading" numberOfLines={1}>
        {name}
      </ThemedText>
      <View style={{ gap: spacing.xs }}>
        {node.node_ref && node.name && node.name !== node.node_ref && (
          <Fact label="Ref" value={node.node_ref} mono />
        )}
        <Fact label="Frequency" value={formatMhz(node.frequency)} />
        <Fact
          label="Location"
          value={hasLocation ? `${node.rx_lat?.toFixed(3)}, ${node.rx_lon?.toFixed(3)}` : '—'}
        />
        <Fact label="Detections" value={detectionCount(summary).toLocaleString()} />
        <Fact label="Tracks" value={trackCount(summary).toLocaleString()} />
        <Fact label="Availability" value={formatPercent(summary?.metrics?.availability_7d)} />
        <Fact label="Avg SNR" value={formatDb(summary?.metrics?.avg_snr)} />
        <Fact label="Config" value={node.config_hash ? node.config_hash.slice(0, 8) : '—'} mono />
      </View>
      {heard && (
        <ThemedText variant="caption" color="secondary">
          Last heard {heard}
        </ThemedText>
      )}
    </Pressable>
  );
}
