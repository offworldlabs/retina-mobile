import { Placeholder, Screen } from '@/components';

export default function NodesScreen() {
  return (
    <Screen title="My nodes">
      <Placeholder
        title="Your nodes"
        description="Your nodes, their status, events and signal charts will appear here after you sign in."
      />
    </Screen>
  );
}
