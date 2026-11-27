import { useState, type ReactNode } from 'react';
import { View } from 'react-native';

import type { ConfigVersion } from '@/api';
import { Button, ThemedText } from '@/components';
import { useTheme } from '@/theme';

import { Badge, Note, When } from './parts';
import { RecordCard } from './RecordCard';
import { configAside, configHistoryView, versionExpander, type VersionView } from './values';

/** Half the gap between two values, on every side of each. */
const HALF_GAP = 2;

/** One value of a version, two to a row. A value that moved from the version before carries an
 *  edge and a wash, reads heavier, and says "changed" to a screen reader. */
function Field({
  label,
  changed = false,
  children,
}: {
  label: string;
  changed?: boolean;
  children: ReactNode;
}) {
  const { colors, spacing, radius } = useTheme();
  return (
    <View style={{ width: '50%', padding: HALF_GAP }}>
      <View
        style={{
          flex: 1,
          gap: HALF_GAP,
          paddingVertical: spacing.sm,
          paddingHorizontal: spacing.md,
          borderRadius: radius.sm,
          ...(changed && {
            paddingLeft: spacing.md - 2,
            borderLeftWidth: 2,
            borderLeftColor: colors.accent,
            backgroundColor: colors.accentWash,
          }),
        }}
      >
        <ThemedText
          variant="micro"
          color="muted"
          style={{ textTransform: 'uppercase', letterSpacing: 0.55 }}
        >
          {label}
        </ThemedText>
        {children}
      </View>
    </View>
  );
}

function Version({ view, first, now }: { view: VersionView; first: boolean; now: number }) {
  const { colors, spacing } = useTheme();
  return (
    <View
      style={
        first
          ? undefined
          : {
              marginTop: spacing.xl,
              paddingTop: spacing.xl,
              borderTopWidth: 1,
              borderTopColor: colors.border,
            }
      }
    >
      <View
        style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.md }}
      >
        <ThemedText variant="heading" accessibilityRole="header">
          {`Version ${view.version}`}
        </ThemedText>
        {view.inForce && <Badge text="In force" tone="online" />}
      </View>
      <ThemedText
        variant="caption"
        color="secondary"
        style={{ marginTop: spacing.xs, marginBottom: spacing.md }}
      >
        {view.summary}
      </ThemedText>
      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          marginHorizontal: -(spacing.md + HALF_GAP),
        }}
      >
        <Field label="In force from">
          <When at={view.createdAt} now={now} />
        </Field>
        <Field label="Until">
          {view.inForce ? (
            <ThemedText variant="body">Now</ThemedText>
          ) : (
            <When at={view.supersededAt} now={now} />
          )}
        </Field>
        {view.fields.map((field) => (
          <Field key={field.label} label={field.label} changed={field.changed}>
            <ThemedText
              variant={field.mono ? 'mono' : 'body'}
              accessibilityLabel={field.changed ? `${field.text} (changed)` : undefined}
              style={{ fontVariant: ['tabular-nums'], fontWeight: field.changed ? '600' : '400' }}
            >
              {field.text}
            </ThemedText>
          </Field>
        ))}
      </View>
    </View>
  );
}

/** Every configuration the node has run under since it joined the account, newest first, each
 *  value that moved from the version before it marked. The newest few are drawn; the rest wait
 *  behind a button. */
export function ConfigHistoryCard({
  versions,
  error,
  loading,
  now,
}: {
  versions: readonly ConfigVersion[];
  error: unknown | null;
  loading: boolean;
  now: number;
}) {
  const { spacing } = useTheme();
  const [showAll, setShowAll] = useState(false);
  const all = configHistoryView(versions);
  const { shown, button } = versionExpander(all.length, showAll);
  return (
    <RecordCard
      title="Configuration history"
      what="the configuration history"
      aside={configAside(all.length)}
      error={error}
      loading={loading}
      empty={all.length === 0}
    >
      {all.length === 0 ? (
        <Note text="No configuration recorded since this node joined your account." />
      ) : (
        <View style={{ gap: spacing.xl }}>
          <View>
            {all.slice(0, shown).map((view, i) => (
              <Version key={view.version} view={view} first={i === 0} now={now} />
            ))}
          </View>
          {button && (
            <Button
              variant="secondary"
              label={button}
              accessibilityState={{ expanded: showAll }}
              onPress={() => setShowAll((all) => !all)}
            />
          )}
        </View>
      )}
    </RecordCard>
  );
}
