import { useRouter } from 'expo-router';
import { Pressable, View } from 'react-native';

import type { OwnerAnalytics, OwnerNode, OwnerSummary } from '@/api';
import { ThemedText } from '@/components';
import { nodeName, nodeStatus, positionProblem, summaryFor } from './model';
import { useTheme } from '@/theme';

const POSITION_EXPLANATION =
  'Detections from this node are counted and archived. It needs a position before they can be placed on the map or contribute to solves.';

/** Frame detections of one node: the frame metric, else the detection area's count. */
export function detectionCount(summary: OwnerSummary | null): number {
  return summary?.metrics?.total_detections || summary?.detection_area?.n_detections || 0;
}

export function trackCount(summary: OwnerSummary | null): number {
  return summary?.metrics?.total_tracks || 0;
}

function StatCard({ title, value }: { title: string; value: string }) {
  const { colors, spacing, radius } = useTheme();
  return (
    <View
      style={{
        flexGrow: 1,
        flexBasis: '45%',
        padding: spacing.xl,
        gap: spacing.sm,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.bgCard,
      }}
    >
      <ThemedText variant="label" color="secondary">
        {title}
      </ThemedText>
      <ThemedText variant="figure">{value}</ThemedText>
    </View>
  );
}

function AttentionRow({ node, problem }: { node: OwnerNode; problem: string }) {
  const router = useRouter();
  const { spacing } = useTheme();
  const name = nodeName(node);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${name}, ${problem}`}
      onPress={() => router.push({ pathname: '/nodes/[id]', params: { id: node.node_id } })}
      style={{
        minHeight: 44,
        justifyContent: 'center',
        gap: spacing.xs,
        paddingVertical: spacing.md,
      }}
    >
      <ThemedText variant="heading" numberOfLines={1}>
        {name}
      </ThemedText>
      <ThemedText variant="caption" color="warning">
        {problem}
      </ThemedText>
    </Pressable>
  );
}

/** The owner's figures across all nodes, and the nodes whose position is missing. */
export function OverviewStats({
  nodes,
  analytics,
}: {
  nodes: readonly OwnerNode[];
  analytics: OwnerAnalytics | null;
}) {
  const { colors, spacing, radius } = useTheme();
  const online = nodes.filter((node) => nodeStatus(node.status).tone === 'online').length;
  const summaries = nodes.map((node) => summaryFor(analytics, node.node_ref));
  const detections = summaries.reduce((sum, summary) => sum + detectionCount(summary), 0);
  const tracks = summaries.reduce((sum, summary) => sum + trackCount(summary), 0);
  const attention = nodes.flatMap((node) => {
    const problem = positionProblem(node.position_status);
    return problem ? [{ node, problem }] : [];
  });
  return (
    <>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg }}>
        <StatCard title="Nodes Online" value={`${online} / ${nodes.length}`} />
        <StatCard title="Frame Detections" value={detections.toLocaleString()} />
        <StatCard title="Tracks" value={tracks.toLocaleString()} />
      </View>
      {attention.length > 0 && (
        <View
          style={{
            padding: spacing.xl,
            gap: spacing.md,
            borderRadius: radius.md,
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: colors.bgCard,
          }}
        >
          <ThemedText variant="heading" accessibilityRole="header">
            Needs Attention
          </ThemedText>
          <ThemedText variant="caption" color="secondary">
            {POSITION_EXPLANATION}
          </ThemedText>
          {attention.map(({ node, problem }) => (
            <AttentionRow key={node.node_id} node={node} problem={problem} />
          ))}
        </View>
      )}
    </>
  );
}
