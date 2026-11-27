import type { ReactElement } from 'react';
import { View } from 'react-native';

import type { ConfigVersion, NodeReport, OwnerEvent } from '@/api';
import { useNow } from '@/features/nodes/clock';
import { useTheme } from '@/theme';

import { ConfigHistoryCard } from './ConfigHistoryCard';
import { EventsCard } from './EventsCard';
import { ReportCard } from './ReportCard';

/** How often "2m ago" is read again. */
const TICK_MS = 30_000;

export type NodeRecordsProps = {
  report: NodeReport | null;
  versions: readonly ConfigVersion[];
  events: readonly OwnerEvent[];
  error: unknown | null;
  /** Which records have no first answer yet; absent, none. */
  loading?: { report: boolean; versions: boolean; events: boolean };
};

/** What an owner alone sees of their node beyond its settings: the last heartbeat report, every
 *  configuration it has run under, and what has been decided about it. Rows are drawn in place,
 *  not virtualised, as the node page scrolls as a whole; the page asks for at most 50 versions
 *  and 100 entries. */
export function NodeRecords({
  report,
  versions,
  events,
  error,
  loading,
}: NodeRecordsProps): ReactElement {
  const { spacing } = useTheme();
  const now = useNow(TICK_MS);
  return (
    <View style={{ gap: spacing.xxl }}>
      <ReportCard report={report} error={error} loading={loading?.report ?? false} now={now} />
      <ConfigHistoryCard
        versions={versions}
        error={error}
        loading={loading?.versions ?? false}
        now={now}
      />
      <EventsCard events={events} error={error} loading={loading?.events ?? false} now={now} />
    </View>
  );
}
