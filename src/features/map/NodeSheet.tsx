import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';

import { ThemedText } from '@/components';
import { useTheme } from '@/theme';

import { coverageLine, type MapNode } from './nodes';

export type NodeSheetProps = {
  nodeRef: string | null;
  /** The nodes published at the tapped node's point; empty once it has left the listing. */
  site: readonly MapNode[];
  onClose: () => void;
  /** Shown at the bottom of the card, under a hairline. */
  footer?: ReactNode;
};

function StatusDot({ online }: { online: boolean }) {
  const { colors, spacing, radius } = useTheme();
  return (
    <View
      accessibilityLabel={online ? 'Online' : 'Offline'}
      style={{
        width: spacing.md,
        height: spacing.md,
        borderRadius: radius.sm,
        backgroundColor: online ? colors.success : colors.textMuted,
      }}
    />
  );
}

// The popup of the web map's node marker (dashboard/src/pages/map/LiveAircraftMap.tsx), public
// content only: a site's nodes with their coverage, and the displacement of the published point.
export function NodeSheet({ nodeRef, site, onClose, footer }: NodeSheetProps) {
  const { colors, spacing, radius } = useTheme();
  if (nodeRef === null) return null;
  const uncertaintyKm = site.reduce((max, node) => Math.max(max, node.uncertaintyKm || 0), 0);
  const single = site.length === 1 ? site[0] : undefined;
  const title = site.length > 1 ? `${site.length} nodes at this site` : nodeRef;
  return (
    <View
      pointerEvents="box-none"
      style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: spacing.lg }}
    >
      <View
        accessibilityLabel="Node details"
        accessibilityViewIsModal={false}
        style={{
          gap: spacing.lg,
          padding: spacing.xl,
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.bgCard,
          shadowColor: colors.shadow,
          shadowOpacity: 1,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 4 },
          elevation: 6,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.lg }}>
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
            {single && <StatusDot online={single.online} />}
            <ThemedText variant="title" numberOfLines={1} style={{ flexShrink: 1 }}>
              {title}
            </ThemedText>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close"
            hitSlop={spacing.xl}
            onPress={onClose}
          >
            <ThemedText variant="figure" color="secondary">
              ×
            </ThemedText>
          </Pressable>
        </View>
        {site.length === 0 ? (
          <ThemedText variant="body" color="secondary">
            No longer listed
          </ThemedText>
        ) : (
          <View style={{ gap: spacing.md }}>
            {uncertaintyKm > 0 && (
              <ThemedText variant="body" color="secondary">
                Location approximate: ±{uncertaintyKm} km
              </ThemedText>
            )}
            {single ? (
              <ThemedText variant="body">{coverageLine(single)}</ThemedText>
            ) : (
              site.map((node) => (
                <View key={node.ref}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
                    <StatusDot online={node.online} />
                    <ThemedText variant="label">{node.ref}</ThemedText>
                  </View>
                  <ThemedText variant="body">{coverageLine(node)}</ThemedText>
                </View>
              ))
            )}
          </View>
        )}
        {footer && (
          <View
            style={{
              borderTopWidth: 1,
              borderTopColor: colors.border,
              paddingTop: spacing.sm,
            }}
          >
            {footer}
          </View>
        )}
      </View>
    </View>
  );
}
