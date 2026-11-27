import { useLocalSearchParams, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { View } from 'react-native';

import { requestMagicLink, userMessage } from '@/api';
import { useAuth } from '@/auth';
import { Button, ThemedText } from '@/components';
import { AuthScreen, EmailField, isValidEmail, sameEmail } from '@/features/auth';
import { Notice } from '@/features/network';
import { useTheme } from '@/theme';

type ResendNote = { text: string; failed: boolean };

export default function SignInScreen() {
  const router = useRouter();
  const { spacing } = useTheme();
  const { state } = useAuth();
  const { reason, email: emailParam } = useLocalSearchParams<{
    reason?: string;
    email?: string | string[];
  }>();
  // An address handed over by another screen, such as a node claimed for another account.
  const suggested = ((Array.isArray(emailParam) ? emailParam[0] : emailParam) ?? '').trim();
  const [email, setEmail] = useState(suggested);
  const [attempted, setAttempted] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [resendNote, setResendNote] = useState<ResendNote | null>(null);
  const [prefilled, setPrefilled] = useState(suggested);
  // A new address handed over while this screen is open starts the form over with it.
  if (suggested !== prefilled) {
    setPrefilled(suggested);
    if (suggested) {
      setEmail(suggested);
      setAttempted(false);
      setSendError(null);
      setSentTo(null);
      setResendNote(null);
    }
  }
  // Set before the first await, so a second tap in the same frame finds the request out.
  const inFlight = useRef(false);

  const close = () => (router.canDismiss() ? router.dismiss() : router.replace('/'));

  const submit = async () => {
    if (inFlight.current) return;
    setAttempted(true);
    const address = email.trim();
    if (!isValidEmail(address)) return;
    inFlight.current = true;
    setSending(true);
    setSendError(null);
    try {
      await requestMagicLink(address);
      setResendNote(null);
      setSentTo(address);
    } catch (error) {
      setSendError(userMessage(error));
    } finally {
      inFlight.current = false;
      setSending(false);
    }
  };

  const resend = async () => {
    if (inFlight.current || !sentTo) return;
    inFlight.current = true;
    setSending(true);
    setResendNote(null);
    try {
      await requestMagicLink(sentTo);
      setResendNote({ text: 'Sent again.', failed: false });
    } catch (error) {
      setResendNote({ text: userMessage(error), failed: true });
    } finally {
      inFlight.current = false;
      setSending(false);
    }
  };

  // Signed in, the form stays for another account's address only: the link it mails asks
  // before it switches.
  const otherAccount =
    state.status === 'signed-in' && suggested !== '' && !sameEmail(state.email, suggested);

  if (state.status === 'signed-in' && !otherAccount) {
    return (
      <AuthScreen title="Sign in">
        <ThemedText>{`You're signed in as ${state.email}.`}</ThemedText>
        <Button label="Close" variant="secondary" onPress={close} />
      </AuthScreen>
    );
  }

  if (sentTo) {
    return (
      <AuthScreen title="Check your email">
        <ThemedText color="secondary">
          {`We sent a sign-in link to ${sentTo}. Open it on this phone. It works once and expires in 15 minutes.`}
        </ThemedText>
        <View style={{ gap: spacing.lg }}>
          <Button
            label={sending ? 'Sending…' : 'Send the link again'}
            disabled={sending}
            onPress={() => void resend()}
          />
          {resendNote ? (
            <ThemedText
              variant="caption"
              color={resendNote.failed ? 'error' : 'secondary'}
              accessibilityRole={resendNote.failed ? 'alert' : undefined}
              accessibilityLiveRegion="polite"
              style={{ textAlign: 'center' }}
            >
              {resendNote.text}
            </ThemedText>
          ) : null}
          <Button
            label="Use a different email"
            variant="secondary"
            disabled={sending}
            onPress={() => {
              setResendNote(null);
              setSentTo(null);
            }}
          />
          <Button label="Close" variant="secondary" onPress={close} />
        </View>
      </AuthScreen>
    );
  }

  return (
    <AuthScreen title="Sign in">
      {reason === 'session-ended' ? (
        <Notice tone="warning" text="Your session ended. Sign in again." />
      ) : null}
      {state.status === 'signed-in' ? (
        <Notice
          text={`You're signed in as ${state.email}. The link will ask before it switches accounts.`}
        />
      ) : null}
      <EmailField
        value={email}
        onChangeText={(text) => {
          setEmail(text);
          setSendError(null);
        }}
        onSubmitEditing={() => void submit()}
        error={attempted && !isValidEmail(email.trim()) ? 'Enter a valid email address.' : null}
        autoFocus
      />
      <View style={{ gap: spacing.lg }}>
        <Button
          label={sending ? 'Sending…' : 'Email me a sign-in link'}
          disabled={sending}
          onPress={() => void submit()}
        />
        {sendError ? (
          <ThemedText color="error" accessibilityRole="alert">
            {sendError}
          </ThemedText>
        ) : null}
        <Button label="Close" variant="secondary" onPress={close} />
      </View>
    </AuthScreen>
  );
}
