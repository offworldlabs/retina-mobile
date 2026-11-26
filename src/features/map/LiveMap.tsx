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
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  loadBasemapChoice,
  saveBasemapChoice,
  type BasemapId,
} from './basemap';
import { feedBoxOf, type FeedBox } from './feed';
import type { LiveFeedState } from './liveFeed';
import { NodeSheet } from './NodeSheet';
import { nodesAtSite, useMapNodes } from './nodes';
import { nearestFeature } from './pick';
import { useLiveAircraft } from './useLiveAircraft';
import { useSmoothedAircraft } from './useSmoothedAircraft';

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

type SourcePressEvent = NativeSyntheticEvent<PressEventWithFeatures>;

/** What a tap has opened: one aircraft's card or one node's, never both. */
type Selection = { kind: 'aircraft'; id: string } | { kind: 'node'; ref: string } | null;

/**
 * The `key` property of the pressed feature nearest the finger, or null when none carries one.
 * The hitbox is 44 points wide and can hold several features, listed in draw order; the one
 * nearest the finger is the one it meant.
 */
function nearestPressed(event: SourcePressEvent, key: 'id' | 'ref'): string | null {
  const { lngLat, features } = event.nativeEvent;
  const named = features.filter((feature) => {
    const value: unknown = feature.properties?.[key];
    return typeof value === 'string' && value !== '';
  });
  const value: unknown = nearestFeature(lngLat, named)?.properties?.[key];
  return typeof value === 'string' ? value : null;
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

type AircraftSourceProps = {
  feed: LiveFeedState;
  /** Whether the map screen is focused; aircraft move between frames only then. */
  active: boolean;
  /** The id of the aircraft whose card is open, ringed on the map. */
  selectedId: string | null;
  onPress: (event: SourcePressEvent) => void;
};

/**
 * The aircraft as one GeoJSON source, at the positions smoothed between the feed's frames. It is
 * a component of its own so that each smoothing step re-renders this source alone, not the screen
 * around it.
 */
const AircraftSource = memo(function AircraftSource({
  feed,
  active,
  selectedId,
  onPress,
}: AircraftSourceProps) {
  const { colors } = useTheme();
  const collection = useSmoothedAircraft(feed, active);
  return (
    <GeoJSONSource id="aircraft" data={collection} onPress={onPress}>
      <Layer
        id={SELECTED_LAYER}
        type="circle"
        beforeId={AIRCRAFT_LAYER}
        filter={['==', ['get', 'id'], selectedId ?? '']}
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
  );
});

/**
 * The live map: every aircraft in view from the live feed, drawn by one GeoJSON source and moved
 * smoothly between frames, over the public nodes and the basemap the theme or the user picked.
 * A tap opens the card of the aircraft nearest the finger or, with no aircraft under it, of the
 * node nearest it; an aircraft and a node under one finger open the aircraft. The card stays on
 * its aircraft through the server's renames. Tapping the map elsewhere closes the card.
 */
export function LiveMap() {
  const { scheme, colors, spacing } = useTheme();
  const insets = useSafeAreaInsets();
  const focused = useIsFocused();
  const offline = useIsOffline();
  const mapRef = useRef<MapRef>(null);

  // The basemap follows the theme until one is picked by hand, and a pick is kept on the device
  // across restarts. Cycling back onto the theme's own default hands it back to the theme and
  // forgets the pick, so one stray tap does not stop it following. Undefined while the saved
  // pick is read: the map waits for it, so it never opens on the theme's basemap only to swap.
  const [handPicked, setHandPicked] = useState<BasemapId | null | undefined>(undefined);
  useEffect(() => {
    let mounted = true;
    const restore = (choice: BasemapId | null) => {
      if (mounted) setHandPicked(choice);
    };
    // The read is not meant to fail; if it ever does, the map still opens, on the theme's own.
    loadBasemapChoice().then(restore, () => restore(null));
    return () => {
      mounted = false;
    };
  }, []);
  const themeBasemap = DEFAULT_BASEMAP[scheme];
  const basemap = handPicked ?? themeBasemap;
  const cycleBasemap = () => {
    const next = nextBasemap(basemap);
    const pick = next === themeBasemap ? null : next;
    setHandPicked(pick);
    // The device's store writes in the order it is asked, so quick taps leave the last pick.
    void saveBasemapChoice(pick);
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

  // The map hands a tap to one source only, the one with a feature under the finger whose layer is
  // drawn on top, and the aircraft layers sit over the nodes', so an aircraft and a node under one
  // finger open the aircraft. Each press stops there: passed on, the map's own press would close
  // the card it just opened. The aircraft press keeps one identity so the memoized source above
  // does not re-render for it.
  const [selection, setSelection] = useState<Selection>(null);
  // An aircraft is selected by the id it had when tapped, read through the feed's identity on every
  // render, so the ring and the card follow it when the server's ids for it turn out to be one
  // aircraft. The id it resolves to is kept from then on, so the selection outlives the old id.
  const tappedId = selection?.kind === 'aircraft' ? selection.id : null;
  const selectedId = tappedId === null ? null : (feed.idFor?.(tappedId) ?? tappedId);
  if (selectedId !== null && selectedId !== tappedId) {
    setSelection({ kind: 'aircraft', id: selectedId });
  }
  const selectedRef = selection?.kind === 'node' ? selection.ref : null;
  const selectAircraft = useCallback((event: SourcePressEvent) => {
    event.stopPropagation();
    const id = nearestPressed(event, 'id');
    if (id !== null) setSelection({ kind: 'aircraft', id });
  }, []);
  const selectNode = (event: SourcePressEvent) => {
    event.stopPropagation();
    const ref = nearestPressed(event, 'ref');
    if (ref !== null) setSelection({ kind: 'node', ref });
  };
  const closeCard = () => setSelection(null);
  const site = useMemo(
    () => (selectedRef === null ? [] : nodesAtSite(nodes.nodes, selectedRef)),
    [nodes.nodes, selectedRef],
  );

  // Until the saved basemap is known, only the screen's background shows: no map to open on the
  // wrong basemap, and no switch to tap before the saved pick lands.
  if (handPicked === undefined) {
    return <View style={{ flex: 1, backgroundColor: colors.bgPrimary }} />;
  }

  const cardFooter = <Attribution basemap={basemap} style={{ paddingHorizontal: 0 }} />;

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
        onPress={closeCard}
      >
        <Camera initialViewState={INITIAL_VIEW} />
        <Images images={MAP_IMAGES} />
        <GeoJSONSource id="nodes" data={nodes.collection} onPress={selectNode}>
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
        <AircraftSource
          feed={feed}
          active={focused}
          selectedId={selectedId}
          onPress={selectAircraft}
        />
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
            {selection === null && <Attribution basemap={basemap} />}
          </View>
          <AircraftSheet
            id={selectedId}
            aircraft={selectedId === null ? undefined : feed.aircraft.get(selectedId)}
            nodesByRef={nodes.byRef}
            onClose={closeCard}
            footer={cardFooter}
          />
          <NodeSheet nodeRef={selectedRef} site={site} onClose={closeCard} footer={cardFooter} />
        </View>
      </SafeAreaView>
    </View>
  );
}
