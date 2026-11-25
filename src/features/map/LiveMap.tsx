import {
  Camera,
  GeoJSONSource,
  Images,
  Layer,
  Map as MapView,
  type InitialViewState,
  type LngLatBounds,
  type MapRef,
  type PressEventWithFeatures,
} from '@maplibre/maplibre-react-native';
import { useIsFocused } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useMemo, useRef, useState } from 'react';
import {
  Linking,
  type NativeSyntheticEvent,
  Pressable,
  StyleSheet,
  View,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { useIsOffline } from '@/api';
import { ThemedText } from '@/components';
import { cartoApiKey } from '@/config/env';
import { useTheme, type Palette } from '@/theme';

import { AircraftSheet } from './AircraftSheet';
import {
  BASEMAPS,
  BASEMAP_LABELS,
  DEFAULT_BASEMAP,
  basemapAttribution,
  basemapStyle,
  type BasemapId,
} from './basemap';
import { feedBoxOf, type FeedBox } from './feed';
import type { LiveFeedState } from './liveFeed';
import { useMapNodes } from './nodes';
import { useLiveAircraft } from './useLiveAircraft';

// The web map's default view.
const INITIAL_VIEW: InitialViewState = { center: [-82.39, 34.85], zoom: 8 };

const AIRCRAFT_ICON = 'aircraft';
// The icon is a distance field (white, with the distance to the outline in its alpha), so the
// layer can colour it for the theme and ring it with a halo that keeps it readable on every
// basemap.
const MAP_IMAGES = {
  [AIRCRAFT_ICON]: { source: require('../../../assets/images/map/aircraft.png'), sdf: true },
};

// Layer ids. Sources are re-added in no fixed order when the basemap's style reloads, so each
// layer names the one it sits under instead of relying on the order it was first added in.
const AIRCRAFT_LAYER = 'aircraft-icons';
const SELECTED_LAYER = 'aircraft-selected';
const NODES_LAYER = 'node-dots';

const CONTROL_SIZE = 44;

function sameBox(a: FeedBox | null, b: FeedBox | null): boolean {
  if (a === null || b === null) return a === b;
  return a.every((edge, i) => edge === b[i]);
}

/** The basemap after `current` on the switch. */
function nextBasemap(current: BasemapId): BasemapId {
  return BASEMAPS[(BASEMAPS.indexOf(current) + 1) % BASEMAPS.length];
}

function aircraftAt(event: NativeSyntheticEvent<PressEventWithFeatures>): string | null {
  for (const feature of event.nativeEvent.features) {
    const hex: unknown = feature.properties?.hex;
    if (typeof hex === 'string' && hex !== '') return hex;
  }
  return null;
}

function openLink(url: string) {
  Linking.openURL(url).catch(() => {
    // No app can open it; the credit stays on screen as text.
  });
}

type ChipState = { label: string; tone: keyof Palette; count: number | null; clipped: boolean };

function chipState(feed: LiveFeedState, offline: boolean): ChipState {
  if (offline) return { label: 'Offline', tone: 'error', count: null, clipped: false };
  switch (feed.status) {
    case 'connecting':
      return { label: 'Connecting…', tone: 'textMuted', count: null, clipped: false };
    case 'live':
      return { label: 'Live', tone: 'success', count: feed.count, clipped: feed.clipped };
    case 'fallback':
      return {
        label: 'Slow connection',
        tone: 'warning',
        count: feed.count,
        clipped: feed.clipped,
      };
    case 'paused':
      return { label: 'Paused', tone: 'textMuted', count: null, clipped: false };
  }
}

function StatusChip({ state }: { state: ChipState }) {
  const { colors, spacing, radius } = useTheme();
  return (
    <View
      style={{
        alignItems: 'center',
        paddingHorizontal: spacing.lg,
        paddingVertical: spacing.sm,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.bgCard,
        shadowColor: colors.shadow,
        shadowOpacity: 1,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 2 },
        elevation: 3,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <View
          style={{
            width: spacing.md,
            height: spacing.md,
            borderRadius: spacing.md / 2,
            backgroundColor: colors[state.tone],
          }}
        />
        {/* Only the state is a live region: the count changes every second and would be read
            out every second. */}
        <ThemedText variant="label" accessibilityLiveRegion="polite">
          {state.label}
        </ThemedText>
        {state.count !== null && (
          <ThemedText variant="label" color="secondary">
            · {state.count} aircraft
          </ThemedText>
        )}
      </View>
      {state.clipped && (
        <ThemedText variant="caption" color="secondary" accessibilityLiveRegion="polite">
          Zoom in to see every aircraft
        </ThemedText>
      )}
    </View>
  );
}

function BasemapButton({ basemap, onPress }: { basemap: BasemapId; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Basemap: ${BASEMAP_LABELS[basemap]}`}
      accessibilityHint="Shows the next basemap"
      onPress={onPress}
      style={({ pressed }) => ({
        width: CONTROL_SIZE,
        height: CONTROL_SIZE,
        borderRadius: CONTROL_SIZE / 2,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: pressed ? colors.bgCardHover : colors.bgCard,
        shadowColor: colors.shadow,
        shadowOpacity: 1,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 2 },
        elevation: 3,
      })}
    >
      <SymbolView
        name={{ ios: 'square.3.layers.3d', android: 'layers' }}
        size={22}
        tintColor={colors.textPrimary}
      />
    </Pressable>
  );
}

/** The basemap's credit, with each provider's name opening its terms. */
function Attribution({ basemap, style }: { basemap: BasemapId; style?: ViewStyle }) {
  const { colors, spacing, radius } = useTheme();
  const { text, links } = basemapAttribution(basemap);
  const pieces: { text: string; url?: string }[] = [];
  let rest = text;
  for (const link of links) {
    const at = rest.indexOf(link.label);
    if (at < 0) continue;
    if (at > 0) pieces.push({ text: rest.slice(0, at) });
    pieces.push({ text: link.label, url: link.url });
    rest = rest.slice(at + link.label.length);
  }
  if (rest) pieces.push({ text: rest });
  return (
    <View
      style={[
        {
          alignSelf: 'flex-start',
          flexDirection: 'row',
          flexWrap: 'wrap',
          alignItems: 'center',
          paddingHorizontal: spacing.sm,
          paddingVertical: 2,
          borderRadius: radius.sm,
          overflow: 'hidden',
        },
        style,
      ]}
    >
      <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.bgCard, opacity: 0.85 }]} />
      {pieces.map(({ text: label, url }, i) =>
        url ? (
          <Pressable
            key={i}
            accessibilityRole="link"
            hitSlop={spacing.md}
            onPress={() => openLink(url)}
          >
            <ThemedText
              variant="micro"
              style={{ color: colors.textPrimary, textDecorationLine: 'underline' }}
            >
              {label}
            </ThemedText>
          </Pressable>
        ) : (
          <ThemedText key={i} variant="micro" color="secondary">
            {label}
          </ThemedText>
        ),
      )}
    </View>
  );
}

/**
 * The live map: every aircraft in view from the live feed, drawn by one GeoJSON source, over
 * the public nodes and the basemap the theme or the user picked. Tapping an aircraft opens its
 * details; tapping the map elsewhere closes them.
 */
export function LiveMap() {
  const { scheme, colors, spacing } = useTheme();
  const insets = useSafeAreaInsets();
  const focused = useIsFocused();
  const offline = useIsOffline();
  const mapRef = useRef<MapRef>(null);

  // The basemap follows the theme until one is picked by hand. Cycling back onto the theme's
  // own default hands it back to the theme, so one stray tap does not stop it following.
  const [handPicked, setHandPicked] = useState<BasemapId | null>(null);
  const themeBasemap = DEFAULT_BASEMAP[scheme];
  const basemap = handPicked ?? themeBasemap;
  const cycleBasemap = () => {
    const next = nextBasemap(basemap);
    setHandPicked(next === themeBasemap ? null : next);
  };
  const mapStyle = useMemo(() => basemapStyle(basemap, cartoApiKey, scheme), [basemap, scheme]);

  // The server sends nothing until it has a box, so the first one goes as soon as the map has
  // a view, and every settled pan or zoom after that sends the new one.
  const [box, setBox] = useState<FeedBox | null>(null);
  const showBounds = ([west, south, east, north]: LngLatBounds) => {
    const next = feedBoxOf({ north, south, east, west });
    setBox((current) => (sameBox(current, next) ? current : next));
  };
  const readBounds = () => {
    mapRef.current?.getBounds().then(showBounds, () => {
      // The map is not ready yet; its first region change brings the bounds instead.
    });
  };

  const feed = useLiveAircraft(box, focused);
  const nodes = useMapNodes(focused);

  const [selectedHex, setSelectedHex] = useState<string | null>(null);
  const selectAircraft = (event: NativeSyntheticEvent<PressEventWithFeatures>) => {
    // The press is the aircraft's alone; without this the map's own press clears it again.
    event.stopPropagation();
    const hex = aircraftAt(event);
    if (hex) setSelectedHex(hex);
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bgPrimary }}>
      <MapView
        ref={mapRef}
        style={{ flex: 1 }}
        mapStyle={mapStyle}
        attribution={false}
        logo={false}
        touchPitch={false}
        compass
        compassPosition={{
          // Under the basemap button. The map reads whole points here.
          top: Math.round(insets.top + spacing.lg + CONTROL_SIZE + spacing.lg),
          right: Math.round(insets.right + spacing.lg),
        }}
        onDidFinishLoadingMap={readBounds}
        onRegionDidChange={(event) => {
          // Android leaves the bounds out of the event when it cannot build the visible region.
          const { bounds } = event.nativeEvent;
          if (Array.isArray(bounds) && bounds.length === 4) showBounds(bounds);
        }}
        onPress={() => setSelectedHex(null)}
      >
        <Camera initialViewState={INITIAL_VIEW} />
        <Images images={MAP_IMAGES} />
        <GeoJSONSource id="nodes" data={nodes.collection}>
          <Layer
            id={NODES_LAYER}
            type="circle"
            beforeId={SELECTED_LAYER}
            paint={{
              'circle-radius': 6,
              'circle-color': [
                'case',
                ['==', ['get', 'online'], true],
                colors.success,
                colors.textMuted,
              ],
              'circle-stroke-color': '#ffffff',
              'circle-stroke-width': 2,
            }}
          />
        </GeoJSONSource>
        <GeoJSONSource id="aircraft" data={feed.collection} onPress={selectAircraft}>
          <Layer
            id={SELECTED_LAYER}
            type="circle"
            beforeId={AIRCRAFT_LAYER}
            filter={['==', ['get', 'hex'], selectedHex ?? '']}
            paint={{
              'circle-radius': 20,
              'circle-color': colors.accent,
              'circle-opacity': 0.22,
              'circle-stroke-color': colors.accent,
              'circle-stroke-width': 2,
            }}
          />
          <Layer
            id={AIRCRAFT_LAYER}
            type="symbol"
            layout={{
              'icon-image': AIRCRAFT_ICON,
              'icon-size': ['interpolate', ['linear'], ['zoom'], 4, 0.75, 10, 1.1],
              'icon-rotate': ['coalesce', ['get', 'track'], 0],
              'icon-rotation-alignment': 'map',
              'icon-allow-overlap': true,
              'icon-ignore-placement': true,
            }}
            paint={{
              'icon-color': colors.accent,
              'icon-halo-color': colors.bgCard,
              'icon-halo-width': 1.5,
            }}
          />
        </GeoJSONSource>
      </MapView>

      {/* The status bar sits over the map, whose tiles can be light in the dark theme. */}
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: insets.top,
          backgroundColor: colors.bgPrimary,
          opacity: 0.75,
        }}
      />

      <SafeAreaView pointerEvents="box-none" style={StyleSheet.absoluteFill}>
        <View pointerEvents="box-none" style={{ flex: 1, padding: spacing.lg }}>
          <View pointerEvents="box-none" style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
            <View pointerEvents="none" style={{ width: CONTROL_SIZE }} />
            <View pointerEvents="box-none" style={{ flex: 1, alignItems: 'center' }}>
              <StatusChip state={chipState(feed, offline)} />
            </View>
            <BasemapButton basemap={basemap} onPress={cycleBasemap} />
          </View>
          <View pointerEvents="box-none" style={{ flex: 1, justifyContent: 'flex-end' }}>
            {selectedHex === null && <Attribution basemap={basemap} />}
          </View>
          <AircraftSheet
            hex={selectedHex}
            aircraft={selectedHex ? feed.aircraft.get(selectedHex) : undefined}
            nodesByRef={nodes.byRef}
            onClose={() => setSelectedHex(null)}
            footer={<Attribution basemap={basemap} style={{ paddingHorizontal: 0 }} />}
          />
        </View>
      </SafeAreaView>
    </View>
  );
}
