import type { ReactNode } from 'react';
import { FlatList, type FlatListProps, Platform, RefreshControl, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from './ThemedText';
import { useTheme } from '@/theme';

export type ListScreenProps<T> = Omit<
  FlatListProps<T>,
  'ListHeaderComponent' | 'style' | 'contentContainerStyle' | 'refreshControl'
> & {
  title: string;
  /** Rendered under the title, above the first row. */
  header?: ReactNode;
  /** Add the bottom safe-area inset on Android; leave off inside the tab bar, which already insets. */
  bottomInset?: boolean;
};

/** Screen for a long list: the same look and insets as Screen, with a virtualised list. */
export function ListScreen<T>({
  title,
  header,
  bottomInset = false,
  refreshing = false,
  onRefresh,
  ...props
}: ListScreenProps<T>) {
  const { colors, spacing } = useTheme();
  const insets = useSafeAreaInsets();
  const android = Platform.OS === 'android';
  return (
    <FlatList
      style={{ flex: 1, backgroundColor: colors.bgPrimary }}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{
        padding: spacing.xl,
        paddingTop: spacing.xl + (android ? insets.top : 0),
        paddingBottom: spacing.xl + (android && bottomInset ? insets.bottom : 0),
        paddingLeft: spacing.xl + (android ? insets.left : 0),
        paddingRight: spacing.xl + (android ? insets.right : 0),
      }}
      ListHeaderComponent={
        <View style={{ gap: spacing.xl, paddingBottom: spacing.xl }}>
          <ThemedText variant="title" accessibilityRole="header">
            {title}
          </ThemedText>
          {header}
        </View>
      }
      refreshControl={
        onRefresh ? (
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.accent}
            colors={[colors.accent]}
            progressBackgroundColor={colors.bgCard}
            progressViewOffset={android ? insets.top : 0}
          />
        ) : undefined
      }
      {...props}
    />
  );
}
