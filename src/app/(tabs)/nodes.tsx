import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState, type ReactElement } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { myNodesQuery, OWNER_QUERY_ROOT, userMessage } from '@/api';
import { useAuth } from '@/auth';
import { Button, ListScreen, Placeholder, Screen } from '@/components';
import { NodeSeparator, Notice } from '@/features/network';
import { MyNodeRow, OpenClaims, OverviewStats, useMyNodes } from '@/features/nodes';
import { DetectionsByNodeChart } from '@/features/nodes/charts';
import { useMyAnalytics, useMyClaims } from '@/features/nodes/hooks';
import { useTheme } from '@/theme';

export default function NodesScreen() {
  const router = useRouter();
  const { state } = useAuth();
  const { colors, spacing } = useTheme();
  const email = state.status === 'signed-in' ? state.email : null;
  const nodes = useMyNodes(email);
  const claims = useMyClaims(email);
  const analytics = useMyAnalytics(email);
  const queryClient = useQueryClient();
  const loadedAt = useQuery({ ...myNodesQuery(email ?? ''), enabled: false }).dataUpdatedAt;
  const [refreshing, setRefreshing] = useState(false);

  /** Reads the nodes, claims and analytics anew; does nothing while offline. */
  const refresh = async () => {
    if (nodes.offline || email === null) return;
    setRefreshing(true);
    try {
      await queryClient.invalidateQueries({ queryKey: OWNER_QUERY_ROOT });
    } finally {
      setRefreshing(false);
    }
  };

  if (state.status === 'loading') {
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.bgPrimary,
        }}
      >
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (state.status === 'signed-out') {
    return (
      <Screen title="My nodes">
        <Placeholder
          title="Sign in to see your nodes"
          description="Your nodes, their status and recent activity appear here after you sign in."
        />
        <Button label="Sign in" onPress={() => router.push('/sign-in')} />
      </Screen>
    );
  }

  let notice: ReactElement | undefined;
  if (nodes.offline) {
    notice = (
      <Notice
        tone="warning"
        text={
          nodes.hasData
            ? 'You are offline. Showing the last update.'
            : 'You are offline. Connect to see your nodes.'
        }
      />
    );
  } else if (nodes.error && nodes.hasData) {
    notice = (
      <Notice
        tone="warning"
        text={`Could not refresh your nodes: ${userMessage(nodes.error)}. Showing what was loaded at ${new Date(loadedAt).toLocaleTimeString()}.`}
      />
    );
  } else if (nodes.error) {
    notice = (
      <>
        <Notice tone="warning" text={`Could not load your nodes: ${userMessage(nodes.error)}`} />
        <Button label="Retry" onPress={nodes.refresh} />
      </>
    );
  }

  const header = (
    <>
      {notice}
      <OpenClaims claims={claims.error ? [] : claims.claims} onSent={() => void claims.refresh()} />
      {nodes.hasData && <OverviewStats nodes={nodes.nodes} analytics={analytics.analytics} />}
      {nodes.nodes.length > 1 && (
        <DetectionsByNodeChart nodes={nodes.nodes} analytics={analytics.analytics} />
      )}
    </>
  );

  let empty: ReactElement | undefined;
  if (nodes.isLoading) {
    empty = (
      <View style={{ alignItems: 'center', paddingVertical: spacing.xxl }}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  } else if (nodes.hasData || (!nodes.error && !nodes.offline)) {
    empty = (
      <Placeholder
        title="No nodes on your account yet."
        description="To connect a node, enter your email address in its setup and we will send you a link. Click it and the node joins your account."
      />
    );
  }

  return (
    <ListScreen
      title="My nodes"
      header={header}
      data={nodes.nodes}
      extraData={analytics.analytics}
      keyExtractor={(node) => node.node_id}
      renderItem={({ item }) => <MyNodeRow node={item} analytics={analytics.analytics} />}
      ItemSeparatorComponent={NodeSeparator}
      ListEmptyComponent={empty}
      refreshing={refreshing}
      onRefresh={refresh}
    />
  );
}
