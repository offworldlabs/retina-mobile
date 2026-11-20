import { useRouter } from 'expo-router';

import { Button, Placeholder, Screen } from '@/components';

export default function AccountScreen() {
  const router = useRouter();
  return (
    <Screen title="Account">
      <Placeholder
        title="You are not signed in"
        description="Your profile, sessions and API keys will appear here after you sign in."
      />
      <Button label="Sign in" onPress={() => router.push('/sign-in')} />
    </Screen>
  );
}
