import { useRouter } from 'expo-router';
import type { ReactElement } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { userMessage } from '@/api';
import { useAuth } from '@/auth';
import { Button, ListScreen, Placeholder, Screen } from '@/components';
import { NodeSeparator, Notice } from '@/features/network';
import { MyNodeRow, useMyNodes } from '@/features/nodes';
import { useTheme } from '@/theme';

export default function NodesScreen() {
  const router = useRouter();
  const { state } = useAuth();
  const { colors, spacing } = useTheme();
  const nodes = useMyNodes(state.status === 'signed-in' ? state.email : null);

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

  let header: ReactElement | undefined;
  if (nodes.offline) {
    header = (
      <Notice
        tone="warning"
        text={
          nodes.hasData
            ? 'You are offline. Showing the last update.'
            : 'You are offline. Connect to see your nodes.'
        }
      />
    );
  } else if (nodes.error) {
    header = <Notice tone="warning" text={userMessage(nodes.error)} />;
  }

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
        title="No nodes yet"
        description="Nodes you claim on the RETINA website show up here."
      />
    );
  }

  return (
    <ListScreen
      title="My nodes"
      header={header}
      data={nodes.nodes}
      keyExtractor={(node) => node.node_id}
      renderItem={({ item }) => <MyNodeRow node={item} />}
      ItemSeparatorComponent={NodeSeparator}
      ListEmptyComponent={empty}
      refreshing={nodes.refreshing}
      onRefresh={nodes.refresh}
    />
  );
}
