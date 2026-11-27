import { useRouter } from 'expo-router';
import { useState, type ReactElement, type ReactNode } from 'react';
import { ActivityIndicator, Platform, RefreshControl, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { userMessage } from '@/api';
import { useAuth } from '@/auth';
import { Button, Placeholder, ThemedText } from '@/components';
import { Notice } from '@/features/network';
import { DEFAULT_SNR_HOURS, PerformancePanel, SnrPanel } from '@/features/nodes/charts';
import { useNodeDetail, useNodeSnr } from '@/features/nodes/hooks';
import { nodeName } from '@/features/nodes/model';
import { NodeRecords } from '@/features/nodes/records';
import { useTheme } from '@/theme';
import { Card } from './Card';
import { Figures, NoFiguresYet } from './Figures';
import { Heading, positionWarning } from './Heading';
import { LabelPrivacyCard } from './LabelPrivacyCard';
import { OwnershipCard, ReleasedCard, type Release } from './OwnershipCard';
import { RfCard } from './RfCard';

type Refresh = { refreshing: boolean; onRefresh: () => void };

/** The page's scroll area with its own top row: the root stack draws no header. */
function Frame({
  onBack,
  refresh,
  children,
}: {
  onBack: () => void;
  refresh?: Refresh;
  children: ReactNode;
}) {
  const { colors, spacing } = useTheme();
  const insets = useSafeAreaInsets();
  const android = Platform.OS === 'android';
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bgPrimary }}
      contentInsetAdjustmentBehavior="automatic"
      refreshControl={
        refresh ? (
          <RefreshControl
            refreshing={refresh.refreshing}
            onRefresh={refresh.onRefresh}
            tintColor={colors.accent}
          />
        ) : undefined
      }
      contentContainerStyle={{
        padding: spacing.xl,
        gap: spacing.xl,
        paddingTop: spacing.xl + (android ? insets.top : 0),
        paddingBottom: spacing.xl + (android ? insets.bottom : 0),
        paddingLeft: spacing.xl + (android ? insets.left : 0),
        paddingRight: spacing.xl + (android ? insets.right : 0),
      }}
    >
      <View style={{ alignSelf: 'flex-start' }}>
        <Button label="Back" variant="secondary" onPress={onBack} />
      </View>
      {children}
    </ScrollView>
  );
}

export function NodeDetailScreen({ nodeId }: { nodeId: string }): ReactElement {
  const router = useRouter();
  const { state } = useAuth();
  const { colors, spacing } = useTheme();
  const email = state.status === 'signed-in' ? state.email : null;
  const detail = useNodeDetail(nodeId ? email : null, nodeId);
  const [hours, setHours] = useState(DEFAULT_SNR_HOURS);
  const snr = useNodeSnr(detail.node ? email : null, nodeId, hours);
  const [release, setRelease] = useState<{ kind: Release; name: string } | null>(null);

  const goBack = () => (router.canGoBack() ? router.back() : router.dismissTo('/(tabs)/nodes'));
  const toNodes = () => router.dismissTo('/(tabs)/nodes');
  const retry = () => void detail.refresh();

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
      <Frame onBack={goBack}>
        <Placeholder
          title="Sign in to see your nodes"
          description="Your nodes, their status and recent activity appear here after you sign in."
        />
        <Button label="Sign in" onPress={() => router.push('/sign-in')} />
      </Frame>
    );
  }

  const refresh: Refresh = { refreshing: detail.refreshing, onRefresh: retry };
  const { node } = detail;

  if (release) {
    return (
      <Frame onBack={goBack} refresh={refresh}>
        <Heading title={release.name} node={null} />
        <ReleasedCard release={release.kind} onDone={toNodes} />
      </Frame>
    );
  }

  if (!node || detail.isLoading) {
    let content: ReactElement;
    if (detail.gone || !nodeId) {
      content = (
        <>
          <Heading title={nodeId} node={null} />
          <Card>
            <ThemedText variant="heading">Node not found</ThemedText>
            <Button label="Go to My Nodes" onPress={toNodes} />
          </Card>
        </>
      );
    } else if (detail.offline) {
      content = <Notice tone="warning" text="You are offline. Connect to see this node." />;
    } else if (detail.error) {
      content = (
        <View style={{ gap: spacing.lg }}>
          <Notice tone="warning" text={userMessage(detail.error)} />
          <Button label="Retry" onPress={retry} />
        </View>
      );
    } else {
      content = (
        <View style={{ alignItems: 'center', paddingVertical: spacing.xxl }}>
          <ActivityIndicator color={colors.accent} />
        </View>
      );
    }
    return (
      <Frame onBack={goBack} refresh={refresh}>
        {content}
      </Frame>
    );
  }

  const title = nodeName(node);
  const warning = positionWarning(node.position_status);
  return (
    <Frame onBack={goBack} refresh={refresh}>
      <Heading title={title} node={node} />
      {detail.offline ? (
        <Notice tone="warning" text="You are offline. Showing the last update." />
      ) : detail.error ? (
        <View style={{ gap: spacing.lg }}>
          <Notice tone="warning" text={userMessage(detail.error)} />
          <Button label="Retry" onPress={retry} />
        </View>
      ) : null}
      {warning ? <Notice tone="warning" text={warning} /> : null}
      {detail.analyticsError ? (
        <View style={{ gap: spacing.lg }}>
          <Notice
            tone="warning"
            text={`Could not load this node’s metrics: ${userMessage(detail.analyticsError)}`}
          />
          <Button label="Retry" onPress={retry} />
        </View>
      ) : null}
      {detail.analytics ? (
        <Figures analytics={detail.analytics} />
      ) : (
        !detail.analyticsError && <NoFiguresYet />
      )}
      <SnrPanel
        series={snr.series}
        hours={hours}
        onHoursChange={setHours}
        isLoading={snr.isLoading}
        error={snr.error}
      />
      {detail.analytics ? <PerformancePanel performance={detail.analytics.performance} /> : null}
      <RfCard node={node} />
      <LabelPrivacyCard node={node} />
      <OwnershipCard node={node} onReleased={(kind) => setRelease({ kind, name: title })} />
      <NodeRecords
        report={detail.report}
        versions={detail.versions}
        events={detail.events}
        error={detail.recordsError}
        loading={detail.recordsLoading}
      />
    </Frame>
  );
}
