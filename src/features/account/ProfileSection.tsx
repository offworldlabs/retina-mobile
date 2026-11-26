import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { View } from 'react-native';

import { meQuery, updateMyName } from '@/api';
import { Button, ThemedText } from '@/components';
import { useTheme } from '@/theme';

import { Card } from './Card';
import { errorTextOf } from './model';
import { TextField } from './TextField';

/** The longest name the server keeps, in characters once trimmed. */
const NAME_MAX_CHARS = 64;

/** The account's address and display name, with the name editable in place. */
export function ProfileSection({ email }: { email: string }) {
  const { spacing } = useTheme();
  const queryClient = useQueryClient();
  const me = useQuery(meQuery(email));
  const name = me.data?.name ?? null;

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const open = () => {
    setDraft(name ?? '');
    setError(null);
    setDone(null);
    setEditing(true);
  };

  const close = () => {
    setEditing(false);
    setError(null);
  };

  const save = async () => {
    if (saving) return;
    // Nothing to change, and nothing for the server to record.
    if (draft.trim() === (name ?? '').trim()) {
      close();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const user = await updateMyName(draft.trim());
      queryClient.setQueryData(meQuery(email).queryKey, user);
      setEditing(false);
      setDone('Name saved.');
    } catch (e) {
      setError(errorTextOf(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card title="Profile">
      <View style={{ gap: spacing.xs }}>
        <ThemedText variant="label" color="secondary">
          Signed in as
        </ThemedText>
        <ThemedText variant="heading" selectable>
          {email}
        </ThemedText>
        <ThemedText variant="caption" color="muted">
          Sign-in links are sent here.
        </ThemedText>
      </View>

      <View style={{ gap: spacing.md }}>
        <ThemedText variant="label" color="secondary">
          Display name
        </ThemedText>
        {editing ? (
          <>
            <TextField
              label="Display name"
              value={draft}
              onChangeText={(text) => {
                setDraft(text);
                setError(null);
              }}
              onSubmitEditing={() => void save()}
              editable={!saving}
              autoFocus
              autoCapitalize="words"
              autoComplete="name"
              returnKeyType="done"
              error={error}
            />
            <ThemedText variant="caption" color="muted">
              Up to {NAME_MAX_CHARS} characters.
            </ThemedText>
            <Button
              label={saving ? 'Saving…' : 'Save'}
              accessibilityLabel="Save"
              disabled={saving}
              onPress={() => void save()}
            />
            <Button variant="secondary" label="Cancel" disabled={saving} onPress={close} />
          </>
        ) : me.isPending ? (
          <ThemedText color="muted">Loading…</ThemedText>
        ) : me.isError ? (
          <ThemedText
            variant="caption"
            color="error"
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
          >
            {`Could not load your name. ${errorTextOf(me.error)}`}
          </ThemedText>
        ) : (
          <>
            <ThemedText color={name ? 'primary' : 'muted'} selectable>
              {name || 'Not set'}
            </ThemedText>
            <ThemedText variant="caption" color="muted">
              {name
                ? 'The header shows it in place of your address.'
                : 'Without one, the header shows your address.'}
            </ThemedText>
            <Button
              variant="secondary"
              label="Edit"
              accessibilityLabel="Edit display name"
              onPress={open}
            />
          </>
        )}
        {done && !editing ? (
          <ThemedText variant="caption" color="secondary" accessibilityLiveRegion="polite">
            {done}
          </ThemedText>
        ) : null}
      </View>
    </Card>
  );
}
