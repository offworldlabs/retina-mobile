import { View } from 'react-native';

import type { OwnerNode } from '@/api';
import { ThemedText } from '@/components';
import { useTheme } from '@/theme';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** "just now", "N min ago", "N h ago" or "N d ago"; null for a time that is empty or not a date. */
function heardAgo(iso: string | null): string | null {
  if (!iso) return null;
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return null;
  const age = Date.now() - at;
  if (age < MINUTE_MS) return 'just now';
  if (age < HOUR_MS) return `${Math.floor(age / MINUTE_MS)} min ago`;
  if (age < DAY_MS) return `${Math.floor(age / HOUR_MS)} h ago`;
  return `${Math.floor(age / DAY_MS)} d ago`;
}

export function MyNodeRow({ node }: { node: OwnerNode }) {
  const { colors, spacing, radius } = useTheme();
  const name = node.name || node.label || node.node_ref || node.node_id;
  const heard = heardAgo(node.last_heartbeat);
  const status =
    node.status === 'active'
      ? { text: 'Online', color: colors.success }
      : node.status === 'disconnected'
        ? { text: 'Offline', color: colors.warning }
        : node.status === 'never_connected'
          ? { text: 'Never connected', color: colors.textMuted }
          : { text: node.status, color: colors.textMuted };
  const label = [
    name,
    status.text,
    heard && `last heard ${heard}`,
    node.location_private && 'private location',
  ]
    .filter(Boolean)
    .join(', ');
  return (
    <View
      accessible
      accessibilityLabel={label}
      style={{
        minHeight: 44,
        gap: spacing.md,
        paddingHorizontal: spacing.xl,
        paddingVertical: spacing.lg,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.bgCard,
      }}
    >
      <ThemedText variant="heading" numberOfLines={1}>
        {name}
      </ThemedText>
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
              backgroundColor: status.color,
            }}
          />
          <ThemedText variant="caption" color="secondary">
            {status.text}
          </ThemedText>
        </View>
        {node.location_private && (
          <ThemedText variant="caption" color="muted">
            Private
          </ThemedText>
        )}
      </View>
      {heard && (
        <ThemedText variant="caption" color="secondary">
          Last heard {heard}
        </ThemedText>
      )}
    </View>
  );
}
