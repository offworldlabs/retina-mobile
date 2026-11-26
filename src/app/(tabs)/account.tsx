import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback } from 'react';
import { ActivityIndicator, Alert, AppState, View } from 'react-native';

import { useAuth } from '@/auth';
import { Button, Placeholder, Screen, ThemedText } from '@/components';
import { Card } from '@/features/account/Card';
import { DeleteSection } from '@/features/account/DeleteSection';
import { EmailSection } from '@/features/account/EmailSection';
import { ProfileSection } from '@/features/account/ProfileSection';
import { SessionsSection } from '@/features/account/SessionsSection';
import { useTheme } from '@/theme';

export default function AccountScreen() {
  const router = useRouter();
  const { state, signOut, refreshAccount } = useAuth();
  const { colors } = useTheme();

  // The address can change outside the app, by a link opened in the browser, so the account is
  // read again whenever this tab comes into view, and whenever the app comes back to the
  // foreground while it is in view.
  useFocusEffect(
    useCallback(() => {
      void refreshAccount();
      const subscription = AppState.addEventListener('change', (status) => {
        if (status === 'active') void refreshAccount();
      });
      return () => subscription.remove();
    }, [refreshAccount]),
  );

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
      <ProfileSection email={state.email} />
      <EmailSection email={state.email} />
      <SessionsSection email={state.email} />
      <Card title="API access">
        <ThemedText color="secondary">
          Keys let your own scripts and tools read network data through the data API.
        </ThemedText>
        <Button
          variant="secondary"
          label="API access"
          accessibilityLabel="Open API access"
          onPress={() => router.push('/account/api-access')}
        />
      </Card>
      <Button variant="secondary" label="Sign out" onPress={confirmSignOut} />
      <DeleteSection email={state.email} />
    </Screen>
  );
}
