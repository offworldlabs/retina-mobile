import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, View } from 'react-native';

import { myAccessQuery, myKeysQuery, revokeMyKey } from '@/api';
import { Button, ThemedText } from '@/components';
import { accessViewOf, errorTextOf, keyRowsOf } from '@/features/account/model';
import { useTheme } from '@/theme';

import { Card } from './Card';
import { CreateKeyPanel } from './CreateKeyPanel';

const statusColor = { Active: 'accent', Revoked: 'error', Paused: 'warning' } as const;

export function ApiKeysCard({ email }: { email: string }) {
  const { colors, spacing, radius } = useTheme();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const access = useQuery(myAccessQuery(email));
  const keys = useQuery({
    ...myKeysQuery(email),
    enabled: !!access.data && access.data.kind !== 'admin',
  });
  const revoke = useMutation({
    mutationFn: ({ id }: { id: string; name: string }) => revokeMyKey(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: myKeysQuery(email).queryKey }),
  });

  if (!access.data || access.data.kind === 'admin') return null;

  const { entitled } = access.data;
  const rows = keyRowsOf(keys.data ?? [], entitled);
  const canCreate = accessViewOf(access.data).canCreateKeys;

  const confirmRevoke = (id: string, name: string) =>
    Alert.alert(`Revoke ${name}?`, 'Anything using it stops working at once.', [
      { text: 'Keep', style: 'cancel' },
      { text: 'Revoke key', style: 'destructive', onPress: () => revoke.mutate({ id, name }) },
    ]);

  let list;
  if (keys.data) {
    list =
      rows.length === 0 ? (
        <ThemedText color="secondary">No keys yet</ThemedText>
      ) : (
        rows.map((row) => (
          <View
            key={row.id}
            style={{
              gap: spacing.sm,
              padding: spacing.lg,
              borderRadius: radius.md,
              borderWidth: 1,
              borderColor: colors.border,
              backgroundColor: colors.bgSunk,
            }}
          >
            <ThemedText variant="heading">{row.name}</ThemedText>
            <ThemedText variant="mono" color="secondary">
              {row.masked}
            </ThemedText>
            <ThemedText variant="caption" color="secondary">
              {`Created ${row.created}`}
            </ThemedText>
            <ThemedText variant="caption" color="secondary">
              {`Last used ${row.lastUsed}`}
            </ThemedText>
            <ThemedText variant="label" color={statusColor[row.status]}>
              {row.status}
            </ThemedText>
            {row.canRevoke && (
              <Button
                variant="secondary"
                label={revoke.isPending && revoke.variables?.id === row.id ? 'Revoking…' : 'Revoke'}
                accessibilityLabel={`Revoke ${row.name}`}
                disabled={revoke.isPending}
                onPress={() => confirmRevoke(row.id, row.name)}
              />
            )}
          </View>
        ))
      );
  } else if (keys.isError) {
    list = (
      <>
        <ThemedText color="error">
          {`Could not load your keys. ${errorTextOf(keys.error)}`}
        </ThemedText>
        <Button
          variant="secondary"
          label="Try again"
          disabled={keys.isFetching}
          onPress={() => void keys.refetch()}
        />
      </>
    );
  } else {
    list = <ThemedText color="secondary">Loading…</ThemedText>;
  }

  return (
    <Card
      title="Keys"
      action={
        canCreate && !creating ? (
          <Button label="Create key" onPress={() => setCreating(true)} />
        ) : undefined
      }
    >
      <View style={{ gap: spacing.lg }}>
        <ThemedText color="secondary">
          {'Send a key as the '}
          <ThemedText variant="mono">x-apikey</ThemedText>
          {' header or as '}
          <ThemedText variant="mono">{'Authorization: Bearer <key>'}</ThemedText>
          {'; websockets take '}
          <ThemedText variant="mono">{'?apikey=<key>'}</ThemedText>
          {'. A key works only while your access is active.'}
        </ThemedText>
        {creating && <CreateKeyPanel email={email} onClose={() => setCreating(false)} />}
        {list}
        {revoke.isError && (
          <ThemedText color="error">
            {`Could not revoke ${revoke.variables?.name ?? 'the key'}. ${errorTextOf(revoke.error)}`}
          </ThemedText>
        )}
        {!entitled && rows.length > 0 && (
          <ThemedText variant="caption" color="secondary">
            Keys are kept and refused until your access is active again.
          </ThemedText>
        )}
      </View>
    </Card>
  );
}
