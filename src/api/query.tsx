import {
  focusManager,
  onlineManager,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { AppState } from 'react-native';

import { HttpError, isRetryable } from './errors';
import { isOffline, subscribe } from './network';

const MAX_RETRIES = 2;
// A server asking for a longer wait gets the error shown instead of a silent spinner.
const MAX_RETRY_DELAY_MS = 30_000;

function retryAfterMsOf(error: unknown): number | null {
  return error instanceof HttpError ? error.retryAfterMs : null;
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // The server refreshes its analytics snapshot every 30 s.
      staleTime: 30_000,
      retry: (failureCount, error) =>
        failureCount < MAX_RETRIES &&
        isRetryable(error) &&
        (retryAfterMsOf(error) ?? 0) <= MAX_RETRY_DELAY_MS,
      retryDelay: (failureCount, error) =>
        retryAfterMsOf(error) ?? Math.min(1000 * 2 ** failureCount, MAX_RETRY_DELAY_MS),
    },
  },
});

onlineManager.setEventListener((setOnline) => {
  setOnline(!isOffline());
  return subscribe((offline) => setOnline(!offline));
});

focusManager.setEventListener((setFocused) => {
  const subscription = AppState.addEventListener('change', (status) => {
    setFocused(status === 'active');
  });
  return () => subscription.remove();
});

export function QueryProvider({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
