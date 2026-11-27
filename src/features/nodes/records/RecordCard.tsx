import type { ReactNode } from 'react';
import { View } from 'react-native';

import { userMessage } from '@/api';
import { ThemedText } from '@/components';
import { Notice } from '@/features/network';
import { useTheme } from '@/theme';

import { Note } from './parts';

export type RecordCardProps = {
  title: string;
  /** What the failure notice calls the record: "the last report". */
  what: string;
  /** Small print beside the title, once there is an answer to describe. */
  aside: string | null;
  /** The records' load failure, if any. */
  error: unknown | null;
  /** True while this record's first answer is still to come. */
  loading: boolean;
  /** True when the card has nothing to draw: with a failure standing, an empty answer would be
   *  a false one, so the failure stands in for it. What did load stays up. */
  empty: boolean;
  children: ReactNode;
};

/** A card for one record of the node: its title, its small print, and its answer. */
export function RecordCard({
  title,
  what,
  aside,
  error,
  loading,
  empty,
  children,
}: RecordCardProps) {
  const { colors, spacing, radius } = useTheme();
  const waiting = loading && empty;
  const failed = error != null && empty && !waiting;
  return (
    <View
      style={{
        gap: spacing.lg,
        padding: spacing.xl,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.bgCard,
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          columnGap: spacing.lg,
          rowGap: spacing.xs,
        }}
      >
        <ThemedText variant="heading" accessibilityRole="header">
          {title}
        </ThemedText>
        {!waiting && !failed && aside && (
          <ThemedText variant="caption" color="muted">
            {aside}
          </ThemedText>
        )}
      </View>
      {waiting ? (
        <Note text="Loading…" />
      ) : failed ? (
        <Notice tone="warning" text={`Could not load ${what}: ${userMessage(error)}`} />
      ) : (
        children
      )}
    </View>
  );
}
