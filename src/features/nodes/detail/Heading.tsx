import { View } from 'react-native';

import type { OwnerNode } from '@/api';
import { ThemedText } from '@/components';
import { useNow } from '@/features/nodes/clock';
import { heardAgo, nodeStatus, positionProblem, type StatusTone } from '@/features/nodes/model';
import { useTheme } from '@/theme';

const HOW_TO_FIX_POSITION = {
  missing_rx: 'Add its receiver position in the node configuration.',
  missing_tx: 'Add its illuminator position in the node configuration.',
  missing_both: 'Add its receiver and illuminator positions in the node configuration.',
} as const;

const POSITION_EXPLANATION =
  'Detections from this node are counted and archived. It needs a ' +
  'position before they can be placed on the map or contribute to solves.';

/** How often "last heard" is read again, so it keeps up between refetches. */
const CLOCK_MS = 15_000;

/** The page's title and, for an owner's node, what it is and how it is doing. */
export function Heading({ title, node }: { title: string; node: OwnerNode | null }) {
  const { colors, spacing, radius } = useTheme();
  const now = useNow(CLOCK_MS);
  const status = node ? nodeStatus(node.status) : null;
  const toneColor: Record<StatusTone, string> = {
    online: colors.success,
    offline: colors.error,
    never: colors.textMuted,
  };
  const heard = node ? heardAgo(node.last_heartbeat, now) : null;
  const ref = node?.node_ref && node.node_ref !== title ? node.node_ref : null;
  return (
    <View style={{ gap: spacing.md }}>
      <ThemedText variant="title" accessibilityRole="header">
        {title}
      </ThemedText>
      {node ? (
        <ThemedText color="secondary">
          {`Your node${ref ? `, ${ref}` : ''}: its metrics, configuration and records.`}
        </ThemedText>
      ) : null}
      {node && status ? (
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
          {node.location_private ? (
            <ThemedText variant="caption" color="muted">
              Private
            </ThemedText>
          ) : null}
          {heard ? (
            <ThemedText variant="caption" color="secondary">
              {`Last heard ${heard}`}
            </ThemedText>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/** The warning text for a node that lacks a position, or null when it has what it needs. */
export function positionWarning(status: OwnerNode['position_status']): string | null {
  if (!positionProblem(status) || !(status in HOW_TO_FIX_POSITION)) return null;
  const hint = HOW_TO_FIX_POSITION[status as keyof typeof HOW_TO_FIX_POSITION];
  return `Position not configured. ${POSITION_EXPLANATION} ${hint}`;
}
