import { useState } from 'react';

import { requestEmailChange } from '@/api';
import { Button, ThemedText } from '@/components';
import { isValidEmail, sameEmail } from '@/features/auth';

import { Card } from './Card';
import { errorTextOf } from './model';
import { TextField } from './TextField';

/** How long a link lasts, in minutes, when the answer does not say. */
const LINK_MINUTES = 15;

function minutesOf(seconds: number | null): number {
  const minutes = seconds === null ? NaN : Math.round(seconds / 60);
  return Number.isFinite(minutes) && minutes > 0 ? minutes : LINK_MINUTES;
}

/** Asks for a link to a new sign-in address; the change is made when that link is opened. */
export function EmailSection({ email }: { email: string }) {
  const [draft, setDraft] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  // `from` is the address in use when the link was asked for: once the account holds another,
  // the link is no longer on its way.
  const [sent, setSent] = useState<{ to: string; minutes: number; from: string } | null>(null);

  const address = draft.trim();
  const checkError = !attempted
    ? null
    : !isValidEmail(address)
      ? 'Enter a valid email address.'
      : sameEmail(address, email)
        ? 'That is already your sign-in address.'
        : null;

  const submit = async () => {
    if (sending || !address) return;
    setAttempted(true);
    setSent(null);
    if (!isValidEmail(address) || sameEmail(address, email)) return;
    setSending(true);
    setFailure(null);
    try {
      const answer = await requestEmailChange(address);
      setSent({
        to: answer.email || address,
        minutes: minutesOf(answer.expiresIn),
        from: email,
      });
      setDraft('');
      setAttempted(false);
    } catch (e) {
      setFailure(errorTextOf(e));
    } finally {
      setSending(false);
    }
  };

  return (
    <Card title="Sign-in address">
      <ThemedText color="secondary">
        Sign-in links go to {email}. To use another address, we send a link to it, and the change is
        made when you open it.
      </ThemedText>
      <TextField
        label="New address"
        value={draft}
        onChangeText={(text) => {
          setDraft(text);
          setAttempted(false);
          setFailure(null);
        }}
        onSubmitEditing={() => void submit()}
        editable={!sending}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        textContentType="emailAddress"
        returnKeyType="send"
        error={checkError ?? failure}
      />
      <Button
        label={sending ? 'Sending…' : 'Send link'}
        accessibilityLabel="Send link"
        disabled={sending || !address}
        onPress={() => void submit()}
      />
      {sent && sent.from === email ? (
        <ThemedText variant="caption" color="secondary" accessibilityLiveRegion="polite">
          {`A link is on its way to ${sent.to}. It lasts ${sent.minutes} ${sent.minutes === 1 ? 'minute' : 'minutes'}. Until it is opened, ${email} still signs you in.`}
        </ThemedText>
      ) : null}
    </Card>
  );
}
