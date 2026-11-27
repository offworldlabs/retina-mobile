import { Stack, useRouter } from 'expo-router';
import { ActivityIndicator, Platform, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@/auth';
import { Button, Placeholder } from '@/components';
import { ApiAccessCard } from '@/features/account/ApiAccessCard';
import { ApiKeysCard } from '@/features/account/ApiKeysCard';
import { useTheme } from '@/theme';

export default function ApiAccessScreen() {
  const router = useRouter();
  const { state } = useAuth();
  const { colors, spacing } = useTheme();
  const insets = useSafeAreaInsets();
  const android = Platform.OS === 'android';

  let body;
  if (state.status === 'loading') {
    body = (
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
  } else {
    body = (
      <ScrollView
        style={{ flex: 1, backgroundColor: colors.bgPrimary }}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          padding: spacing.xl,
          gap: spacing.xl,
          paddingBottom: spacing.xl + (android ? insets.bottom : 0),
          paddingLeft: spacing.xl + (android ? insets.left : 0),
          paddingRight: spacing.xl + (android ? insets.right : 0),
        }}
      >
        {state.status === 'signed-out' ? (
          <>
            <Placeholder
              title="You are not signed in"
              description="Sign in with your email to manage your API access."
            />
            <Button label="Sign in" onPress={() => router.push('/sign-in')} />
          </>
        ) : (
          <>
            <ApiAccessCard email={state.email} />
            <ApiKeysCard email={state.email} />
          </>
        )}
      </ScrollView>
    );
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: 'API access' }} />
      {body}
    </>
  );
}
