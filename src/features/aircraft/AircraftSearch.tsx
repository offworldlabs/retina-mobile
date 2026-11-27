import type { ReactElement } from 'react';
import { useState } from 'react';
import { ActivityIndicator, Pressable, TextInput, View } from 'react-native';

import { userMessage } from '@/api';
import { Button, ListScreen, Placeholder, ThemedText } from '@/components';
import { NodeSeparator, Notice } from '@/features/network';
import { useTheme } from '@/theme';

import { AccessNote } from './AccessNote';
import { useSearchAccess } from './access';
import { FilterPanel } from './FilterPanel';
import { ResultRow } from './ResultRow';
import { activeFilterCount, NO_FILTERS, type AircraftFilters } from './search';
import { useAircraftSearch } from './useAircraftSearch';

function SearchField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const { colors, spacing, radius, type } = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <View>
      <TextInput
        value={value}
        onChangeText={onChange}
        accessibilityLabel="Search callsign or hex"
        placeholder="Search callsign or hex"
        placeholderTextColor={colors.textMuted}
        autoCorrect={false}
        autoCapitalize="characters"
        returnKeyType="search"
        selectionColor={colors.accent}
        cursorColor={colors.accent}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          // No lineHeight: it pushes single-line text off centre on iOS.
          fontSize: type.body.fontSize,
          minHeight: 48,
          paddingLeft: spacing.lg,
          paddingRight: 48,
          paddingVertical: spacing.lg,
          borderWidth: 1,
          borderRadius: radius.md,
          borderColor: focused ? colors.accent : colors.borderStrong,
          backgroundColor: colors.bgCard,
          color: colors.textPrimary,
        }}
      />
      {value ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Clear search"
          onPress={() => onChange('')}
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            bottom: 0,
            width: 48,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <ThemedText variant="heading" color="secondary">
            ×
          </ThemedText>
        </Pressable>
      ) : null}
    </View>
  );
}

export function AircraftSearch() {
  const { colors, spacing } = useTheme();
  const [text, setText] = useState('');
  const [filters, setFilters] = useState<AircraftFilters>(NO_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const access = useSearchAccess();
  const search = useAircraftSearch(text, filters, access);
  const activeFilters = activeFilterCount(filters);
  const hasResults = search.results.length > 0;
  const scopeLabel = search.scope === 'network' ? 'Whole network' : "In the map's view";
  const stalled = search.offline || Boolean(search.error) || search.retryInS !== null;

  const header = (
    <View style={{ gap: spacing.lg }}>
      <SearchField value={text} onChange={setText} />
      <Button
        label={activeFilters > 0 ? `Filters · ${activeFilters}` : 'Filters'}
        accessibilityLabel="Filters"
        accessibilityState={{ expanded: filtersOpen }}
        variant="secondary"
        onPress={() => setFiltersOpen((open) => !open)}
      />
      {filtersOpen ? <FilterPanel filters={filters} onChange={setFilters} /> : null}
      <AccessNote access={access} />
      <ThemedText variant="caption" color="secondary" accessibilityLiveRegion="polite">
        {`${scopeLabel} · ${search.results.length} of ${search.total}`}
      </ThemedText>
      {search.scope === 'network' && (filters.type === 'drone' || filters.type === 'aircraft') ? (
        <ThemedText variant="caption" color="secondary">
          {"Type is known only for aircraft in the map's view, as the data API sends no type."}
        </ThemedText>
      ) : null}
      {search.offline ? (
        <Notice
          tone="warning"
          text={
            hasResults
              ? 'You are offline. Showing the last results.'
              : 'You are offline. Connect to search.'
          }
        />
      ) : null}
      {search.error && !search.offline && search.retryInS === null ? (
        <Notice tone="warning" text={userMessage(search.error)} />
      ) : null}
      {search.retryInS !== null ? (
        <Notice
          tone="warning"
          text={`Too many searches right now. Trying again in ${search.retryInS} s.`}
        />
      ) : null}
      {search.clipped ? (
        <Notice text="Only part of the map's view is searched. Zoom the map in to search all of it." />
      ) : null}
    </View>
  );

  let empty: ReactElement | undefined;
  if (search.loading) {
    empty = (
      <View style={{ alignItems: 'center', paddingVertical: spacing.xxl }}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  } else if (!stalled) {
    if (text.trim() !== '' || activeFilters > 0) {
      empty = (
        <Placeholder
          title="No aircraft match"
          description="Try another callsign or hex, or clear the filters."
        />
      );
    } else if (search.scope === 'view') {
      empty = (
        <Placeholder
          title="No aircraft in the map's view"
          description="Move the map to where aircraft are flying, then search again."
        />
      );
    } else {
      empty = (
        <Placeholder
          title="No aircraft in the network right now"
          description="Aircraft show up here as soon as the nodes pick them up."
        />
      );
    }
  }

  return (
    <ListScreen
      title="Aircraft"
      header={header}
      data={search.results}
      keyExtractor={(result) => result.id}
      renderItem={({ item }) => <ResultRow result={item} />}
      ItemSeparatorComponent={NodeSeparator}
      ListEmptyComponent={empty}
      accessibilityLabel="Search results"
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
    />
  );
}
