import { useState } from 'react';
import { Pressable, View } from 'react-native';

import type { NodePerformance } from '@/api';
import { ThemedText } from '@/components';
import { useTheme } from '@/theme';

import {
  ALTITUDES,
  cellSheetRows,
  classLabel,
  EVIDENCE_FLOOR,
  GRID_KEY_TEXT,
  gridRows,
  heatShare,
  mixColour,
  RANGES,
  readCell,
  UNDER_FLOOR_TEXT,
  type GridCell,
} from './performance';

/** The altitude labels' column, and the gap between columns and rows. Narrow enough that four
 *  cells keep a thumb's width on a 320 pt screen. */
const SIDE = 48;
const GAP = 3;

const tabular = { fontVariant: ['tabular-nums' as const] };

function Cell({ cell, open, onPress }: { cell: GridCell; open: boolean; onPress: () => void }) {
  const { colors, radius } = useTheme();
  const { heated, reading } = cell;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={cell.detail}
      accessibilityState={{ selected: open }}
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        minWidth: 0,
        minHeight: 48,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 1,
        borderRadius: radius.sm,
        borderWidth: 2,
        borderColor: open ? colors.accent : 'transparent',
        backgroundColor:
          heated && reading.pd !== null
            ? mixColour(colors.accent, colors.bgCard, heatShare(reading.pd))
            : colors.bgSunk,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <ThemedText
        variant="label"
        color={heated ? 'primary' : 'secondary'}
        style={[{ fontSize: 14, fontWeight: heated ? '600' : '400' }, tabular]}
      >
        {cell.pdText}
      </ThemedText>
      <ThemedText variant="micro" color={heated ? 'primary' : 'secondary'} style={tabular}>
        {cell.countText}
      </ThemedText>
    </Pressable>
  );
}

function AxisLabel({ text, width }: { text: string; width?: number }) {
  return (
    <View
      style={{
        width,
        flex: width === undefined ? 1 : undefined,
        minWidth: 0,
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 2,
      }}
    >
      <ThemedText variant="micro" color="secondary" style={[{ textAlign: 'center' }, tabular]}>
        {text}
      </ThemedText>
    </View>
  );
}

/** Where a cell's detail is open, by keys, so each poll re-reads its figures while it stays open. */
interface Spot {
  rangeKey: string;
  altitudeKey: string;
}

/** The tapped cell's detail, inline under the table: the web's sheet, without a modal. */
function CellDetail({
  performance,
  cls,
  spot,
  onClose,
}: {
  performance: NodePerformance;
  cls: string;
  spot: Spot;
  onClose: () => void;
}) {
  const { colors, spacing, radius } = useTheme();
  const range = RANGES.find((bin) => bin.key === spot.rangeKey);
  const altitude = ALTITUDES.find((bin) => bin.key === spot.altitudeKey);
  if (!range || !altitude) return null;
  const reading = readCell(performance, cls, range, altitude);
  return (
    <View
      style={{
        gap: spacing.md,
        padding: spacing.lg,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.bgSunk,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.lg }}>
        <ThemedText variant="heading" accessibilityRole="header" style={{ flex: 1 }}>
          {classLabel(cls)}
        </ThemedText>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          hitSlop={spacing.md}
          onPress={onClose}
          style={({ pressed }) => ({
            minHeight: 32,
            justifyContent: 'center',
            paddingHorizontal: spacing.md,
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <ThemedText variant="label" color="accent">
            Close
          </ThemedText>
        </Pressable>
      </View>
      {cellSheetRows(range, altitude, reading).map(([label, value]) => (
        <View
          key={label}
          style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.lg }}
        >
          <ThemedText color="secondary">{label}</ThemedText>
          <ThemedText style={tabular}>{value}</ThemedText>
        </View>
      ))}
      {reading.evidence < EVIDENCE_FLOOR && (
        <ThemedText variant="caption" color="secondary">
          {UNDER_FLOOR_TEXT}
        </ThemedText>
      )}
    </View>
  );
}

/**
 * The chosen class's share detected by altitude (rows, highest first) and range (columns). Each
 * cell shows the share and its sample count, heated by the share, and greyed with no figure or
 * under the evidence floor. A tap opens the cell's detail under the table; a second tap on the
 * same cell, or Close, shuts it.
 */
export function DetectionGrid({ performance, cls }: { performance: NodePerformance; cls: string }) {
  const { spacing } = useTheme();
  const [spot, setSpot] = useState<Spot | null>(null);
  const rows = gridRows(performance, cls);
  const isOpen = (cell: GridCell) =>
    spot?.rangeKey === cell.range.key && spot.altitudeKey === cell.altitude.key;

  return (
    <View style={{ gap: spacing.md }}>
      <View style={{ gap: GAP }}>
        <View style={{ marginLeft: SIDE + GAP, marginBottom: 2 }}>
          <ThemedText variant="micro" color="secondary" style={{ textAlign: 'center' }}>
            Range (km)
          </ThemedText>
        </View>
        <View style={{ gap: GAP }}>
          <View style={{ flexDirection: 'row', gap: GAP }}>
            <AxisLabel text="Altitude (kft)" width={SIDE} />
            {RANGES.map((range) => (
              <AxisLabel key={range.key} text={range.label} />
            ))}
          </View>
          {rows.map(({ altitude, cells }) => (
            <View key={altitude.key} style={{ flexDirection: 'row', gap: GAP }}>
              <AxisLabel text={altitude.label} width={SIDE} />
              {cells.map((cell) => (
                <Cell
                  key={cell.range.key}
                  cell={cell}
                  open={isOpen(cell)}
                  onPress={() =>
                    setSpot(
                      isOpen(cell)
                        ? null
                        : { rangeKey: cell.range.key, altitudeKey: cell.altitude.key },
                    )
                  }
                />
              ))}
            </View>
          ))}
        </View>
      </View>
      {spot && (
        <CellDetail performance={performance} cls={cls} spot={spot} onClose={() => setSpot(null)} />
      )}
      <ThemedText variant="caption" color="muted">
        {GRID_KEY_TEXT}
      </ThemedText>
    </View>
  );
}
