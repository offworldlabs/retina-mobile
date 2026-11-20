import createClient, {
  type Client,
  type ClientPathsWithMethod,
  type FetchResponse,
  type MaybeOptionalInit,
} from 'openapi-fetch';

import { apiBaseUrl } from '../config/env';
import {
  ApiError,
  HttpError,
  InvalidResponseError,
  NetworkError,
  TimeoutError,
  UnauthorizedError,
} from './errors';
import { isOffline as deviceIsOffline } from './network';
import type { paths } from './schema.gen';

const DEFAULT_TIMEOUT_MS = 10_000;

type Method = 'get' | 'put' | 'post' | 'delete' | 'patch';
type Media = `${string}/${string}`;
type PathsWith<M extends Method> = ClientPathsWithMethod<Client<paths>, M>;

/** Per-call options on top of openapi-fetch's own (params, body, headers, ...). */
export interface CallOptions {
  /** Give up when the whole answer, body included, has not arrived in this long. */
  timeoutMs?: number;
  /** The caller's own abort; it is rethrown as is, never reported as a timeout. */
  signal?: AbortSignal;
}

type RequiredKeysOf<T> = { [K in keyof T]-?: object extends Pick<T, K> ? never : K }[keyof T];
type InitArgs<Init> =
  RequiredKeysOf<Init> extends never ? [init?: Init & CallOptions] : [init: Init & CallOptions];
type DataOf<Operation, Init> =
  Operation extends Record<string | number, unknown>
    ? Exclude<FetchResponse<Operation, Init, Media>['data'], undefined>
    : never;

/** A call typed by the OpenAPI paths: resolves with the body; rejects with an ApiError, or with the caller's own abort. */
export type ApiMethod<M extends Method> = <
  P extends PathsWith<M>,
  Init extends MaybeOptionalInit<paths[P], M>,
>(
  url: P,
  ...init: InitArgs<Init>
) => Promise<DataOf<paths[P][M], Init>>;

export interface ApiClient {
  get: ApiMethod<'get'>;
  post: ApiMethod<'post'>;
  put: ApiMethod<'put'>;
  patch: ApiMethod<'patch'>;
  delete: ApiMethod<'delete'>;
}

export interface ApiClientOptions {
  baseUrl: string;
  fetch?: (request: Request) => Promise<Response>;
  timeoutMs?: number;
  isOffline?: () => boolean;
}

export type AuthTokenProvider = () => string | null | Promise<string | null>;

let authTokenProvider: AuthTokenProvider | null = null;

/**
 * Where sign-in plugs in: while one is set, a request whose final URL (after every middleware)
 * is under the app's API base URL gets `Authorization: Bearer <token>`, unless it already
 * carries one. Requests outside that base, another path on the same host included, get none.
 */
export function setAuthTokenProvider(provider: AuthTokenProvider | null): void {
  authTokenProvider = provider;
}

// The base goes through the same Request constructor as the request, so both URLs are compared
// in one form: kept as given by whatwg-fetch on device, WHATWG-normalized by undici in Node.
function isUnderApiBaseUrl(request: Request): boolean {
  return request.url.startsWith(new Request(`${apiBaseUrl}/`).url);
}

// Called on the request the transport receives, so no middleware can move a signed request
// to another URL afterwards.
async function attachAuthToken(request: Request): Promise<void> {
  const provider = authTokenProvider;
  if (!provider || request.headers.has('Authorization') || !isUnderApiBaseUrl(request)) return;
  const token = await provider();
  if (token) request.headers.set('Authorization', `Bearer ${token}`);
}

const DAY = '(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)';
const MONTH = '(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)';
const TIME = '\\d{2}:\\d{2}:\\d{2}';
const IMF_FIXDATE = new RegExp(`^${DAY}, \\d{2} ${MONTH} \\d{4} ${TIME} GMT$`);
const RFC850_DATE = new RegExp(
  `^(?:Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day, \\d{2}-${MONTH}-\\d{2} ${TIME} GMT$`,
);
const ASCTIME_DATE = new RegExp(`^${DAY} ${MONTH} [ \\d]\\d ${TIME} \\d{4}$`);

/**
 * A Retry-After value (RFC 9110 section 10.2.3) as ms to wait from `now`: delay-seconds as
 * given, or an HTTP-date less `now`. Null for anything else; the shape is checked before
 * Date.parse, which reads almost any text as some date.
 */
function retryAfterMsOf(value: string | null, now: number): number | null {
  if (value === null) return null;
  const text = value.trim();
  if (/^\d+$/.test(text)) return Number(text) * 1000;
  let at = Number.NaN;
  if (IMF_FIXDATE.test(text) || RFC850_DATE.test(text)) at = Date.parse(text);
  else if (ASCTIME_DATE.test(text)) at = Date.parse(`${text} GMT`);
  return Number.isFinite(at) ? Math.max(0, at - now) : null;
}

async function httpErrorOf(response: Response): Promise<HttpError> {
  const body: unknown = await response.json().catch(() => null);
  if (response.status === 401) return new UnauthorizedError(body);
  const retryAfterMs = retryAfterMsOf(response.headers.get('Retry-After'), Date.now());
  return new HttpError(response.status, body, retryAfterMs);
}

type LooseInit = Record<string, unknown> & CallOptions;

export function createApiClient(options: ApiClientOptions): ApiClient {
  const {
    baseUrl,
    fetch: transport = (request: Request) => fetch(request),
    timeoutMs: defaultTimeoutMs = DEFAULT_TIMEOUT_MS,
    isOffline = deviceIsOffline,
  } = options;
  const client = createClient<paths>({ baseUrl });
  // The typed surface is ApiMethod; inside, one untyped bridge to openapi-fetch.
  const request = client.request as unknown as (
    method: Method,
    url: string,
    init: object,
  ) => Promise<{ data?: unknown }>;

  async function call(method: Method, url: string, init: LooseInit = {}): Promise<unknown> {
    const { timeoutMs = defaultTimeoutMs, signal, ...rest } = init;
    if (isOffline()) throw new NetworkError(true);

    // One controller per call: the caller's abort and the timeout both end it, and the
    // timer runs until the body is parsed, not just until the headers arrive.
    const controller = new AbortController();
    const forward = () => controller.abort(signal?.reason);
    if (signal?.aborted) forward();
    else signal?.addEventListener('abort', forward);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    let answered = false;

    const send = async (outgoing: Request): Promise<Response> => {
      // Outside the try: a token provider's own error is not a network failure.
      await attachAuthToken(outgoing);
      let response: Response;
      try {
        response = await transport(outgoing);
      } catch (cause) {
        if (controller.signal.aborted) throw cause;
        throw new NetworkError(isOffline(), { cause });
      }
      if (!response.ok) throw await httpErrorOf(response);
      answered = true;
      return response;
    };

    try {
      const { data } = await request(method, url, {
        ...rest,
        signal: controller.signal,
        fetch: send,
      });
      return data;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (timedOut) throw new TimeoutError(timeoutMs, { cause: error });
      if (signal?.aborted) throw error;
      if (answered) {
        // A 2xx arrived; what failed is reading or parsing its body.
        if (error instanceof SyntaxError) {
          throw new InvalidResponseError(`${method.toUpperCase()} ${url}: the body is not JSON`, {
            cause: error,
          });
        }
        throw new NetworkError(isOffline(), { cause: error });
      }
      throw error;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', forward);
    }
  }

  const bind = <M extends Method>(method: M) =>
    ((url: string, init?: LooseInit) => call(method, url, init)) as unknown as ApiMethod<M>;

  return {
    get: bind('get'),
    post: bind('post'),
    put: bind('put'),
    patch: bind('patch'),
    delete: bind('delete'),
  };
}

/** The app's client, pointed at the API base URL of this build's environment. */
export const api = createApiClient({ baseUrl: apiBaseUrl });
