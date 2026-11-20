export {
  api,
  createApiClient,
  setAuthTokenProvider,
  type ApiClient,
  type ApiClientOptions,
  type ApiMethod,
  type AuthTokenProvider,
  type CallOptions,
} from './client';
export {
  ApiError,
  HttpError,
  InvalidResponseError,
  NetworkError,
  TimeoutError,
  UnauthorizedError,
  isRetryable,
  userMessage,
  type ApiErrorKind,
} from './errors';
export {
  fetchLeaderboard,
  leaderboardQuery,
  type Leaderboard,
  type LeaderboardRow,
  type RangeBound,
  type RankStatus,
  type SystemConstantBound,
} from './leaderboard';
export { isOffline, useIsOffline } from './network';
export { QueryProvider, queryClient } from './query';
export type { components, operations, paths } from './schema.gen';
