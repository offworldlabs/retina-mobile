import { useRouter } from 'expo-router';

import { Button, Placeholder, Screen } from '@/components';

export default function SignInScreen() {
  const router = useRouter();
  return (
    <Screen title="Sign in" bottomInset>
      <Placeholder
        title="Sign in with your email"
        description="Email sign-in is not available yet. A sign-in link that opens the app arrives in the next update."
      />
      <Button
        label="Close"
        variant="secondary"
        onPress={() => (router.canDismiss() ? router.dismiss() : router.replace('/'))}
      />
    </Screen>
  );
}
