/// <reference types="jest" />
import { act, createElement } from 'react';
import { createRoot } from 'test-renderer';

import { queryClient } from '@/api';
import { AuthProvider, useAuth, type AuthState } from '../AuthProvider';

// The app config the native build embeds; jest-expo's stand-in carries no `extra`.
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: {
      extra: {
        appEnv: 'development',
        apiBaseUrl: { ios: 'http://i.test', android: 'http://a.test' },
      },
    },
  },
}));

// The app opened on a node's claim link.
const mockRouter = { push: jest.fn() };
jest.mock('expo-router', () => ({
  usePathname: () => '/auth/claim/abc',
  useRouter: () => mockRouter,
}));

// Outside the mock factory, so it outlives a module reset the way the keychain outlives the app.
const mockKeychain = new Map<string, string>();

jest.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 0,
  getItemAsync: async (key: string) => mockKeychain.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => void mockKeychain.set(key, value),
  deleteItemAsync: async (key: string) => void mockKeychain.delete(key),
}));

type TokenStore = typeof import('../tokenStore');

// A new app run: the store's memory is gone, the keychain is not.
function startApp(): TokenStore {
  let store: TokenStore | undefined;
  jest.isolateModules(() => {
    store = jest.requireActual<TokenStore>('../tokenStore');
  });
  return store!;
}

const session = {
  token: 'k3Y_9-abcdefghijklmnopqrstuvwxyzABCDEFGHIJK',
  email: 'owner@example.com',
};

test('keeps the session across restarts until cleared, and drops a malformed one', async () => {
  await startApp().saveSession(session);

  const store = startApp();
  expect(store.currentSession()).toBeNull();
  await expect(store.restoreSession()).resolves.toEqual(session);
  const cleared = store.clearSession();
  expect(store.currentSession()).toBeNull();
  await cleared;
  expect(mockKeychain.has('retina.session')).toBe(false);

  mockKeychain.set('retina.session', JSON.stringify({ token: 'short', email: session.email }));
  await expect(startApp().restoreSession()).resolves.toBeNull();
  expect(mockKeychain.has('retina.session')).toBe(false);
});

test('a session that ends on the claim screen is cleared without a sign-in modal over it', async () => {
  mockKeychain.set('retina.session', JSON.stringify(session));
  queryClient.setQueryData(['owner', 'nodes'], []);
  // The server no longer knows the stored token: the start-up check answers 401.
  const server = jest.spyOn(globalThis, 'fetch').mockImplementation(
    async () =>
      new Response(JSON.stringify({ detail: 'Not authenticated' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
  );
  let state = { status: 'loading' } as AuthState;
  const Probe = () => {
    state = useAuth().state;
    return null;
  };
  const root = createRoot();
  await act(async () => root.render(createElement(AuthProvider, null, createElement(Probe))));
  for (let i = 0; i < 50 && state.status !== 'signed-out'; i++) {
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
  }
  await act(async () => root.unmount());
  server.mockRestore();

  expect(mockRouter.push).not.toHaveBeenCalled();
  expect(state).toEqual({ status: 'signed-out' });
  expect(mockKeychain.has('retina.session')).toBe(false);
  expect(queryClient.getQueryData(['owner', 'nodes'])).toBeUndefined();
});
