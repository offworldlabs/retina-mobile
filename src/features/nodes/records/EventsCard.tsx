import { View } from 'react-native';

import type { OwnerEvent } from '@/api';
import { ThemedText } from '@/components';
import { useTheme } from '@/theme';

import { Dot, Note, When } from './parts';
import { RecordCard } from './RecordCard';
import { eventsAside, eventView } from './values';

/** The decisions recorded about the node since it joined the account: its trust, its label and
 *  its privacy, and whose side each came from. In the order the route sends them, newest first:
 *  their stamps are to the second, so sorting here could only swap two made in one second. */
export function EventsCard({
  events,
  error,
  loading,
  now,
}: {
  events: readonly OwnerEvent[];
  error: unknown | null;
  loading: boolean;
  now: number;
}) {
  const { colors, spacing } = useTheme();
  return (
    <RecordCard
      title="History"
      what="this node's history"
      aside={eventsAside(events.length)}
      error={error}
      loading={loading}
      empty={events.length === 0}
    >
      {events.length === 0 ? (
        <Note text="Nothing recorded since this node joined your account." />
      ) : (
        <View>
          {events.map((event, i) => {
            const view = eventView(event);
            const last = i === events.length - 1;
            return (
              <View
                key={i}
                style={{
                  flexDirection: 'row',
                  alignItems: 'flex-start',
                  gap: spacing.lg,
                  paddingTop: i === 0 ? 0 : spacing.md,
                  paddingBottom: last ? 0 : spacing.md,
                  borderBottomWidth: last ? 0 : 1,
                  borderBottomColor: colors.border,
                }}
              >
                {/* Centred on the first line of the text beside it. */}
                <View style={{ marginTop: spacing.sm + 1 }}>
                  <Dot tone={view.tone} />
                </View>
                <View style={{ flex: 1, minWidth: 0, gap: spacing.xs / 2 }}>
                  <ThemedText variant="body" color="secondary">
                    <ThemedText variant="body" style={{ fontWeight: '600' }}>
                      {view.label}
                    </ThemedText>
                    {view.actor && ` ${view.actor}`}
                  </ThemedText>
                  <When at={view.at} now={now} variant="caption" />
                </View>
              </View>
            );
          })}
        </View>
      )}
    </RecordCard>
  );
}
