import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';

import { HttpError, previewEmailChange } from '@/api';
import { useAuth } from '@/auth';
import { Button } from '@/components';
import { AuthScreen, StateBlock } from '@/features/auth';
import { errorTextOf } from '@/features/account/model';

type Phase =
  | { step: 'checking' }
  | { step: 'ask'; email: string }
  | { step: 'working'; email: string }
  | { step: 'done'; email: string }
  | { step: 'taken' }
  | { step: 'invalid' }
  | { step: 'preview-failed'; error: unknown }
  | { step: 'confirm-failed'; email: string; error: unknown };

function hasStatus(error: unknown, status: number): boolean {
  return error instanceof HttpError && error.status === status;
}

export default function EmailChangeScreen() {
  const { token } = useLocalSearchParams<{ token?: string | string[] }>();
  const linkToken = (Array.isArray(token) ? token[0] : token) ?? '';
  // A second link opened over this one reuses the screen with a new token: start over for it.
  return <EmailChange key={linkToken} token={linkToken} />;
}

function EmailChange({ token }: { token: string }) {
  const router = useRouter();
  const { state, confirmEmailChange } = useAuth();
  const [phase, setPhase] = useState<Phase>(token ? { step: 'checking' } : { step: 'invalid' });
  // Bumped by Try again to run the preview once more.
  const [previewRun, setPreviewRun] = useState(0);
  const mounted = useRef(false);
  const confirming = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // The preview does not spend the link: only the confirm button does, since mail scanners fetch links.
  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    previewEmailChange(token, controller.signal).then(
      ({ email }) => {
        if (!controller.signal.aborted) setPhase({ step: 'ask', email });
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        setPhase(hasStatus(error, 404) ? { step: 'invalid' } : { step: 'preview-failed', error });
      },
    );
    return () => controller.abort();
  }, [token, previewRun]);

  const signedIn = state.status === 'signed-in';
  const close = () => (router.canGoBack() ? router.back() : router.replace('/(tabs)'));
  const leave = () => router.replace(signedIn ? '/(tabs)/account' : '/(tabs)');

  const confirm = (email: string) => {
    if (confirming.current) return;
    confirming.current = true;
    setPhase({ step: 'working', email });
    confirmEmailChange(token).then(
      ({ email: changed }) => {
        confirming.current = false;
        if (mounted.current) setPhase({ step: 'done', email: changed });
      },
      (error: unknown) => {
        confirming.current = false;
        if (!mounted.current) return;
        if (hasStatus(error, 409)) setPhase({ step: 'taken' });
        else if (hasStatus(error, 400)) setPhase({ step: 'invalid' });
        else setPhase({ step: 'confirm-failed', email, error });
      },
    );
  };

  const renderAsk = (email: string, pending: boolean) => (
    <StateBlock
      title={`Use ${email} to sign in to RETINA?`}
      message="If that was not you, close this screen and nothing changes."
    >
      <Button
        label={pending ? 'One moment…' : 'Yes, use this address'}
        disabled={pending}
        onPress={() => confirm(email)}
      />
      <Button label="Cancel" variant="secondary" disabled={pending} onPress={close} />
    </StateBlock>
  );

  const renderPhase = () => {
    const checking = <StateBlock busy message="Checking the link…" />;
    switch (phase.step) {
      case 'checking':
        return checking;
      case 'ask':
        // Who is signed in decides where the buttons below lead, so they wait until that is known.
        return state.status === 'loading' ? checking : renderAsk(phase.email, false);
      case 'working':
        return renderAsk(phase.email, true);
      case 'done':
        return (
          <StateBlock title="Done" message={`Your sign-in address is now ${phase.email}.`}>
            <Button label="Continue" onPress={leave} />
          </StateBlock>
        );
      case 'taken':
        return (
          <StateBlock
            title="Address already in use"
            message="That address now belongs to another account."
            tone="error"
          >
            <Button
              label={signedIn ? 'Go to your account' : 'Close'}
              onPress={signedIn ? leave : close}
            />
          </StateBlock>
        );
      case 'invalid':
        return (
          <StateBlock
            title="That link is no longer valid"
            message="Links last fifteen minutes and work once."
            tone="error"
          >
            <Button
              label={signedIn ? 'Go to your account' : 'Close'}
              onPress={signedIn ? leave : close}
            />
          </StateBlock>
        );
      case 'preview-failed':
        return (
          <StateBlock
            title="Couldn't check the link"
            message={errorTextOf(phase.error)}
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
      case 'confirm-failed': {
        const { email } = phase;
        return (
          <StateBlock
            title="Couldn't change the address"
            message={errorTextOf(phase.error)}
            tone="error"
          >
            <Button label="Try again" onPress={() => confirm(email)} />
            <Button label="Close" variant="secondary" onPress={close} />
          </StateBlock>
        );
      }
    }
  };

  return <AuthScreen centered>{renderPhase()}</AuthScreen>;
}
