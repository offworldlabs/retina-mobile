import type { MyClaim, OwnerAnalytics, OwnerNode, OwnerSummary, PositionStatus } from '@/api';
// From the module itself, not the '@/api' barrel: this file stays pure, and the barrel builds
// the app's query client and network listeners on import.
import { HttpError, userMessage } from '@/api/errors';

// The readings the My nodes list and the node page show, as the web shows them
// (dashboard/src/utils/nodes.ts, utils/format.ts, pages/user/OverviewPage.tsx).

const DASH = '—';

export type StatusTone = 'online' | 'offline' | 'never';

// Statuses that mean the server holds no live connection for the node. Anything else, 'active'
// or whatever a heartbeat reported, is a node that is there.
const ABSENT = new Set(['disconnected', 'never_connected']);

/** The word for a node's liveness: 'Online', 'Offline' or 'Never connected'. An empty status reads as offline. */
export function nodeStatus(status: string): { label: string; tone: StatusTone } {
  if (status !== '' && !ABSENT.has(status)) return { label: 'Online', tone: 'online' };
  if (status === 'never_connected') return { label: 'Never connected', tone: 'never' };
  return { label: 'Offline', tone: 'offline' };
}

const POSITION_PROBLEMS: Record<PositionStatus, string | null> = {
  positioned: null,
  missing_both: 'No position',
  missing_rx: 'No receiver position',
  missing_tx: 'No illuminator position',
};

/** What a node's position lacks, for the "Needs Attention" list; null for a node with both ends placed. */
export function positionProblem(status: PositionStatus): string | null {
  return POSITION_PROBLEMS[status] ?? null;
}

/** How long before `now` a moment was, in the coarsest unit that is not zero; null for an empty or unreadable time. */
export function heardAgo(iso: string | null, now: number): string | null {
  if (!iso) return null;
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return null;
  const s = Math.round((now - at) / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** What to call a node: its name (the owner's label first), else its ref. */
export function nodeName(node: Pick<OwnerNode, 'name' | 'node_ref'>): string {
  return node.name || node.node_ref || DASH;
}

/** A node's summary in the account's analytics, joined on node_ref through the map's own keys only. */
export function summaryFor(
  analytics: OwnerAnalytics | null,
  nodeRef: string | null,
): OwnerSummary | null {
  if (!analytics || !nodeRef) return null;
  return Object.prototype.hasOwnProperty.call(analytics.nodes, nodeRef)
    ? analytics.nodes[nodeRef]
    : null;
}

function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** A frequency in hertz as megahertz to the kilohertz ('174.928 MHz'), or a dash. */
export function formatMhz(hz: number | null): string {
  if (!hz || !isFiniteNumber(hz)) return DASH;
  return `${(hz / 1e6).toFixed(3)} MHz`;
}

/** Decibels to one place ('12.3 dB'), or a dash. */
export function formatDb(db: number | null | undefined): string {
  return isFiniteNumber(db) ? `${db.toFixed(1)} dB` : DASH;
}

/** A share from 0 to 1 as a percentage to one place, rounded down so only a whole reads 100%; or a dash. */
export function formatPercent(fraction: number | null | undefined): string {
  return isFiniteNumber(fraction) ? `${(Math.floor(fraction * 1000) / 10).toFixed(1)}%` : DASH;
}

/** A score from 0 to 1 as a percentage rounded to one place, as the web writes trust and reputation; or a dash. */
export function formatScore(fraction: number | null | undefined): string {
  return isFiniteNumber(fraction) ? `${(fraction * 100).toFixed(1)}%` : DASH;
}

export interface ClaimRowView {
  nodeRef: string;
  givenTo: string;
  linkText: string;
  live: boolean;
}

/** When a link lapses, on the device's clock, with the date once it is not the day of `now`. */
function lapses(atSeconds: number, now: number): string {
  const when = new Date(atSeconds * 1000);
  const time = when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return when.toDateString() === new Date(now).toDateString()
    ? time
    : `${when.toLocaleDateString([], { day: 'numeric', month: 'short' })}, ${time}`;
}

/** One row of "Waiting for you": the node, the address it was given, and whether its link still works. */
export function claimRow(claim: MyClaim, now: number): ClaimRowView {
  const expiresAt = claim.pending ? claim.expires_at : null;
  const live = expiresAt !== null && expiresAt * 1000 > now;
  return {
    nodeRef: claim.node_ref,
    givenTo: `Given ${claim.email}`,
    linkText: live ? `Link is live until ${lapses(expiresAt, now)}` : 'Link has expired',
    live,
  };
}

/** Whether a request failed because what it asked about is not there, or not the caller's. */
export function isNotFound(error: unknown): boolean {
  return error instanceof HttpError && error.status === 404;
}

/**
 * What a resend of a claim's link did, and whether the claim list should be read again: a send
 * replaces the outstanding link and its time, and a 404 means the claim is gone from the list.
 * A 429's limit is per node and can last an hour, so it is not the generic "wait a moment".
 */
export function resendOutcome(
  nodeRef: string,
  error: unknown | null,
): { text: string; refresh: boolean } {
  if (error === null) return { text: 'Sent. The link lasts fifteen minutes.', refresh: true };
  if (isNotFound(error)) {
    return { text: `Node ${nodeRef} is no longer waiting for you.`, refresh: true };
  }
  if (error instanceof HttpError && error.status === 429) {
    return { text: 'Too many links have been asked for. Try again later.', refresh: false };
  }
  return { text: userMessage(error), refresh: false };
}
