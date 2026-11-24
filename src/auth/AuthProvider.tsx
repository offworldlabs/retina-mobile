import { usePathname, useRouter } from 'expo-router';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import {
  consumeMagicLink,
  fetchMe,
  logout,
  queryClient,
  setAuthTokenProvider,
  setSessionEndedHandler,
} from '@/api';

import {
  clearSession,
  currentSession,
  restoreSession,
  saveSession,
  type StoredSession,
} from './tokenStore';

export type AuthState =
  | { status: 'loading' } // restoring at start
  | { status: 'signed-out' }
  | { status: 'signed-in'; email: string };

export interface Auth {
  state: AuthState;
  /**
   * Consumes a mailed link as the app. On success: session saved, query cache cleared, state
   * signed-in, and any previous session (another account) logged out best effort afterwards.
   * Rejects with the ApiError (HttpError 400 = link used or expired; others as thrown) and then
   * leaves the current session untouched.
   */
  signInWithLink(linkToken: string): Promise<{ email: string }>;
  /**
   * Forgets the session locally at once (store, state, query cache), then logs it out on the
   * server with the old token, best effort. Never rejects.
   */
  signOut(): Promise<void>;
}

const AuthContext = createContext<Auth | null>(null);

function stateOf(session: StoredSession | null): AuthState {
  return session ? { status: 'signed-in', email: session.email } : { status: 'signed-out' };
}

// SecureStore failures leave memory as the truth for this run: the app still signs requests,
// and only a restart could tell the difference.
const ignore = () => undefined;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });
  const router = useRouter();
  const pathname = usePathname();
  const pathnameRef = useRef(pathname);

  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

  // The state is a view of the token store, read again after every change to it, so an answer
  // that arrives late can only ever show what the store holds now.
  const sync = useCallback(() => setState(stateOf(currentSession())), []);

  useEffect(() => {
    // Waits for the start-up restore, so requests made meanwhile are signed too.
    setAuthTokenProvider(async () => {
      await restoreSession();
      return currentSession()?.token ?? null;
    });
    setSessionEndedHandler((token) => {
      if (currentSession()?.token !== token) return;
      void clearSession().catch(ignore);
      sync();
      queryClient.clear();
      // The link screen asks to sign in itself once signed out; a modal over it would hide that.
      if (pathnameRef.current.startsWith('/auth/link/')) return;
      try {
        // useRouter's push only queues the navigation, which runs once the root navigator is
        // mounted, so a 401 to the restore's own check at start is safe too.
        router.push({ pathname: '/sign-in', params: { reason: 'session-ended' } });
      } catch {
        // The session is already over; failing to show the note must not undo that.
      }
    });
    return () => {
      setAuthTokenProvider(null);
      setSessionEndedHandler(null);
    };
  }, [router, sync]);

  useEffect(() => {
    let active = true;
    void (async () => {
      const restored = await restoreSession();
      if (!active) return;
      sync();
      if (!restored) return;
      try {
        const user = await fetchMe();
        const session = currentSession();
        // A sign-out or another sign-in meanwhile makes this answer stale.
        if (!active || session?.token !== restored.token || session.email === user.email) return;
        void saveSession({ token: session.token, email: user.email }).catch(ignore);
        sync();
      } catch {
        // A 401 has already ended the session through the client's hook. Offline, a timeout or
        // a 5xx say nothing about it, so it stays.
      }
    })();
    return () => {
      active = false;
    };
  }, [sync]);

  const signInWithLink = useCallback(
    async (linkToken: string) => {
      const { sessionToken, user } = await consumeMagicLink(linkToken);
      // A session restored after the link was spent is still the one being replaced.
      await restoreSession();
      const previous = currentSession();
      void saveSession({ token: sessionToken, email: user.email }).catch(ignore);
      queryClient.clear();
      sync();
      if (previous && previous.token !== sessionToken) void logout(previous.token).catch(ignore);
      return { email: user.email };
    },
    [sync],
  );

  const signOut = useCallback(async () => {
    const session = currentSession();
    const cleared = clearSession().catch(ignore);
    sync();
    queryClient.clear();
    if (session) await logout(session.token).catch(ignore);
    await cleared;
  }, [sync]);

  const auth = useMemo<Auth>(
    () => ({ state, signInWithLink, signOut }),
    [state, signInWithLink, signOut],
  );
  return <AuthContext.Provider value={auth}>{children}</AuthContext.Provider>;
}

/** The session and the calls that change it. Only inside AuthProvider. */
export function useAuth(): Auth {
  const auth = useContext(AuthContext);
  if (!auth) throw new Error('useAuth must be used inside AuthProvider');
  return auth;
}
