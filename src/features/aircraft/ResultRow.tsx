import { useRouter } from 'expo-router';
import { Pressable, View } from 'react-native';

import { ThemedText } from '@/components';
import { requestMapFocus } from '@/features/map/link';
import { useTheme } from '@/theme';

import type { SearchResult } from './search';

const DASH = '—';

function altitudeText(altitude: SearchResult['altitude']): string {
  if (altitude === 'ground') return 'Ground';
  if (altitude === null || !Number.isFinite(altitude)) return DASH;
  return `FL${String(Math.max(0, Math.round(altitude / 100))).padStart(3, '0')}`;
}

function speedText(gs: number | null): string {
  return gs !== null && Number.isFinite(gs) ? `${Math.round(gs)} kt` : DASH;
}

function Badge({ text }: { text: string }) {
  const { colors, spacing, radius } = useTheme();
  return (
    <View
      style={{
        paddingHorizontal: spacing.md,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.bgSunk,
      }}
    >
      <ThemedText variant="caption" color="secondary">
        {text}
      </ThemedText>
    </View>
  );
}

export function ResultRow({ result }: { result: SearchResult }) {
  const router = useRouter();
  const { colors, spacing, radius } = useTheme();
  const hex = result.hex.toUpperCase();
  const name = result.callsign ?? 'No callsign';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${name}, ${hex}`}
      accessibilityHint="Shows it on the map"
      onPress={() => {
        requestMapFocus({
          hex: result.hex,
          lat: result.lat,
          lon: result.lon,
          callsign: result.callsign,
        });
        router.navigate('/');
      }}
      style={({ pressed }) => ({
        minHeight: 44,
        gap: spacing.sm,
        paddingHorizontal: spacing.xl,
        paddingVertical: spacing.lg,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: pressed ? colors.bgCardHover : colors.bgCard,
      })}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
        <ThemedText variant="heading" numberOfLines={1} style={{ flexShrink: 1 }}>
          {name}
        </ThemedText>
        <ThemedText variant="mono" color="secondary">
          {hex}
        </ThemedText>
      </View>
      <View
        style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.md }}
      >
        <ThemedText variant="caption" color="secondary">
          {altitudeText(result.altitude)}
        </ThemedText>
        <ThemedText variant="caption" color="secondary">
          {speedText(result.gs)}
        </ThemedText>
        {result.multinode ? <Badge text="Multi-node" /> : null}
        {result.anomalous ? <Badge text="Anomaly" /> : null}
      </View>
    </Pressable>
  );
}
