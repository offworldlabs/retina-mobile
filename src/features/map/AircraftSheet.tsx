import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { ThemedText } from '@/components';
import { useTheme } from '@/theme';

import type { LiveAircraft } from './feed';
import type { MapNode } from './nodes';
import type { TrackHistoryStatus } from './useTrackHistory';

/** The history spans the card offers and the state of the one picked. */
export type HistoryControls = {
  /** The spans to pick from, in seconds. */
  windows: readonly number[];
  windowS: number;
  onWindow: (windowS: number) => void;
  status: TrackHistoryStatus;
  truncated: boolean;
};

export type AircraftSheetProps = {
  /** The selected aircraft's id (identity.ts), which the server's renames keep; null renders
   *  nothing. */
  id: string | null;
  /** The aircraft under that id in the last frame; undefined once it has left the view. */
  aircraft: LiveAircraft | undefined;
  nodesByRef: ReadonlyMap<string, MapNode>;
  onClose: () => void;
  /** The aircraft the map was asked to open, while the feed has not shown it yet. */
  finding?: { hex: string; callsign: string | null } | null;
  /** The track history row; null or absent for an account without history. */
  history?: HistoryControls | null;
  /** Shown at the bottom of the card, under a hairline. */
  footer?: ReactNode;
};

// A node_ref: a three-letter prefix, then twelve random characters.
const NODE_REF = /^(?:nde|sim)([0-9a-z]{12})$/;

const DASH = '—';
const FEET_PER_METRE = 1 / 0.3048;

// Same labels as the web dashboard's aircraft list.
const SOURCE_LABELS: Record<string, string> = {
  single_node_ellipse_arc: 'Arc·1N',
  adsb_single_node: 'ADS-B·1N',
  solver_single_node: 'Solver·1N',
  solver_adsb_seed: 'Solver·ADS-B',
};

// Same cut as shortRef in the web dashboard (dashboard/src/utils/nodes.ts): the twelve random
// characters of a node_ref, and any other identifier whole.
function shortRef(ref: string): string {
  return NODE_REF.exec(ref)?.[1] ?? ref;
}

function groupDigits(value: number): string {
  return String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function altitudeText(aircraft: LiveAircraft): string {
  const feet =
    aircraft.alt_baro != null
      ? aircraft.alt_baro
      : aircraft.alt_m != null
        ? aircraft.alt_m * FEET_PER_METRE
        : null;
  return feet !== null && Number.isFinite(feet) ? `${groupDigits(feet)} ft` : DASH;
}

function speedText(aircraft: LiveAircraft): string {
  const { gs } = aircraft;
  return gs != null && Number.isFinite(gs) ? `${groupDigits(gs)} kt` : DASH;
}

function trackText(aircraft: LiveAircraft): string {
  const { track } = aircraft;
  if (track == null || !Number.isFinite(track)) return DASH;
  return `${((Math.round(track) % 360) + 360) % 360}°`;
}

function sourceText(aircraft: LiveAircraft): string {
  if (aircraft.multinode) return `Multi·${aircraft.n_nodes ?? '?'}N`;
  const source = aircraft.position_source;
  if (!source) return DASH;
  if (source === 'adsb_multi_node') return `ADS-B·${aircraft.n_nodes ?? '?'}N`;
  return SOURCE_LABELS[source] ?? source;
}

function seenByRefs(aircraft: LiveAircraft): string[] {
  if (aircraft.contributing_node_refs && aircraft.contributing_node_refs.length > 0) {
    return aircraft.contributing_node_refs;
  }
  return aircraft.node_ref ? [aircraft.node_ref] : [];
}

function windowText(seconds: number): string {
  return seconds < 3600 ? `${seconds / 60} min` : `${seconds / 3600} h`;
}

function windowSpoken(seconds: number): string {
  const [count, unit] = seconds < 3600 ? [seconds / 60, 'minute'] : [seconds / 3600, 'hour'];
  return `${count} ${unit}${count === 1 ? '' : 's'}`;
}

function historyNote({ status, truncated }: HistoryControls): string | null {
  if (status === 'loading') return 'Loading history…';
  if (status === 'unavailable') return 'History unavailable';
  if (status === 'ready' && truncated) return 'Showing the first 10,000 positions';
  return null;
}

function HistoryRow({ history }: { history: HistoryControls }) {
  const { colors, spacing, radius } = useTheme();
  const note = historyNote(history);
  return (
    <View style={{ gap: spacing.xs }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.lg }}>
        <ThemedText variant="body" color="secondary">
          History
        </ThemedText>
        <View
          accessibilityRole="radiogroup"
          accessibilityLabel="History"
          style={{ flex: 1, flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm }}
        >
          {history.windows.map((seconds) => {
            const picked = seconds === history.windowS;
            return (
              <Pressable
                key={seconds}
                accessibilityRole="radio"
                accessibilityLabel={windowSpoken(seconds)}
                accessibilityState={{ checked: picked }}
                hitSlop={spacing.sm}
                onPress={() => history.onWindow(seconds)}
                style={({ pressed }) => ({
                  paddingHorizontal: spacing.md,
                  paddingVertical: spacing.xs,
                  borderRadius: radius.md,
                  borderWidth: 1,
                  borderColor: picked ? colors.accent : colors.border,
                  backgroundColor: picked
                    ? colors.accentWash
                    : pressed
                      ? colors.bgCardHover
                      : 'transparent',
                })}
              >
                <ThemedText variant="label" color={picked ? 'accent' : 'secondary'}>
                  {windowText(seconds)}
                </ThemedText>
              </Pressable>
            );
          })}
        </View>
      </View>
      {note !== null && (
        <ThemedText
          variant="caption"
          color="secondary"
          accessibilityLiveRegion="polite"
          style={{ textAlign: 'right' }}
        >
          {note}
        </ThemedText>
      )}
    </View>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  const { spacing } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.lg }}>
      <ThemedText variant="body" color="secondary">
        {label}
      </ThemedText>
      <View style={{ flex: 1, alignItems: 'flex-end' }}>{children}</View>
    </View>
  );
}

function SeenBy({
  refs,
  nodesByRef,
}: {
  refs: string[];
  nodesByRef: ReadonlyMap<string, MapNode>;
}) {
  const { colors, spacing, radius } = useTheme();
  if (refs.length === 0) return <ThemedText variant="body">{DASH}</ThemedText>;
  return (
    <View style={{ gap: spacing.sm, alignItems: 'flex-end' }}>
      {refs.map((ref) => (
        <View key={ref} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
          <View
            style={{
              width: spacing.md,
              height: spacing.md,
              borderRadius: radius.sm,
              backgroundColor: nodesByRef.get(ref)?.online ? colors.success : colors.textMuted,
            }}
          />
          <ThemedText variant="body">{shortRef(ref)}</ThemedText>
        </View>
      ))}
    </View>
  );
}

export function AircraftSheet({
  id,
  aircraft,
  nodesByRef,
  onClose,
  finding,
  history,
  footer,
}: AircraftSheetProps) {
  const { colors, spacing, radius } = useTheme();
  if (id === null) return null;
  // Until the feed shows it, the card names the aircraft as it was asked for.
  const sought = aircraft ? null : finding;
  const callsign = aircraft ? aircraft.flight?.trim() : sought?.callsign?.trim();
  const hex = aircraft?.hex ?? sought?.hex ?? id;
  return (
    <View
      pointerEvents="box-none"
      style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: spacing.lg }}
    >
      <View
        accessibilityLabel="Aircraft details"
        accessibilityViewIsModal={false}
        style={{
          gap: spacing.lg,
          padding: spacing.xl,
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.bgCard,
          shadowColor: colors.shadow,
          shadowOpacity: 1,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 4 },
          elevation: 6,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.lg }}>
          <View style={{ flex: 1 }}>
            <ThemedText variant="title" numberOfLines={1}>
              {callsign || 'No callsign'}
            </ThemedText>
            {/* The hex it flies under now, which a rename changes while the id stays. */}
            <ThemedText variant="mono" color="secondary">
              {hex.toUpperCase()}
            </ThemedText>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close"
            hitSlop={spacing.xl}
            onPress={onClose}
          >
            <ThemedText variant="figure" color="secondary">
              ×
            </ThemedText>
          </Pressable>
        </View>
        {aircraft ? (
          <View style={{ gap: spacing.md }}>
            <DetailRow label="Altitude">
              <ThemedText variant="body">{altitudeText(aircraft)}</ThemedText>
            </DetailRow>
            <DetailRow label="Ground speed">
              <ThemedText variant="body">{speedText(aircraft)}</ThemedText>
            </DetailRow>
            <DetailRow label="Track">
              <ThemedText variant="body">{trackText(aircraft)}</ThemedText>
            </DetailRow>
            <DetailRow label="Source">
              <ThemedText variant="body">{sourceText(aircraft)}</ThemedText>
            </DetailRow>
            <DetailRow label="Seen by">
              <SeenBy refs={seenByRefs(aircraft)} nodesByRef={nodesByRef} />
            </DetailRow>
          </View>
        ) : sought ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
            <ActivityIndicator size="small" color={colors.textSecondary} />
            <ThemedText variant="body" color="secondary" accessibilityLiveRegion="polite">
              Finding {callsign || hex.toUpperCase()}…
            </ThemedText>
          </View>
        ) : (
          <ThemedText variant="body" color="secondary">
            No longer in view
          </ThemedText>
        )}
        {history && <HistoryRow history={history} />}
        {footer && (
          <View
            style={{
              borderTopWidth: 1,
              borderTopColor: colors.border,
              paddingTop: spacing.sm,
            }}
          >
            {footer}
          </View>
        )}
      </View>
    </View>
  );
}
