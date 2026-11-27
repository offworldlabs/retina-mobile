import type { ReactElement } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { userMessage } from '@/api';
import { Button, ListScreen, ThemedText } from '@/components';
import { apiBaseUrl, appEnv } from '@/config/env';
import {
  NetworkSummary,
  NodeRow,
  NodeSeparator,
  Notice,
  useNetworkNodes,
} from '@/features/network';
import { useTheme } from '@/theme';

export default function MapScreen() {
  const { colors, spacing } = useTheme();
  const nodes = useNetworkNodes();

  const header = (
    <View style={{ gap: spacing.xl }}>
      <Notice text="A live map of aircraft and nodes will appear here." />
      {nodes.offline && (
        <Notice
          tone="warning"
          text={
            nodes.hasData
              ? 'You are offline. Showing the last update.'
              : 'You are offline. Connect to see the network.'
          }
        />
      )}
      {nodes.hasData && (
        <NetworkSummary online={nodes.online} total={nodes.total} updatedAt={nodes.updatedAt} />
      )}
      {nodes.hasData && nodes.error && !nodes.offline && (
        <ThemedText variant="caption" color="warning">
          {userMessage(nodes.error)}
        </ThemedText>
      )}
    </View>
  );

  let empty: ReactElement | undefined;
  if (nodes.hasData) {
    empty = (
      <ThemedText color="secondary" style={{ textAlign: 'center', paddingVertical: spacing.xxl }}>
        No nodes are reporting right now.
      </ThemedText>
    );
  } else if (nodes.isLoading || nodes.refreshing) {
    empty = (
      <View style={{ alignItems: 'center', gap: spacing.lg, paddingVertical: spacing.xxl }}>
        <ActivityIndicator color={colors.accent} />
        <ThemedText color="secondary">Loading the network…</ThemedText>
      </View>
    );
  } else if (nodes.error && !nodes.offline) {
    empty = (
      <View style={{ alignItems: 'center', gap: spacing.lg, paddingVertical: spacing.xxl }}>
        <ThemedText color="error" accessibilityRole="alert" style={{ textAlign: 'center' }}>
          {userMessage(nodes.error)}
        </ThemedText>
        <Button variant="secondary" label="Try again" onPress={nodes.refresh} />
      </View>
    );
  }

  return (
    <ListScreen
      title="Map"
      header={header}
      data={nodes.rows}
      keyExtractor={(row) => row.node_ref}
      renderItem={({ item }) => <NodeRow row={item} />}
      ItemSeparatorComponent={NodeSeparator}
      ListEmptyComponent={empty}
      ListFooterComponent={
        appEnv === 'development' ? (
          <ThemedText variant="micro" color="muted" style={{ marginTop: spacing.xl }}>
            Data from {apiBaseUrl}
          </ThemedText>
        ) : undefined
      }
      refreshing={nodes.refreshing}
      onRefresh={nodes.refresh}
    />
  );
}
