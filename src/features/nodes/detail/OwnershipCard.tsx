import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';

import { HttpError, OWNER_QUERY_ROOT, queryClient, releaseNode, type OwnerNode } from '@/api';
import { Button, ThemedText } from '@/components';
import { Notice } from '@/features/network';
import { useTheme } from '@/theme';
import { Card } from './Card';

/** How the node left the account: released here, or found already gone when the release was refused. */
export type Release = 'released' | 'gone';

/** The owner's hold on the node, and handing it back after asking first. */
export function OwnershipCard({
  node,
  onReleased,
}: {
  node: OwnerNode;
  onReleased: (release: Release) => void;
}) {
  const { spacing } = useTheme();
  const [confirming, setConfirming] = useState(false);
  const [releasing, setReleasing] = useState(false);
  const [failed, setFailed] = useState(false);
  const mounted = useRef(false);
  const inFlight = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  if (node.polled) {
    return (
      <Card title="Ownership">
        <ThemedText>
          You registered this stock blah2 radar by its address. Change the address or remove it on
          its radar page.
        </ThemedText>
      </Card>
    );
  }

  const release = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setReleasing(true);
    setFailed(false);
    let outcome: Release = 'released';
    try {
      await releaseNode(node.node_id);
    } catch (error) {
      if (!(error instanceof HttpError && error.status === 404)) {
        inFlight.current = false;
        if (mounted.current) {
          setFailed(true);
          setReleasing(false);
        }
        return;
      }
      outcome = 'gone';
    }
    // The page swaps this card for the released one first, so the refetch that follows
    // cannot show the node as missing in between.
    if (mounted.current) onReleased(outcome);
    void queryClient.invalidateQueries({ queryKey: OWNER_QUERY_ROOT });
  };

  return (
    <Card title="Ownership">
      <ThemedText>
        {node.claimed_with
          ? `Claimed with ${node.claimed_with}.`
          : 'This node was assigned to you rather than claimed with an email address.'}
      </ThemedText>
      <ThemedText color="secondary">
        Releasing hands it back so its next owner can claim it. You stop seeing its unpublished data
        straight away, and the node learns within a minute.
      </ThemedText>
      {failed ? <Notice tone="warning" text="Could not release this node. Try again." /> : null}
      {confirming ? (
        <View style={{ gap: spacing.lg }}>
          <View style={{ gap: spacing.xs }}>
            <ThemedText variant="heading">Release this node?</ThemedText>
            <ThemedText>Whoever claims it next becomes its owner.</ThemedText>
          </View>
          <Button
            label={releasing ? 'Releasing…' : 'Yes, release it'}
            disabled={releasing}
            onPress={release}
          />
          <Button
            label="Keep it"
            variant="secondary"
            disabled={releasing}
            onPress={() => {
              setConfirming(false);
              setFailed(false);
            }}
          />
        </View>
      ) : (
        <Button label="Release this node" variant="secondary" onPress={() => setConfirming(true)} />
      )}
    </Card>
  );
}

/** What the ownership card says once the node has left the account. */
export function ReleasedCard({ release, onDone }: { release: Release; onDone: () => void }) {
  return (
    <Card title="Ownership">
      <ThemedText accessibilityLiveRegion="polite">
        {release === 'released' ? 'Released. ' : ''}This node is no longer on your account.
      </ThemedText>
      <Button label="Go to My Nodes" onPress={onDone} />
    </Card>
  );
}
