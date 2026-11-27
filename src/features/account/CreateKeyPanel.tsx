import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Share, View } from 'react-native';

import { createMyKey, myKeysQuery } from '@/api';
import { Button, ThemedText } from '@/components';
import { errorTextOf, KEY_NAME_MAX, keyNameError } from '@/features/account/model';
import { useTheme } from '@/theme';

import { TextField } from './TextField';

type CreatedKey = { name: string; key: string };

/**
 * The create form and, once a key exists, the one view that shows it. The key lives only in this
 * component's state: it is not cached, logged or passed on, and leaving the panel discards it.
 */
export function CreateKeyPanel({ email, onClose }: { email: string; onClose: () => void }) {
  const { colors, spacing, radius } = useTheme();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedKey | null>(null);
  const [shareFailed, setShareFailed] = useState(false);

  const create = async () => {
    if (busy) return;
    if (keyNameError(name)) {
      setTried(true);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const made = await createMyKey(name.trim());
      setCreated({ name: made.name, key: made.key });
      void queryClient.invalidateQueries({ queryKey: myKeysQuery(email).queryKey });
    } catch (e) {
      setError(errorTextOf(e));
    }
    setBusy(false);
  };

  const share = async (key: string) => {
    setShareFailed(false);
    try {
      await Share.share({ message: key });
    } catch {
      setShareFailed(true);
    }
  };

  const done = () => {
    setCreated(null);
    onClose();
  };

  const panelStyle = {
    gap: spacing.lg,
    padding: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.bgSunk,
  } as const;

  if (created) {
    return (
      <View style={panelStyle}>
        <ThemedText variant="heading">Your new key</ThemedText>
        <ThemedText color="secondary">
          Copy it now and keep it somewhere safe. This is the only time the key is shown. If it is
          lost, revoke it and create another.
        </ThemedText>
        <ThemedText variant="label" color="secondary">
          {created.name}
        </ThemedText>
        <ThemedText variant="mono" selectable accessibilityLabel="New API key">
          {created.key}
        </ThemedText>
        {shareFailed && <ThemedText color="error">Could not open the share sheet.</ThemedText>}
        <Button label="Share" onPress={() => void share(created.key)} />
        <Button variant="secondary" label="Done" onPress={done} />
      </View>
    );
  }

  return (
    <View style={panelStyle}>
      <ThemedText variant="heading">Create key</ThemedText>
      <ThemedText color="secondary">
        Name it for what will use it. The key is shown once, after you create it.
      </ThemedText>
      <TextField
        label="Name"
        value={name}
        onChangeText={setName}
        maxLength={KEY_NAME_MAX}
        editable={!busy}
        autoCapitalize="none"
        autoCorrect={false}
        error={tried ? keyNameError(name) : null}
        onSubmitEditing={() => void create()}
      />
      {error && <ThemedText color="error">{error}</ThemedText>}
      <Button label={busy ? 'Creating…' : 'Create'} disabled={busy} onPress={() => void create()} />
      <Button variant="secondary" label="Cancel" disabled={busy} onPress={onClose} />
    </View>
  );
}
