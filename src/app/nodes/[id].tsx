import { useLocalSearchParams } from 'expo-router';

import { NodeDetailScreen } from '@/features/nodes/detail/NodeDetailScreen';

export default function NodeRoute() {
  const { id } = useLocalSearchParams<{ id?: string | string[] }>();
  const nodeId = (Array.isArray(id) ? id[0] : id) ?? '';
  // Another node opened over this one is a new page: its releases and hours start over.
  return <NodeDetailScreen key={nodeId} nodeId={nodeId} />;
}
