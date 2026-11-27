import { useRouter } from 'expo-router';
import { View } from 'react-native';

import { Button, ThemedText } from '@/components';
import { useTheme } from '@/theme';

import type { SearchAccess } from './access';

/** What the search covers for this visitor. Calm text, never an error. */
export function AccessNote({ access }: { access: SearchAccess }) {
  const router = useRouter();
  const { colors, spacing, radius } = useTheme();
  if (access.kind !== 'signed-out' && access.kind !== 'view-only') return null;
  const viewOnly = access.kind === 'view-only';
  return (
    <View
      style={{
        gap: spacing.md,
        padding: spacing.lg,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.bgCard,
      }}
    >
      <ThemedText variant="label" color="secondary">
        {viewOnly
          ? "Search covers the aircraft in the map's view. Whole-network search and older track history come with API access."
          : "Search covers the aircraft in the map's view."}
      </ThemedText>
      {viewOnly && access.reasonLine !== null ? (
        <ThemedText variant="caption" color="secondary">
          {access.reasonLine}
        </ThemedText>
      ) : null}
      {viewOnly && access.earnLine !== null ? (
        <ThemedText variant="caption" color="secondary">
          {access.earnLine}
        </ThemedText>
      ) : null}
      {access.kind === 'signed-out' ? (
        <Button label="Sign in" onPress={() => router.push('/sign-in')} />
      ) : null}
    </View>
  );
}
