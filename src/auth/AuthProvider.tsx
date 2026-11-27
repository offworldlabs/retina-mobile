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
  confirmEmailChange as spendEmailChangeLink,
  consumeMagicLink,
  deleteMyAccount,
  fetchMe,
  logout,
  meQuery,
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
  /**
   * Spends a mailed address-change link. On success, a session that is still the one asking
   * takes the account's address as the server now reads it (the link may be another account's),
   * best effort. Rejects with the ApiError (HttpError 400 = link no longer valid, 409 = address
   * taken meanwhile; others as thrown) and then changes nothing.
   */
  confirmEmailChange(token: string): Promise<{ email: string }>;
  /**
   * Reads the account again and takes its address when it changed, as a change link opened
   * outside the app makes it. Only for the session that asked, while it is still the current
   * one and no deletion is out. A 401 ends the session as any request's does; any other failure
   * changes nothing. Never rejects.
   */
  refreshAccount(): Promise<void>;
  /**
   * Deletes the account once `email` matches its address. On success the server has ended
   * every session of it, so this one is forgotten locally at once (store, state, query cache)
   * with no logout to send, and the app goes to sign-in with a note saying the account is gone.
   * Rejects with the ApiError (HttpError 400 = not the account's address, 409 = a node claimed
   * meanwhile; others as thrown) and then leaves the session untouched.
   */
  deleteAccount(email: string): Promise<{ released: number }>;
}

const AuthContext = createContext<Auth | null>(null);

function stateOf(session: StoredSession | null): AuthState {
  return session ? { status: 'signed-in', email: session.email } : { status: 'signed-out' };
}

// SecureStore failures leave memory as the truth for this run: the app still signs requests,
// and only a restart could tell the difference.
const ignore = () => undefined;

/**
 * The session to keep once a read of /api/auth/me made with `read.token` answered `read.email`,
 * or null to keep `current` as it is. The answer says nothing once another session or none is
 * current, nor while a deletion is ending that one (`deleting`); the same address leaves nothing
 * to change.
 */
export function refreshedSessionOf(
  current: StoredSession | null,
  read: StoredSession,
  deleting: boolean,
): StoredSession | null {
  if (deleting || current?.token !== read.token || current.email === read.email) return null;
  return { token: read.token, email: read.email };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });
  const router = useRouter();
  const pathname = usePathname();
  const pathnameRef = useRef(pathname);
  // The session an account deletion is ending, while the deletion is out, and whether a 401 has
  // ended it meanwhile.
  const deletionRef = useRef<{ token: string; ended: boolean } | null>(null);
  // How many reads of the account have gone out, and the latest of them to answer, so an answer
  // that arrives after a later read's is not taken over it.
  const readsRef = useRef({ sent: 0, answered: 0 });

  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

  // The state is a view of the token store, read again after every change to it, so an answer
  // that arrives late can only ever show what the store holds now.
  const sync = useCallback(() => setState(stateOf(currentSession())), []);

  // Takes the app to sign-in, whose note `params` choose.
  const landOnSignIn = useCallback(
    (params: { reason: 'session-ended' } | { reason: 'account-deleted'; released: string }) => {
      // The link screens ask to sign in themselves once signed out, and a modal over them
      // would hide that.
      const path = pathnameRef.current;
      if (path.startsWith('/auth/link/') || path.startsWith('/auth/email/')) return;
      try {
        // useRouter's push only queues the navigation, which runs once the root navigator is
        // mounted, so a 401 to the restore's own check at start is safe too.
        router.push({ pathname: '/sign-in', params });
      } catch {
        // The session is already over; failing to show the note must not undo that.
      }
    },
    [router],
  );

  const noteSessionEnded = useCallback(
    () => landOnSignIn({ reason: 'session-ended' }),
    [landOnSignIn],
  );

  /**
   * Reads the account `token` signs in again and keeps its address when it changed. Another
   * session or none meanwhile, a later read's answer, a deletion out, and `wanted` turning false
   * each make the answer stale. Resolves whether it saved; rejects as fetchMe does.
   */
  const refreshEmail = useCallback(
    async (token: string, wanted: () => boolean = () => true): Promise<boolean> => {
      const reads = readsRef.current;
      const order = (reads.sent += 1);
      const user = await fetchMe();
      if (!wanted() || order < reads.answered) return false;
      reads.answered = order;
      const deleting = deletionRef.current !== null;
      const next = refreshedSessionOf(currentSession(), { token, email: user.email }, deleting);
      if (!next) return false;
      void saveSession(next).catch(ignore);
      // The account's own answer, so the screens keyed by the new address need not ask again.
      queryClient.setQueryData(meQuery(next.email).queryKey, user);
      return true;
    },
    [],
  );

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
      const deletion = deletionRef.current;
      // Ending the session is what a deletion does, so a 401 while one is out may be its doing:
      // the note waits for the deletion's answer.
      if (deletion?.token === token) {
        deletion.ended = true;
        return;
      }
      noteSessionEnded();
    });
    return () => {
      setAuthTokenProvider(null);
      setSessionEndedHandler(null);
    };
  }, [noteSessionEnded, sync]);

  useEffect(() => {
    let active = true;
    void (async () => {
      const restored = await restoreSession();
      if (!active) return;
      sync();
      if (!restored) return;
      try {
        if (await refreshEmail(restored.token, () => active)) sync();
      } catch {
        // A 401 has already ended the session through the client's hook. Offline, a timeout or
        // a 5xx say nothing about it, so it stays.
      }
    })();
    return () => {
      active = false;
    };
  }, [refreshEmail, sync]);

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

  const confirmEmailChange = useCallback(
    async (token: string) => {
      const { email } = await spendEmailChangeLink(token);
      const session = await restoreSession();
      if (session) {
        // A 401 has already ended the session through the client's hook. Offline, a timeout or
        // a 5xx leave the old address showing until the next start; the change itself is made.
        await refreshEmail(session.token).catch(ignore);
      }
      sync();
      return { email };
    },
    [refreshEmail, sync],
  );

  const refreshAccount = useCallback(async () => {
    const session = currentSession();
    // Before the restore at start there is none yet, and the start makes its own read. While a
    // deletion is out, the session is ending.
    if (!session || deletionRef.current) return;
    try {
      if (await refreshEmail(session.token)) sync();
    } catch {
      // A 401 has already ended the session through the client's hook. Offline, a timeout or
      // a 5xx say nothing about it, so it stays.
    }
  }, [refreshEmail, sync]);

  const deleteAccount = useCallback(
    async (email: string) => {
      const token = currentSession()?.token;
      const deletion = token ? { token, ended: false } : null;
      deletionRef.current = deletion;
      try {
        const { released } = await deleteMyAccount(email);
        // Forgotten in the same turn as the answer, so a 401 to a request still out finds no
        // session of its token to report ended. The server has ended it: no logout to send.
        if (deletion && currentSession()?.token === deletion.token) {
          void clearSession().catch(ignore);
          sync();
          queryClient.clear();
        }
        // Not over a session someone signed in to while the deletion was out, which stays.
        if (!currentSession()) landOnSignIn({ reason: 'account-deleted', released: `${released}` });
        return { released };
      } catch (error) {
        // The deletion failed, yet the session ended while it was out (its own 401 among them):
        // told as any other end.
        if (deletion?.ended) noteSessionEnded();
        throw error;
      } finally {
        if (deletionRef.current === deletion) deletionRef.current = null;
      }
    },
    [landOnSignIn, noteSessionEnded, sync],
  );

  const auth = useMemo<Auth>(
    () => ({ state, signInWithLink, signOut, confirmEmailChange, refreshAccount, deleteAccount }),
    [state, signInWithLink, signOut, confirmEmailChange, refreshAccount, deleteAccount],
  );
  return <AuthContext.Provider value={auth}>{children}</AuthContext.Provider>;
}

/** The session and the calls that change it. Only inside AuthProvider. */
export function useAuth(): Auth {
  const auth = useContext(AuthContext);
  if (!auth) throw new Error('useAuth must be used inside AuthProvider');
  return auth;
}
