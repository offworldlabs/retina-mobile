/// <reference types="jest" />
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
