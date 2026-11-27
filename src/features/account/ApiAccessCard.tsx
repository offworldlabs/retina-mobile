import { useQuery } from '@tanstack/react-query';
import { View } from 'react-native';

import { myAccessQuery } from '@/api';
import { Button, ThemedText } from '@/components';
import { accessViewOf, errorTextOf } from '@/features/account/model';
import { useTheme } from '@/theme';

import { Card } from './Card';

export function ApiAccessCard({ email }: { email: string }) {
  const { colors, spacing, radius } = useTheme();
  const query = useQuery(myAccessQuery(email));
  const toneColor = {
    ok: colors.success,
    off: colors.error,
    info: colors.accent,
  } as const;

  let body;
  if (query.data) {
    const view = accessViewOf(query.data);
    body = (
      <>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md }}>
          {view.badges.map((badge) => (
            <View
              key={badge.label}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: spacing.md,
                paddingHorizontal: spacing.lg,
                paddingVertical: spacing.xs,
                borderRadius: radius.md,
                borderWidth: 1,
                borderColor: toneColor[badge.tone],
                backgroundColor: colors.bgSunk,
              }}
            >
              <View
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 4,
                  backgroundColor: toneColor[badge.tone],
                }}
              />
              <ThemedText variant="label">{badge.label}</ThemedText>
            </View>
          ))}
        </View>
        {view.lines.map((line) => (
          <ThemedText key={line} color="secondary">
            {line}
          </ThemedText>
        ))}
      </>
    );
  } else if (query.isError) {
    body = (
      <>
        <ThemedText color="error">
          {`Could not load your API access. ${errorTextOf(query.error)}`}
        </ThemedText>
        <Button
          variant="secondary"
          label="Try again"
          disabled={query.isFetching}
          onPress={() => void query.refetch()}
        />
      </>
    );
  } else {
    body = <ThemedText color="secondary">Loading…</ThemedText>;
  }

  return (
    <Card title="Access">
      <View style={{ gap: spacing.lg }}>{body}</View>
    </Card>
  );
}
