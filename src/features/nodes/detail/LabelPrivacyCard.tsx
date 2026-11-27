import { View } from 'react-native';

import type { OwnerNode } from '@/api';
import { ThemedText } from '@/components';
import { useTheme } from '@/theme';
import { Card } from './Card';

const PRIVATE_DESCRIPTION =
  'Hidden from the public map: no marker, no coverage, no detection arcs, ' +
  'no single-node aircraft. Still contributes to multi-node solves.';

const PUBLIC_DESCRIPTION =
  "Shown on the map at an approximate position, displaced by the network's location fuzz";

function Setting({ title, value, note }: { title: string; value: string; note: string }) {
  const { spacing } = useTheme();
  return (
    <View style={{ gap: spacing.xs }}>
      <ThemedText variant="label" color="secondary">
        {title}
      </ThemedText>
      <ThemedText>{value}</ThemedText>
      <ThemedText variant="caption" color="muted">
        {note}
      </ThemedText>
    </View>
  );
}

function labelNote(node: OwnerNode): string {
  if (node.label) return "Your pages show it in place of the node's own name. Only you see it.";
  const shownInstead = node.name ?? node.node_ref;
  return shownInstead
    ? `Your pages show the node as ${shownInstead}. A label you add replaces that, for you alone.`
    : 'A label you add names the node on your pages, for you alone.';
}

/** The owner's label and whether the node's location is published, as read-only values. */
export function LabelPrivacyCard({ node }: { node: OwnerNode }) {
  return (
    <Card title="Label and privacy">
      <Setting title="Label" value={node.label || 'No label'} note={labelNote(node)} />
      <Setting
        title="Location"
        value={node.location_private ? 'Private' : 'Public'}
        note={node.location_private ? PRIVATE_DESCRIPTION : PUBLIC_DESCRIPTION}
      />
    </Card>
  );
}
