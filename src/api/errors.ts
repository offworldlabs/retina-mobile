export type ApiErrorKind = 'http' | 'unauthorized' | 'timeout' | 'network' | 'invalid-response';

/** Every failure the API client throws. `kind` tells them apart without instanceof. */
export abstract class ApiError extends Error {
  abstract readonly kind: ApiErrorKind;
}

/** FastAPI's error body: `{"detail": "..."}`, or `{"detail": {"reason", "message"}}`. */
function detailOf(body: unknown): { reason: string | null; message: string | null } {
  const detail = (body as { detail?: unknown } | null)?.detail;
  if (typeof detail === 'string') return { reason: null, message: detail };
  if (typeof detail === 'object' && detail !== null) {
    const { reason, message } = detail as { reason?: unknown; message?: unknown };
    return {
      reason: typeof reason === 'string' ? reason : null,
      message: typeof message === 'string' ? message : null,
    };
  }
  return { reason: null, message: null };
}

/** A non-2xx answer. `body` is the parsed JSON body, or null when there was none. */
export class HttpError extends ApiError {
  readonly kind: 'http' | 'unauthorized' = 'http';
  readonly status: number;
  readonly body: unknown;
  /** The machine-readable `detail.reason`, when the server gave one. */
  readonly reason: string | null;
  /** How long Retry-After asked the caller to wait, in ms; null when absent or unreadable. */
  readonly retryAfterMs: number | null;

  constructor(status: number, body: unknown, retryAfterMs: number | null = null) {
    const { reason, message } = detailOf(body);
    super(message ?? `HTTP ${status}`);
    this.name = 'HttpError';
    this.status = status;
    this.body = body;
    this.reason = reason;
    this.retryAfterMs = retryAfterMs;
  }
}

/** A 401: the server answered, the caller is not signed in. Never retried. */
export class UnauthorizedError extends HttpError {
  readonly kind = 'unauthorized';

  constructor(body: unknown = null) {
    super(401, body);
    this.name = 'UnauthorizedError';
  }
}

/** No complete answer, body included, within the client's timeout. */
export class TimeoutError extends ApiError {
  readonly kind = 'timeout';
  readonly timeoutMs: number;

  constructor(timeoutMs: number, options?: ErrorOptions) {
    super(`No response within ${timeoutMs} ms`, options);
    this.name = 'TimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

/** The request never got an answer. `offline` is true when the device had no connection. */
export class NetworkError extends ApiError {
  readonly kind = 'network';
  readonly offline: boolean;

  constructor(offline: boolean, options?: ErrorOptions) {
    super(offline ? 'The device is offline' : 'The server could not be reached', options);
    this.name = 'NetworkError';
    this.offline = offline;
  }
}

/** A 2xx answer whose body is not what the client expects. */
export class InvalidResponseError extends ApiError {
  readonly kind = 'invalid-response';

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'InvalidResponseError';
  }
}

/** Whether trying the same request again could succeed. */
export function isRetryable(error: unknown): boolean {
  if (error instanceof NetworkError) return !error.offline;
  if (error instanceof TimeoutError) return true;
  if (error instanceof HttpError) return error.status >= 500 || error.status === 429;
  return false;
}

/** One short sentence the UI can show for a failed request. */
export function userMessage(error: unknown): string {
  if (error instanceof NetworkError && error.offline) {
    return "You're offline. Check your connection and try again.";
  }
  if (error instanceof TimeoutError) return 'The server took too long to answer. Try again.';
  if (error instanceof UnauthorizedError) return 'Sign in to see this.';
  if (error instanceof HttpError && error.status === 429) {
    return 'Too many requests. Wait a moment and try again.';
  }
  if (error instanceof NetworkError || (error instanceof HttpError && error.status >= 500)) {
    return "The server isn't available right now. Try again soon.";
  }
  return 'Something went wrong. Try again.';
}
