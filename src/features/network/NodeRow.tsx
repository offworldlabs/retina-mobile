import { View } from 'react-native';

import type { LeaderboardRow } from '@/api';
import { ThemedText } from '@/components';
import { useTheme } from '@/theme';

export function NodeSeparator() {
  const { spacing } = useTheme();
  return <View style={{ height: spacing.md }} />;
}

export function NodeRow({ row }: { row: LeaderboardRow }) {
  const { colors, spacing, radius } = useTheme();
  const status = row.online ? 'online' : 'offline';
  const rank = row.rank === null ? 'Unranked' : `#${row.rank}`;
  const detections = `${row.detections.toLocaleString()} ${row.detections === 1 ? 'detection' : 'detections'}`;
  const label = `${row.name}, ${status}, ${row.rank === null ? 'unranked' : `rank ${row.rank}`}, ${detections}`;
  return (
    <View
      accessible
      accessibilityLabel={label}
      style={{
        minHeight: 44,
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.lg,
        paddingHorizontal: spacing.xl,
        paddingVertical: spacing.lg,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.bgCard,
      }}
    >
      <View style={{ flex: 1 }}>
        <ThemedText variant="heading" numberOfLines={1}>
          {row.name}
        </ThemedText>
        {row.node_ref !== row.name && (
          <ThemedText variant="caption" color="muted" numberOfLines={1}>
            {row.node_ref}
          </ThemedText>
        )}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
          <View
            style={{
              width: spacing.md,
              height: spacing.md,
              borderRadius: radius.sm,
              backgroundColor: row.online ? colors.success : colors.error,
            }}
          />
          <ThemedText variant="caption" color="secondary">
            {row.online ? 'Online' : 'Offline'}
          </ThemedText>
        </View>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <ThemedText variant="heading">{rank}</ThemedText>
        <ThemedText variant="caption" color="secondary">
          {detections}
        </ThemedText>
      </View>
    </View>
  );
}
