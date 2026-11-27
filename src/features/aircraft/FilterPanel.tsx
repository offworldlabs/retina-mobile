import { useState } from 'react';
import { Pressable, Switch, TextInput, View } from 'react-native';

import { Button, ThemedText } from '@/components';
import { useTheme } from '@/theme';

import { activeFilterCount, NO_FILTERS, TYPE_FILTER_OPTIONS, type AircraftFilters } from './search';

type NumberFieldProps = {
  value: string;
  placeholder: string;
  label: string;
  onChange: (value: string) => void;
};

function NumberField({ value, placeholder, label, onChange }: NumberFieldProps) {
  const { colors, spacing, radius, type } = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <TextInput
      value={value}
      onChangeText={(text) => onChange(text.replace(/[^0-9]/g, ''))}
      accessibilityLabel={label}
      placeholder={placeholder}
      placeholderTextColor={colors.textMuted}
      keyboardType="numeric"
      inputMode="numeric"
      selectionColor={colors.accent}
      cursorColor={colors.accent}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={{
        flex: 1,
        // No lineHeight: it pushes single-line text off centre on iOS.
        fontSize: type.body.fontSize,
        minHeight: 44,
        paddingHorizontal: spacing.lg,
        paddingVertical: spacing.md,
        borderWidth: 1,
        borderRadius: radius.md,
        borderColor: focused ? colors.accent : colors.borderStrong,
        backgroundColor: colors.bgCard,
        color: colors.textPrimary,
      }}
    />
  );
}

function FieldLabel({ text }: { text: string }) {
  return (
    // The field carries its own label, so screen readers skip this one.
    <ThemedText
      variant="label"
      color="secondary"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {text}
    </ThemedText>
  );
}

export type FilterPanelProps = {
  filters: AircraftFilters;
  onChange: (filters: AircraftFilters) => void;
};

export function FilterPanel({ filters, onChange }: FilterPanelProps) {
  const { colors, spacing, radius } = useTheme();
  const set = (patch: Partial<AircraftFilters>) => onChange({ ...filters, ...patch });
  return (
    <View
      style={{
        gap: spacing.lg,
        padding: spacing.lg,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.bgSunk,
      }}
    >
      <View style={{ gap: spacing.sm }}>
        <FieldLabel text="Flight level" />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
          <NumberField
            value={filters.minFl}
            placeholder="Min"
            label="Minimum flight level"
            onChange={(minFl) => set({ minFl })}
          />
          <ThemedText color="muted">–</ThemedText>
          <NumberField
            value={filters.maxFl}
            placeholder="Max"
            label="Maximum flight level"
            onChange={(maxFl) => set({ maxFl })}
          />
        </View>
      </View>
      <View style={{ gap: spacing.sm }}>
        <FieldLabel text="Min speed (kt)" />
        <View style={{ flexDirection: 'row' }}>
          <NumberField
            value={filters.minGs}
            placeholder="0"
            label="Minimum speed in knots"
            onChange={(minGs) => set({ minGs })}
          />
        </View>
      </View>
      <View style={{ gap: spacing.sm }}>
        <FieldLabel text="Type" />
        <View
          accessibilityRole="radiogroup"
          accessibilityLabel="Type"
          style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md }}
        >
          {TYPE_FILTER_OPTIONS.map((option) => {
            const checked = filters.type === option.value;
            return (
              <Pressable
                key={option.value}
                accessibilityRole="radio"
                accessibilityLabel={option.label}
                accessibilityState={{ checked }}
                onPress={() => set({ type: option.value })}
                style={({ pressed }) => ({
                  minHeight: 44,
                  justifyContent: 'center',
                  paddingHorizontal: spacing.lg,
                  borderRadius: radius.md,
                  borderWidth: 1,
                  borderColor: checked ? colors.accent : colors.borderStrong,
                  backgroundColor: checked
                    ? colors.accentWash
                    : pressed
                      ? colors.bgCardHover
                      : colors.bgCard,
                })}
              >
                <ThemedText variant="label" color={checked ? 'accent' : 'primary'}>
                  {option.label}
                </ThemedText>
              </Pressable>
            );
          })}
        </View>
      </View>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: spacing.lg,
        }}
      >
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <ThemedText variant="label" color="secondary">
            Anomalies only
          </ThemedText>
        </View>
        <Switch
          value={filters.anomaliesOnly}
          onValueChange={(anomaliesOnly) => set({ anomaliesOnly })}
          accessibilityLabel="Anomalies only"
          trackColor={{ false: colors.borderStrong, true: colors.accent }}
          thumbColor="#ffffff"
        />
      </View>
      <Button
        label="Clear all"
        variant="secondary"
        disabled={activeFilterCount(filters) === 0}
        onPress={() => onChange(NO_FILTERS)}
      />
    </View>
  );
}
