import { queryOptions } from '@tanstack/react-query';

import { api, type ApiClient } from './client';
import { InvalidResponseError } from './errors';

// The server declares no response model for GET /api/radar/leaderboard (it picks the row
// class per caller), so these types follow PublicLeaderboardRow and SignedInLeaderboardRow in
// backend/routes/radar.py and the web's dashboard/src/types.ts.

/** Why a node has no rank; null on a ranked node. */
export type RankStatus =
  | 'no_opportunities'
  | 'low_evidence'
  | 'low_ceiling'
  | 'tower_unknown'
  | 'config_suspect'
  | 'synthetic';

/** What a sensitivity figure rests on: a fitted 50 % point, or a lower bound. */
export type SystemConstantBound = 'measured' | 'at_least';

/** What a range figure rests on: a measured fall-off, the processing window, or the evidence. */
export type RangeBound = 'measured' | 'window' | 'evidence';

/** One leaderboard row. Every caller gets the public fields; the miss counts need a session. */
export interface LeaderboardRow {
  node_ref: string;
  name: string;
  /** Null for a node the ranking leaves out, and `rank_status` says why. */
  rank: number | null;
  rank_status: RankStatus | null;
  system_constant_db: number | null;
  system_constant_sigma_db: number | null;
  system_constant_bound: SystemConstantBound | null;
  /** For a narrowbody airliner. */
  range_50pct_km: number | null;
  range_50pct_bound: RangeBound | null;
  detections: number;
  frames: number;
  tracks: number;
  /** Share of the last week's minutes the node delivered in; null until one is measured. */
  availability_7d: number | null;
  avg_snr: number;
  trust_score: number;
  reputation: number;
  online: boolean;
  in_range?: number;
  detected_in_range?: number;
  missed?: number;
  miss_rate?: number;
}

/** Every row, ranked first, and how many there are. */
export interface Leaderboard {
  leaderboard: LeaderboardRow[];
  total: number;
}

function isLeaderboard(data: unknown): data is Leaderboard {
  const value = data as Partial<Record<keyof Leaderboard, unknown>> | null;
  return Array.isArray(value?.leaderboard) && typeof value?.total === 'number';
}

/** The public node leaderboard, open to anyone. */
export async function fetchLeaderboard(
  signal?: AbortSignal,
  client: ApiClient = api,
): Promise<Leaderboard> {
  const data: unknown = await client.get('/api/radar/leaderboard', { signal });
  if (!isLeaderboard(data)) {
    throw new InvalidResponseError(
      'GET /api/radar/leaderboard: expected { leaderboard: [...], total: number }',
    );
  }
  return data;
}

export const leaderboardQuery = queryOptions({
  queryKey: ['radar', 'leaderboard'],
  queryFn: ({ signal }) => fetchLeaderboard(signal),
});
