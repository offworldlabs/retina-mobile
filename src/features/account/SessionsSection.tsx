import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, View } from 'react-native';

import { mySessionsQuery, revokeMySession, revokeOtherSessions } from '@/api';
import { Button, ThemedText } from '@/components';
import { useTheme } from '@/theme';

import { Card } from './Card';
import { errorTextOf, revokedOthersMessage, sessionRowsOf, type SessionRow } from './model';

const DASH = '—';

/** What the busy state names when every other session is being signed out. */
const OTHERS = 'others';

/** Where the account is signed in, with each other device's session ended on its own or all at once. */
export function SessionsSection({ email }: { email: string }) {
  const { colors, spacing, radius } = useTheme();
  const queryClient = useQueryClient();
  const sessions = useQuery(mySessionsQuery(email));
  const rows = sessionRowsOf(sessions.data ?? []);
  const hasOthers = rows.some((row) => row.canSignOut);

  // A row id while that row is being signed out, OTHERS while every other one is.
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: mySessionsQuery(email).queryKey });

  const signOutRow = async (row: SessionRow) => {
    if (busy || !row.canSignOut) return;
    setBusy(row.id);
    setFailure(null);
    setDone(null);
    try {
      await revokeMySession(row.id);
      setDone(`Signed out ${row.device}.`);
      await refresh();
    } catch (e) {
      setFailure(`Could not sign out ${row.device}. ${errorTextOf(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const signOutOthers = async () => {
    if (busy) return;
    setBusy(OTHERS);
    setFailure(null);
    setDone(null);
    try {
      setDone(revokedOthersMessage(await revokeOtherSessions()));
      await refresh();
    } catch (e) {
      setFailure(`Could not sign out the other sessions. ${errorTextOf(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const confirmSignOutOthers = () =>
    Alert.alert(
      'Sign out everywhere else?',
      'Every other device will need a new email link to sign in again.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign out', style: 'destructive', onPress: () => void signOutOthers() },
      ],
    );

  let body;
  if (sessions.isPending) {
    body = <ThemedText color="muted">Loading…</ThemedText>;
  } else if (sessions.isError && !sessions.data) {
    body = (
      <View style={{ gap: spacing.lg }}>
        <ThemedText
          variant="caption"
          color="error"
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
        >
          {`Could not load your sessions. ${errorTextOf(sessions.error)}`}
        </ThemedText>
        <Button variant="secondary" label="Try again" onPress={() => void sessions.refetch()} />
      </View>
    );
  } else if (rows.length === 0) {
    body = <ThemedText color="muted">No signed-in devices to show.</ThemedText>;
  } else {
    body = (
      <View style={{ gap: spacing.lg }}>
        {rows.map((row) => (
          <View
            key={row.id}
            style={{
              gap: spacing.md,
              padding: spacing.lg,
              borderRadius: radius.md,
              borderWidth: 1,
              borderColor: colors.border,
              backgroundColor: colors.bgSunk,
            }}
          >
            <View
              style={{
                flexDirection: 'row',
                flexWrap: 'wrap',
                alignItems: 'center',
                gap: spacing.md,
              }}
            >
              <ThemedText variant="heading" style={{ flexShrink: 1 }}>
                {row.device}
              </ThemedText>
              {row.current ? (
                <View
                  style={{
                    paddingHorizontal: spacing.md,
                    paddingVertical: spacing.xs,
                    borderRadius: radius.sm,
                    backgroundColor: colors.accentWash,
                  }}
                >
                  <ThemedText variant="micro" color="accent">
                    This device
                  </ThemedText>
                </View>
              ) : null}
            </View>
            <Detail label="Network" value={row.network ?? DASH} mono />
            <Detail label="Last active" value={row.lastActive} />
            <Detail label="Signed in" value={row.signedIn} />
            {row.canSignOut ? (
              <Button
                variant="secondary"
                label={busy === row.id ? 'Signing out…' : 'Sign out'}
                accessibilityLabel={`Sign out ${row.device}`}
                disabled={busy !== null}
                onPress={() => void signOutRow(row)}
              />
            ) : null}
          </View>
        ))}
        {!hasOthers ? (
          <ThemedText variant="caption" color="muted">
            No other device is signed in to your account.
          </ThemedText>
        ) : null}
      </View>
    );
  }

  return (
    <Card
      title="Sessions"
      action={
        hasOthers ? (
          <Button
            variant="secondary"
            label={busy === OTHERS ? 'Signing out…' : 'Sign out everywhere else'}
            accessibilityLabel="Sign out everywhere else"
            disabled={busy !== null}
            onPress={confirmSignOutOthers}
          />
        ) : null
      }
    >
      {body}
      {failure ? (
        <ThemedText
          variant="caption"
          color="error"
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
        >
          {failure}
        </ThemedText>
      ) : null}
      {done ? (
        <ThemedText variant="caption" color="secondary" accessibilityLiveRegion="polite">
          {done}
        </ThemedText>
      ) : null}
    </Card>
  );
}

function Detail({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  const { spacing } = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: spacing.md }}>
      <ThemedText variant="caption" color="muted" style={{ width: 84 }}>
        {label}
      </ThemedText>
      <ThemedText
        variant={mono ? 'mono' : 'caption'}
        color="secondary"
        style={{ flex: 1 }}
        selectable
      >
        {value}
      </ThemedText>
    </View>
  );
}
