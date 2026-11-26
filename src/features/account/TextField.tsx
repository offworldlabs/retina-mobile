import { useState } from 'react';
import { TextInput, View, type TextInputProps } from 'react-native';

import { ThemedText } from '@/components';
import { useTheme } from '@/theme';

export type TextFieldProps = TextInputProps & {
  label: string;
  /** Shown under the field, which is then marked invalid; empty or null while the value is fine. */
  error?: string | null;
};

/** A labelled text field. */
export function TextField({ label, error, style, onFocus, onBlur, ...props }: TextFieldProps) {
  const { colors, spacing, radius, type } = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ gap: spacing.sm }}>
      {/* The field carries the same label, so screen readers skip this one. */}
      <ThemedText
        variant="label"
        color="secondary"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {label}
      </ThemedText>
      <TextInput
        placeholderTextColor={colors.textMuted}
        selectionColor={colors.accent}
        cursorColor={colors.accent}
        {...props}
        accessibilityLabel={props.accessibilityLabel ?? label}
        accessibilityHint={error || props.accessibilityHint}
        onFocus={(event) => {
          setFocused(true);
          onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          onBlur?.(event);
        }}
        style={[
          {
            // No lineHeight: it pushes single-line text off centre on iOS.
            fontSize: type.body.fontSize,
            minHeight: 48,
            paddingHorizontal: spacing.lg,
            paddingVertical: spacing.lg,
            borderWidth: 1,
            borderRadius: radius.md,
            borderColor: error ? colors.error : focused ? colors.accent : colors.borderStrong,
            backgroundColor: colors.bgCard,
            color: colors.textPrimary,
          },
          style,
        ]}
      />
      {error ? (
        <ThemedText
          variant="caption"
          color="error"
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
        >
          {error}
        </ThemedText>
      ) : null}
    </View>
  );
}
