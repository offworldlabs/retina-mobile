import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';

import {
  consumeClaim,
  declineClaim,
  HttpError,
  OWNER_QUERY_ROOT,
  previewClaim,
  queryClient,
  resendClaimLink,
  userMessage,
} from '@/api';
import { useAuth } from '@/auth';
import { Button, ThemedText } from '@/components';
import { AuthScreen, StateBlock } from '@/features/auth';
import { Notice } from '@/features/network';
import { claimOutcome } from '@/features/nodes';

/** How long the new owner reads that the node is theirs before My nodes opens. */
const CLAIMED_REDIRECT_MS = 1200;

/** What a 429 on a renewal means: its limit is per node and can last up to an hour. */
const TOO_MANY_LINKS = 'Too many links have been asked for. Try again later.';

/** The request a failure came from, so Try again repeats it. The preview only reads the link. */
type Action = 'preview' | 'consume' | 'decline';

type Phase =
  | { step: 'checking' }
  | { step: 'asking'; nodeRef: string }
  /** The question stays up with its buttons held while a confirm or a decline is out. */
  | { step: 'working'; nodeRef: string; action: 'consume' | 'decline' }
  /** The node joined the account the link was mailed to, which `email` names. */
  | { step: 'claimed'; nodeRef: string; email: string }
  | { step: 'declined'; nodeRef: string }
  | { step: 'taken' }
  | { step: 'invalid' }
  | { step: 'failed'; action: Action; nodeRef: string | null; error: unknown };

/** A request for a new link, on the card that says this one is dead. */
type Renewal =
  { state: 'idle' | 'sending' | 'sent' | 'refused' } | { state: 'failed'; error: unknown };

function hasStatus(error: unknown, status: number): boolean {
  return error instanceof HttpError && error.status === status;
}

/** A refusal the same request would meet again: any 4xx but a 429. */
function isFinal(error: unknown): boolean {
  return error instanceof HttpError && error.status < 500 && error.status !== 429;
}

export default function ClaimLinkScreen() {
  const { token } = useLocalSearchParams<{ token?: string | string[] }>();
  const linkToken = (Array.isArray(token) ? token[0] : token) ?? '';
  // A second link opened over this one reuses the screen with a new token: start over for it.
  return <ClaimConfirmation key={linkToken} token={linkToken} />;
}

/**
 * A node's claim link, opened in the app. It names the node before either button, and asks as
 * the web's claim page does. Confirming adds the node to the account the link was mailed to;
 * the app's own session never changes here, whichever account that is.
 */
function ClaimConfirmation({ token }: { token: string }) {
  const router = useRouter();
  const { state } = useAuth();
  const [phase, setPhase] = useState<Phase>(token ? { step: 'checking' } : { step: 'invalid' });
  const [renewal, setRenewal] = useState<Renewal>({ state: 'idle' });
  // Bumped by Try again to run the preview once more.
  const [previewRun, setPreviewRun] = useState(0);
  const mounted = useRef(false);
  // Set before the request goes, so a second tap in the same frame finds it out.
  const answering = useRef(false);
  const renewing = useRef(false);

  const signedInEmail = state.status === 'signed-in' ? state.email : null;
  // Decided against the account signed in now, so a sign-out meanwhile never leads to My nodes.
  const outcome = phase.step === 'claimed' ? claimOutcome(signedInEmail, phase.email) : null;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // In component state, not the query cache: the link is a secret, and a cached preview of it
  // would outlive this screen.
  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    previewClaim(token, controller.signal).then(
      ({ nodeRef }) => {
        if (!controller.signal.aborted) setPhase({ step: 'asking', nodeRef });
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        // Only a 404 says the link is dead; anything else says nothing about it.
        setPhase(
          hasStatus(error, 404)
            ? { step: 'invalid' }
            : { step: 'failed', action: 'preview', nodeRef: null, error },
        );
      },
    );
    return () => controller.abort();
  }, [token, previewRun]);

  // Owned by the card that says the node is yours, so leaving it first clears the redirect.
  useEffect(() => {
    if (outcome !== 'yours') return;
    void queryClient.invalidateQueries({ queryKey: OWNER_QUERY_ROOT });
    const timer = setTimeout(() => router.dismissTo('/(tabs)/nodes'), CLAIMED_REDIRECT_MS);
    return () => clearTimeout(timer);
  }, [outcome, router]);

  const close = () => (router.canDismiss() ? router.dismiss() : router.replace('/'));
  // Back to a sign-in modal already under this one, else in place of this screen.
  const toSignIn = (email?: string) =>
    router.dismissTo(email ? { pathname: '/sign-in', params: { email } } : '/sign-in');

  const confirm = (nodeRef: string) => {
    if (answering.current) return;
    answering.current = true;
    setPhase({ step: 'working', nodeRef, action: 'consume' });
    consumeClaim(token).then(
      (claimed) => {
        answering.current = false;
        if (!mounted.current) return;
        setPhase({ step: 'claimed', nodeRef: claimed.nodeRef, email: claimed.user.email });
      },
      (error: unknown) => {
        answering.current = false;
        if (!mounted.current) return;
        // A 409: the link was real, and the node found an owner while it sat in the inbox.
        if (hasStatus(error, 409)) setPhase({ step: 'taken' });
        else if (hasStatus(error, 400)) setPhase({ step: 'invalid' });
        else setPhase({ step: 'failed', action: 'consume', nodeRef, error });
      },
    );
  };

  const decline = (nodeRef: string) => {
    if (answering.current) return;
    answering.current = true;
    setPhase({ step: 'working', nodeRef, action: 'decline' });
    declineClaim(token).then(
      () => {
        answering.current = false;
        if (mounted.current) setPhase({ step: 'declined', nodeRef });
      },
      (error: unknown) => {
        answering.current = false;
        if (!mounted.current) return;
        if (hasStatus(error, 400)) setPhase({ step: 'invalid' });
        else setPhase({ step: 'failed', action: 'decline', nodeRef, error });
      },
    );
  };

  const renew = () => {
    if (renewing.current) return;
    renewing.current = true;
    setRenewal({ state: 'sending' });
    resendClaimLink(token).then(
      () => {
        renewing.current = false;
        if (mounted.current) setRenewal({ state: 'sent' });
      },
      (error: unknown) => {
        renewing.current = false;
        if (!mounted.current) return;
        if (hasStatus(error, 404)) setRenewal({ state: 'refused' });
        else if (hasStatus(error, 409)) setPhase({ step: 'taken' });
        else setRenewal({ state: 'failed', error });
      },
    );
  };

  const closeButton = <Button label="Close" variant="secondary" onPress={close} />;

  const renderAsk = (nodeRef: string, pending: 'consume' | 'decline' | null) => (
    <StateBlock
      title={`Someone asked to connect node ${nodeRef} to this email address.`}
      message="If that was you, confirm below. If you do not recognise it, decline and nothing happens."
    >
      {signedInEmail ? (
        <Notice
          text={`You are signed in as ${signedInEmail}. Confirming adds node ${nodeRef} to the account this link was sent to, and the app stays signed in as ${signedInEmail}.`}
        />
      ) : null}
      <Button
        label={pending === 'consume' ? 'One moment…' : 'Yes, this is my node'}
        disabled={pending !== null}
        onPress={() => confirm(nodeRef)}
      />
      <Button
        label={pending === 'decline' ? 'One moment…' : 'I did not ask for this'}
        variant="secondary"
        disabled={pending !== null}
        onPress={() => decline(nodeRef)}
      />
    </StateBlock>
  );

  const renderInvalid = () => {
    const offersRenewal =
      token !== '' &&
      (renewal.state === 'idle' || renewal.state === 'sending' || renewal.state === 'failed');
    return (
      <StateBlock
        title="That link is no longer valid."
        message="Links last fifteen minutes and work once."
        tone="error"
      >
        {offersRenewal ? (
          <ThemedText color="secondary" style={{ textAlign: 'center' }}>
            Send a new link below, or ask for one from the node&apos;s setup page. Then use the
            newest email.
          </ThemedText>
        ) : null}
        {renewal.state === 'sent' ? (
          <ThemedText accessibilityLiveRegion="polite" style={{ textAlign: 'center' }}>
            A new link is on its way to the address the node gave. It lasts fifteen minutes.
          </ThemedText>
        ) : null}
        {renewal.state === 'refused' ? (
          <ThemedText
            color="error"
            accessibilityLiveRegion="polite"
            style={{ textAlign: 'center' }}
          >
            That link cannot be renewed. Ask for a new one from the node&apos;s setup page.
          </ThemedText>
        ) : null}
        {renewal.state === 'failed' ? (
          <ThemedText color="error" accessibilityRole="alert" style={{ textAlign: 'center' }}>
            {hasStatus(renewal.error, 429) ? TOO_MANY_LINKS : userMessage(renewal.error)}
          </ThemedText>
        ) : null}
        {offersRenewal ? (
          <Button label="Send a new link" disabled={renewal.state === 'sending'} onPress={renew} />
        ) : null}
        {signedInEmail === null ? (
          <Button
            label="Sign in instead"
            variant={offersRenewal ? 'secondary' : 'primary'}
            onPress={() => toSignIn()}
          />
        ) : null}
        {closeButton}
      </StateBlock>
    );
  };

  const renderFailed = (action: Action, nodeRef: string | null, error: unknown) => {
    const retry = () => {
      if (action === 'preview' || nodeRef === null) {
        setPhase({ step: 'checking' });
        setPreviewRun((run) => run + 1);
      } else if (action === 'consume') confirm(nodeRef);
      else decline(nodeRef);
    };
    const final = isFinal(error);
    // Nothing that spends the link ran when only the preview failed, or a 429 turned it away.
    const unspent = action === 'preview' || hasStatus(error, 429);
    return (
      <StateBlock message={userMessage(error)} tone="error">
        {final ? null : (
          <ThemedText variant="caption" color="secondary" style={{ textAlign: 'center' }}>
            {unspent ? 'Your link has not been used.' : 'Your link may still work.'}
          </ThemedText>
        )}
        {final ? null : <Button label="Try again" onPress={retry} />}
        {final && signedInEmail === null ? (
          <Button label="Sign in instead" onPress={() => toSignIn()} />
        ) : null}
        {closeButton}
      </StateBlock>
    );
  };

  const renderPhase = () => {
    const checking = <StateBlock busy message="Checking the link…" />;
    switch (phase.step) {
      case 'checking':
        return checking;
      case 'asking':
        // Who is signed in decides the note above the buttons, so they wait until that is known.
        return state.status === 'loading' ? checking : renderAsk(phase.nodeRef, null);
      case 'working':
        return renderAsk(phase.nodeRef, phase.action);
      case 'claimed':
        return outcome === 'yours' ? (
          <StateBlock
            busy
            title={`Node ${phase.nodeRef} is yours.`}
            message="Taking you to My nodes…"
          />
        ) : (
          <StateBlock title={`Node ${phase.nodeRef} is on the account for ${phase.email}.`}>
            <Button label={`Sign in as ${phase.email}`} onPress={() => toSignIn(phase.email)} />
            {closeButton}
          </StateBlock>
        );
      case 'declined':
        return (
          <StateBlock
            title="Declined."
            message={`Node ${phase.nodeRef} was not connected to this address, and nobody has been told who you are.`}
          >
            {closeButton}
          </StateBlock>
        );
      case 'taken':
        return (
          <StateBlock
            title="That node already belongs to someone else."
            message="If you bought it second hand, the previous owner needs to release it first."
            tone="error"
          >
            {closeButton}
          </StateBlock>
        );
      case 'invalid':
        return renderInvalid();
      case 'failed':
        return renderFailed(phase.action, phase.nodeRef, phase.error);
    }
  };

  return <AuthScreen centered>{renderPhase()}</AuthScreen>;
}
