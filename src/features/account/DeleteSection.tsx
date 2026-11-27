import { useState } from 'react';
import { Alert } from 'react-native';

import { HttpError } from '@/api';
import { useAuth } from '@/auth';
import { Button, ThemedText } from '@/components';
import { sameEmail } from '@/features/auth';

import { Card } from './Card';
import { errorTextOf } from './model';
import { TextField } from './TextField';

/** Deletes the account once the address is typed and a second prompt is confirmed. */
export function DeleteSection({ email }: { email: string }) {
  const { deleteAccount, refreshAccount } = useAuth();
  const [typed, setTyped] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const matches = sameEmail(typed, email);

  const remove = async () => {
    if (deleting || !matches) return;
    setDeleting(true);
    setError(null);
    try {
      // On success the app goes to sign-in, which says the account is gone, and this screen
      // signs out. It stays only for an account someone signed in to meanwhile.
      await deleteAccount(typed.trim());
      setTyped('');
      setDeleting(false);
    } catch (e) {
      setError(errorTextOf(e));
      setDeleting(false);
      // Not the account's address: it may have changed outside the app, so it is read again.
      if (e instanceof HttpError && e.status === 400) void refreshAccount();
    }
  };

  const confirm = () =>
    Alert.alert('Delete your account?', 'This cannot be undone.', [
      { text: 'Keep my account', style: 'cancel' },
      { text: 'Yes, delete my account', style: 'destructive', onPress: () => void remove() },
    ]);

  return (
    <Card title="Delete account">
      <ThemedText color="error">
        Deleting your account releases your nodes so that anyone can claim them, signs out every
        device and removes the account. It cannot be undone.
      </ThemedText>
      <TextField
        label={`Type ${email} to confirm`}
        value={typed}
        onChangeText={(text) => {
          setTyped(text);
          setError(null);
        }}
        editable={!deleting}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="off"
        keyboardType="email-address"
        inputMode="email"
        error={error}
      />
      <Button
        variant="secondary"
        label={deleting ? 'Deleting…' : 'Delete account'}
        accessibilityLabel="Delete account"
        disabled={!matches || deleting}
        onPress={confirm}
      />
    </Card>
  );
}
