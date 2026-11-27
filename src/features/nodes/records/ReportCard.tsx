import { View } from 'react-native';

import type { NodeReport } from '@/api';
import { ThemedText } from '@/components';
import { useTheme } from '@/theme';

import { CountBadge, Note, Readings, Subhead, When } from './parts';
import { RecordCard } from './RecordCard';
import { REPORT_ASIDE, reportView, type ReportError } from './values';

function Errors({ errors, now }: { errors: readonly ReportError[]; now: number }) {
  const { colors, spacing, radius } = useTheme();
  return (
    <View style={{ gap: spacing.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
        <Subhead text="Errors reported" />
        {errors.length > 0 && <CountBadge count={errors.length} />}
      </View>
      {errors.length ? (
        errors.map((error, i) => (
          <View
            key={i}
            style={{
              gap: spacing.xs,
              paddingVertical: spacing.md,
              paddingHorizontal: spacing.lg,
              backgroundColor: colors.bgSunk,
              borderLeftWidth: 2,
              borderLeftColor: colors.error,
              borderTopRightRadius: radius.sm,
              borderBottomRightRadius: radius.sm,
            }}
          >
            <ThemedText variant="body">{error.message}</ThemedText>
            <When at={error.at} now={now} variant="caption" />
          </View>
        ))
      ) : (
        <ThemedText variant="caption" color="secondary">
          No errors reported since this node joined your account.
        </ThemedText>
      )}
    </View>
  );
}

function Report({ report, now }: { report: NodeReport; now: number }) {
  const { spacing } = useTheme();
  const view = reportView(report);
  return (
    <View style={{ gap: spacing.xxl }}>
      <Readings title="Status" rows={view.status} empty="" now={now} />
      <Readings
        title="Health"
        rows={view.health}
        empty="This report carries no health readings."
        now={now}
      />
      <Readings
        title="Software"
        rows={view.software}
        empty="This report names no software versions."
        now={now}
      />
      <Errors errors={view.errors} now={now} />
    </View>
  );
}

/** The node's last heartbeat, as the node itself tells it. Diagnostic: the server decides
 *  whether a node is working from the frames it receives. */
export function ReportCard({
  report,
  error,
  loading,
  now,
}: {
  report: NodeReport | null;
  error: unknown | null;
  loading: boolean;
  now: number;
}) {
  return (
    <RecordCard
      title="Last report"
      what="the last report"
      aside={report ? REPORT_ASIDE : null}
      error={error}
      loading={loading}
      empty={!report}
    >
      {report ? (
        <Report report={report} now={now} />
      ) : (
        <Note text="This node has not sent a heartbeat report yet. Nodes on the v1 node software send one with every heartbeat; older node software and polled blah2 radars never do." />
      )}
    </RecordCard>
  );
}
