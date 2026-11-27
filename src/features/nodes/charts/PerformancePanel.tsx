import { useState, type ReactNode } from 'react';
import { Linking, Pressable, View } from 'react-native';

import type { NodePerformance } from '@/api';
import { ThemedText } from '@/components';
import { useTheme } from '@/theme';

import { BearingChart } from './BearingChart';
import { DetectionGrid } from './DetectionGrid';
import {
  chosenClass,
  classLabel,
  formatRange,
  headlineFacts,
  numeratorText,
  windowText,
  type Fact as FactView,
} from './performance';

const TITLE = 'What this node detects';

const tabular = { fontVariant: ['tabular-nums' as const] };

function PanelCard({ note, children }: { note?: string; children: ReactNode }) {
  const { colors, spacing, radius } = useTheme();
  return (
    <View
      style={{
        gap: spacing.xxl,
        padding: spacing.xl,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.bgCard,
      }}
    >
      <View style={{ gap: spacing.xs }}>
        <ThemedText variant="heading" accessibilityRole="header">
          {TITLE}
        </ThemedText>
        {note ? (
          <ThemedText variant="caption" color="muted">
            {note}
          </ThemedText>
        ) : null}
      </View>
      {children}
    </View>
  );
}

function Fact({ fact }: { fact: FactView }) {
  const { colors, spacing, radius } = useTheme();
  return (
    <View
      style={{
        gap: 2,
        paddingVertical: spacing.lg,
        paddingHorizontal: spacing.xl,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: fact.warning ? colors.warning : 'transparent',
        backgroundColor: colors.bgSunk,
      }}
    >
      <ThemedText
        variant="micro"
        color="muted"
        style={{ textTransform: 'uppercase', letterSpacing: 0.55 }}
      >
        {fact.label}
      </ThemedText>
      <ThemedText
        variant="heading"
        color={fact.warning ? 'warning' : 'primary'}
        style={[{ fontSize: 16 }, tabular]}
      >
        {fact.value}
      </ThemedText>
      {fact.note ? (
        <ThemedText variant="caption" color="muted">
          {fact.note}
        </ThemedText>
      ) : null}
      {fact.reason ? (
        <ThemedText variant="caption" color="secondary" style={{ marginTop: spacing.xs }}>
          {fact.reason}
        </ThemedText>
      ) : null}
    </View>
  );
}

function ClassSwitch({
  classes,
  chosen,
  onChoose,
}: {
  classes: readonly string[];
  chosen: string;
  onChoose: (cls: string) => void;
}) {
  const { colors, spacing, radius } = useTheme();
  return (
    <View style={{ gap: spacing.xs }}>
      <ThemedText variant="caption" color="secondary">
        Aircraft class
      </ThemedText>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md }}>
        {classes.map((cls) => {
          const on = cls === chosen;
          const label = classLabel(cls);
          return (
            <Pressable
              key={cls}
              accessibilityRole="button"
              accessibilityLabel={label}
              accessibilityState={{ selected: on }}
              hitSlop={4}
              onPress={() => onChoose(cls)}
              style={({ pressed }) => ({
                minHeight: 36,
                justifyContent: 'center',
                paddingHorizontal: spacing.lg,
                borderRadius: radius.md,
                borderWidth: 1,
                borderColor: on ? colors.accent : colors.borderStrong,
                backgroundColor: on
                  ? pressed
                    ? colors.accentPressed
                    : colors.accent
                  : pressed
                    ? colors.bgCardHover
                    : colors.bgCard,
              })}
            >
              <ThemedText
                variant="label"
                style={{ color: on ? colors.accentInk : colors.textPrimary }}
              >
                {label}
              </ThemedText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function RangeList({
  performance,
  classes,
  chosen,
}: {
  performance: NodePerformance;
  classes: readonly string[];
  chosen: string;
}) {
  const { colors, spacing, radius } = useTheme();
  return (
    <View style={{ gap: spacing.md }}>
      <View style={{ gap: spacing.xs }}>
        <ThemedText variant="label" accessibilityRole="header">
          50% detection range
        </ThemedText>
        <ThemedText variant="caption" color="muted">
          Aircraft at 5,000–20,000 ft
        </ThemedText>
      </View>
      <View>
        {classes.map((cls) => {
          const on = cls === chosen;
          return (
            <View
              key={cls}
              style={{
                flexDirection: 'row',
                flexWrap: 'wrap',
                justifyContent: 'space-between',
                columnGap: spacing.lg,
                rowGap: 2,
                paddingVertical: spacing.sm,
                paddingHorizontal: spacing.md,
                borderRadius: radius.sm,
                backgroundColor: on ? colors.accentWash : 'transparent',
              }}
            >
              <ThemedText
                variant="label"
                color={on ? 'primary' : 'secondary'}
                style={{ fontWeight: on ? '600' : '400' }}
              >
                {classLabel(cls)}
              </ThemedText>
              <ThemedText
                variant="label"
                style={[{ fontWeight: on ? '600' : '400', flexShrink: 1 }, tabular]}
              >
                {formatRange(performance.range_50pct_km[cls], performance.range_50pct_bound[cls])}
              </ThemedText>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const MICTRONICS_URL = 'https://github.com/Mictronics/aircraft-database';
const LICENCE_URL = 'https://opendatacommons.org/licenses/by/1-0/';

function Link({ url, children }: { url: string; children: string }) {
  const { colors } = useTheme();
  return (
    <ThemedText
      variant="micro"
      accessibilityRole="link"
      accessibilityLabel={children}
      onPress={() => void Linking.openURL(url).catch(() => undefined)}
      style={{ color: colors.textSecondary, textDecorationLine: 'underline' }}
    >
      {children}
    </ThemedText>
  );
}

/** The credit the Mictronics licence asks for, under every page that publishes figures derived
 *  from the aircraft classes. */
function DataLicenceNotice() {
  return (
    <ThemedText variant="micro" color="muted">
      Contains information from the <Link url={MICTRONICS_URL}>Mictronics aircraft database</Link>,
      made available under the <Link url={LICENCE_URL}>ODC Attribution License</Link>
    </ThemedText>
  );
}

function Measured({ performance }: { performance: NodePerformance }) {
  const { colors, spacing } = useTheme();
  const classes = performance.classes_with_evidence;
  const [picked, setPicked] = useState<string | null>(null);
  const { chosen, listed } = chosenClass(classes, picked);
  // A later reading can stop listing the class being looked at. That ends the pick, so the view
  // does not jump back if the class returns.
  if (picked !== null && !listed) setPicked(null);

  return (
    <View style={{ gap: spacing.md }}>
      <PanelCard note={windowText(performance)}>
        <View style={{ gap: spacing.lg }}>
          {headlineFacts(performance).map((fact) => (
            <Fact key={fact.label} fact={fact} />
          ))}
        </View>
        <ThemedText variant="caption" color="muted">
          {numeratorText(performance.numerator)}
        </ThemedText>
        {classes.length === 0 || chosen === undefined ? (
          <ThemedText color="muted" style={{ textAlign: 'center', paddingVertical: spacing.lg }}>
            No aircraft class has enough evidence for a table yet.
          </ThemedText>
        ) : (
          <View style={{ gap: spacing.xl }}>
            <ClassSwitch classes={classes} chosen={chosen} onChoose={setPicked} />
            <View style={{ gap: spacing.xxl }}>
              <DetectionGrid performance={performance} cls={chosen} />
              <RangeList performance={performance} classes={classes} chosen={chosen} />
            </View>
          </View>
        )}
        {/* The keyed route never sends it, and its absence says nothing. */}
        {Array.isArray(performance.pd_by_bearing) && (
          <View
            style={{ paddingTop: spacing.xl, borderTopWidth: 1, borderTopColor: colors.border }}
          >
            <BearingChart bins={performance.pd_by_bearing} />
          </View>
        )}
      </PanelCard>
      <DataLicenceNotice />
    </View>
  );
}

/**
 * What a node detects, per aircraft class: how far and how high it sees, how sensitive it is,
 * whether its configuration looks right, and which way it sees. `performance` is the daily
 * analysis's reading of the node, null until it has one.
 */
export function PerformancePanel({ performance }: { performance: NodePerformance | null }) {
  const { spacing } = useTheme();
  if (performance) return <Measured performance={performance} />;
  return (
    <PanelCard>
      <ThemedText color="muted" style={{ textAlign: 'center', paddingVertical: spacing.lg }}>
        No figures yet. They appear once the daily analysis has measured this node against passing
        ADS-B aircraft.
      </ThemedText>
    </PanelCard>
  );
}
