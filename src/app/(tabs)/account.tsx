import { useRouter } from 'expo-router';
import { ActivityIndicator, Alert, View } from 'react-native';

import { useAuth } from '@/auth';
import { Button, Placeholder, Screen, ThemedText } from '@/components';
import { useTheme } from '@/theme';

export default function AccountScreen() {
  const router = useRouter();
  const { state, signOut } = useAuth();
  const { colors, spacing, radius } = useTheme();

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
      <Screen title="Account">
        <Placeholder
          title="You are not signed in"
          description="Sign in with your email to see your nodes and account."
        />
        <Button label="Sign in" onPress={() => router.push('/sign-in')} />
      </Screen>
    );
  }

  const confirmSignOut = () =>
    Alert.alert('Sign out?', "You'll need a new email link to sign in again.", [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => void signOut() },
    ]);

  return (
    <Screen title="Account">
      <View
        style={{
          padding: spacing.xl,
          gap: spacing.md,
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.bgCard,
        }}
      >
        <ThemedText variant="label" color="secondary">
          Signed in as
        </ThemedText>
        <ThemedText variant="heading" selectable>
          {state.email}
        </ThemedText>
      </View>
      <Button variant="secondary" label="Sign out" onPress={confirmSignOut} />
    </Screen>
  );
}
