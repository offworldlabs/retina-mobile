import { useState } from 'react';
import { TextInput, View, type TextInputProps } from 'react-native';

import { ThemedText } from '@/components';
import { useTheme } from '@/theme';

export type EmailFieldProps = Pick<
  TextInputProps,
  'value' | 'onChangeText' | 'onSubmitEditing' | 'autoFocus' | 'editable'
> & {
  /** Shown under the field, which is then marked invalid; empty or null while the value is fine. */
  error?: string | null;
};

/** A labelled email field whose return key sends the form. */
export function EmailField({ error, ...props }: EmailFieldProps) {
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
        Email
      </ThemedText>
      <TextInput
        {...props}
        accessibilityLabel="Email"
        accessibilityHint={error || undefined}
        keyboardType="email-address"
        inputMode="email"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        textContentType="emailAddress"
        returnKeyType="send"
        placeholder="you@example.com"
        placeholderTextColor={colors.textMuted}
        selectionColor={colors.accent}
        cursorColor={colors.accent}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
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
        }}
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
