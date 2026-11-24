import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';

import { HttpError, previewMagicLink, userMessage } from '@/api';
import { useAuth, type AuthState } from '@/auth';
import { Button } from '@/components';
import { AuthScreen, sameEmail, StateBlock } from '@/features/auth';

/** A prompt whose confirm spends the link. */
type Confirmable =
  { kind: 'sign-in'; email: string } | { kind: 'switch'; current: string; email: string };

type Prompt = Confirmable | { kind: 'already'; current: string };

type Phase =
  | { step: 'checking' }
  | { step: 'dead' }
  | { step: 'preview-failed'; error: unknown }
  /** The link is good; which prompt follows from the auth state as it is now. */
  | { step: 'confirm'; email: string }
  /** The prompt is kept as it was tapped: the sign-in itself changes the auth state. */
  | { step: 'signing-in'; prompt: Confirmable }
  | { step: 'sign-in-failed'; prompt: Confirmable; error: unknown };

function promptFor(auth: AuthState, email: string): Prompt | null {
  if (auth.status === 'loading') return null;
  if (auth.status === 'signed-out') return { kind: 'sign-in', email };
  return sameEmail(auth.email, email)
    ? { kind: 'already', current: auth.email }
    : { kind: 'switch', current: auth.email, email };
}

function hasStatus(error: unknown, status: number): boolean {
  return error instanceof HttpError && error.status === status;
}

export default function SignInLinkScreen() {
  const { token } = useLocalSearchParams<{ token?: string | string[] }>();
  const linkToken = (Array.isArray(token) ? token[0] : token) ?? '';
  // A second link opened over this one reuses the screen with a new token: start over for it.
  return <LinkConfirmation key={linkToken} token={linkToken} />;
}

function LinkConfirmation({ token }: { token: string }) {
  const router = useRouter();
  const { state, signInWithLink } = useAuth();
  const [phase, setPhase] = useState<Phase>(token ? { step: 'checking' } : { step: 'dead' });
  // Bumped by Try again to run the preview once more.
  const [previewRun, setPreviewRun] = useState(0);
  const mounted = useRef(false);
  const signingIn = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // In component state, not the query cache: a sign-in clears the cache, and a refetch of the
  // link it just spent would flash "no longer valid" on the way out.
  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    previewMagicLink(token, controller.signal).then(
      ({ email }) => {
        if (!controller.signal.aborted) setPhase({ step: 'confirm', email });
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        setPhase(hasStatus(error, 404) ? { step: 'dead' } : { step: 'preview-failed', error });
      },
    );
    return () => controller.abort();
  }, [token, previewRun]);

  // Every modal goes, the sign-in one under this too, from a warm or a cold link alike.
  const toAccount = () => router.dismissTo('/(tabs)/account');
  const close = () => (router.canDismiss() ? router.dismissAll() : router.replace('/'));
  // Back to a sign-in modal already under this one, else in place of this screen.
  const requestNewLink = () => router.dismissTo('/sign-in');

  const confirm = (prompt: Confirmable) => {
    if (signingIn.current) return;
    signingIn.current = true;
    setPhase({ step: 'signing-in', prompt });
    signInWithLink(token).then(
      () => {
        // Closed meanwhile: the session is in, but the person has moved on.
        if (mounted.current) toAccount();
      },
      (error: unknown) => {
        signingIn.current = false;
        if (!mounted.current) return;
        setPhase(
          hasStatus(error, 400) ? { step: 'dead' } : { step: 'sign-in-failed', prompt, error },
        );
      },
    );
  };

  const renderPrompt = (prompt: Prompt, pending: boolean) => {
    switch (prompt.kind) {
      case 'sign-in':
        return (
          <StateBlock title={`Sign in as ${prompt.email}?`}>
            <Button
              label={pending ? 'Signing in…' : 'Sign in'}
              disabled={pending}
              onPress={() => confirm(prompt)}
            />
            <Button label="Cancel" variant="secondary" disabled={pending} onPress={close} />
          </StateBlock>
        );
      case 'switch':
        return (
          <StateBlock
            title="Switch account?"
            message={`You're signed in as ${prompt.current}. Sign in as ${prompt.email} instead?`}
          >
            <Button
              label={pending ? 'Switching…' : 'Switch account'}
              disabled={pending}
              onPress={() => confirm(prompt)}
            />
            <Button label="Cancel" variant="secondary" disabled={pending} onPress={close} />
          </StateBlock>
        );
      case 'already':
        return (
          <StateBlock
            title="Already signed in"
            message={`You're already signed in as ${prompt.current}.`}
          >
            <Button label="Continue" onPress={toAccount} />
          </StateBlock>
        );
    }
  };

  const renderPhase = () => {
    const checking = <StateBlock busy message="Checking your sign-in link…" />;
    switch (phase.step) {
      case 'checking':
        return checking;
      case 'dead':
        return (
          <StateBlock
            title="That sign-in link is no longer valid"
            message="Sign-in links work once and expire 15 minutes after they're sent."
          >
            <Button label="Request a new link" onPress={requestNewLink} />
            <Button label="Close" variant="secondary" onPress={close} />
          </StateBlock>
        );
      case 'preview-failed':
        return (
          <StateBlock
            title="Couldn't check the link"
            message={userMessage(phase.error)}
            tone="error"
          >
            <Button
              label="Try again"
              onPress={() => {
                setPhase({ step: 'checking' });
                setPreviewRun((run) => run + 1);
              }}
            />
            <Button label="Close" variant="secondary" onPress={close} />
          </StateBlock>
        );
      case 'confirm': {
        const prompt = promptFor(state, phase.email);
        return prompt ? renderPrompt(prompt, false) : checking;
      }
      case 'signing-in':
        return renderPrompt(phase.prompt, true);
      case 'sign-in-failed': {
        const { prompt } = phase;
        return (
          <StateBlock title="Couldn't sign in" message={userMessage(phase.error)} tone="error">
            <Button label="Try again" onPress={() => confirm(prompt)} />
            <Button label="Close" variant="secondary" onPress={close} />
          </StateBlock>
        );
      }
    }
  };

  return <AuthScreen centered>{renderPhase()}</AuthScreen>;
}
