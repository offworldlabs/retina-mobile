import { useRouter } from 'expo-router';

import { Button, Placeholder, Screen } from '@/components';

export default function NotFoundScreen() {
  const router = useRouter();
  return (
    <Screen title="Not found" bottomInset>
      <Placeholder title="This screen does not exist" description="The link may be out of date." />
      <Button label="Back to the map" onPress={() => router.replace('/')} />
    </Screen>
  );
}
