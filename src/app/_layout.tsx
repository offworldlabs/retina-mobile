import { Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { useEffect } from 'react';

import { QueryProvider } from '@/api';
import { AuthProvider } from '@/auth';
import { navigationThemes, useTheme } from '@/theme';

export const unstable_settings = { anchor: '(tabs)' };

export default function RootLayout() {
  const { scheme, colors } = useTheme();

  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(colors.bgPrimary);
  }, [colors.bgPrimary]);

  return (
    <QueryProvider>
      <AuthProvider>
        <ThemeProvider value={navigationThemes[scheme]}>
          <StatusBar style="auto" />
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="sign-in" options={{ presentation: 'modal' }} />
            <Stack.Screen name="auth/link/[token]" options={{ presentation: 'modal' }} />
            <Stack.Screen name="auth/email/[token]" options={{ presentation: 'modal' }} />
          </Stack>
        </ThemeProvider>
      </AuthProvider>
    </QueryProvider>
  );
}
