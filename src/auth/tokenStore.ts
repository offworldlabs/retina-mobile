import * as SecureStore from 'expo-secure-store';

/** The signed-in session as the app keeps it: the bearer token and the account it signs in. */
export interface StoredSession {
  token: string;
  email: string;
}

const KEY = 'retina.session';
// Readable after the first unlock, so later background work can use it, and never carried to
// another device by a backup.
const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};
// secrets.token_urlsafe(32) on the server (core/sessions.py).
const SESSION_TOKEN = /^[A-Za-z0-9_-]{43}$/;

let current: StoredSession | null = null;
// Bumped by every save and clear, so a restore that reads while one is made leaves it alone.
let generation = 0;
let restored: Promise<void> | null = null;
let writes: Promise<void> = Promise.resolve();

/** Whether `value` has the shape of a session token the server issues. */
export function isSessionToken(value: unknown): value is string {
  return typeof value === 'string' && SESSION_TOKEN.test(value);
}

// One SecureStore call at a time, in the order made: the native side does not promise to keep
// two in order, and a clear overtaken by an older save would bring the session back next start.
function serial<T>(operation: () => Promise<T>): Promise<T> {
  const result = writes.then(operation);
  writes = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function parse(raw: string): StoredSession | null {
  try {
    const { token, email }: Partial<Record<keyof StoredSession, unknown>> = JSON.parse(raw) ?? {};
    return isSessionToken(token) && typeof email === 'string' && email !== ''
      ? { token, email }
      : null;
  } catch {
    return null;
  }
}

async function load(): Promise<void> {
  const before = generation;
  // Undefined when the read throws, which can be passing (keychain locked before the first unlock):
  // no session for this run, but the stored one stays for the next.
  const raw = await SecureStore.getItemAsync(KEY, OPTIONS).catch(() => undefined);
  // A save or clear made meanwhile wins; its own write is queued behind this.
  if (generation !== before || raw === undefined || raw === null) return;
  const session = parse(raw);
  if (session) {
    current = session;
    return;
  }
  // Dropped, so a value that cannot be used is not read again at every start.
  await SecureStore.deleteItemAsync(KEY, OPTIONS).catch(() => undefined);
}

/** Reads the stored session into memory, once per app run. Never rejects; null when there is none. */
export async function restoreSession(): Promise<StoredSession | null> {
  restored ??= serial(load);
  await restored;
  return current;
}

/** The session in memory, or null when signed out or not yet restored. */
export function currentSession(): StoredSession | null {
  return current;
}

/** Keeps `session`: in memory at once, then in SecureStore. */
export function saveSession(session: StoredSession): Promise<void> {
  current = { token: session.token, email: session.email };
  generation += 1;
  const value = JSON.stringify(current);
  return serial(() => SecureStore.setItemAsync(KEY, value, OPTIONS));
}

/** Forgets the session: in memory at once, then in SecureStore. */
export function clearSession(): Promise<void> {
  current = null;
  generation += 1;
  return serial(() => SecureStore.deleteItemAsync(KEY, OPTIONS));
}
