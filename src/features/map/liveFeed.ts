import { api, isOffline as deviceIsOffline } from '@/api';

import {
  liveSocketUrl,
  parseFrame,
  reconnectDelay,
  toFeatureCollection,
  viewportMessage,
  VIEWPORT_SETTLE_MS,
  type AircraftCollection,
  type FeedBox,
  type LiveAircraft,
} from './feed';
import { createAircraftIdentity } from './identity';

/**
 * - `live`: the socket is open.
 * - `fallback`: the socket is not open and the HTTP poll has answered.
 * - `connecting`: neither, yet.
 * - `paused`: the feed is stopped; the last aircraft are kept.
 */
export type LiveFeedStatus = 'connecting' | 'live' | 'fallback' | 'paused';

export type LiveFeedState = {
  /** The aircraft of the last frame by id (identity.ts), which the server's renames keep. */
  aircraft: ReadonlyMap<string, LiveAircraft>;
  /** The same aircraft as one GeoJSON source. */
  collection: AircraftCollection;
  count: number;
  status: LiveFeedStatus;
  /** Whether the server cut the box down to its cap for the last frame. */
  clipped: boolean;
  /** When the last frame arrived (ms since epoch); null before the first. */
  lastFrameAt: number | null;
  /**
   * The id that any id, hex or other key of an aircraft is shown under now, which follows two ids
   * the server turns out to use for one aircraft onto one; a key the feed has not seen comes back
   * as it is. Absent before any feed has run, when every key is its own id.
   */
  idFor?: (key: string) => string;
};

export type LiveFeedOptions = {
  apiBaseUrl: string;
  /** Called once per frame, and on every status change. */
  onUpdate: (state: LiveFeedState) => void;
  WebSocketImpl?: typeof WebSocket;
  fetchFrame?: (box: FeedBox, signal: AbortSignal) => Promise<unknown>;
  isOffline?: () => boolean;
};

export type LiveFeed = {
  start(): void;
  stop(): void;
  setBox(box: FeedBox | null): void;
};

type Frame = NonNullable<ReturnType<typeof parseFrame>>;

/** With a box sent, a socket silent this long is a dead connection that never said so. */
const WATCHDOG_MS = 12_000;
const POLL_INTERVAL_MS = 1000;

/** aircraft-live.json for a box: the frame the socket would send for it. */
function fetchLiveFrame(box: FeedBox, signal: AbortSignal): Promise<unknown> {
  return api.get('/api/radar/data/aircraft-live.json', {
    params: { query: { bbox: box.join(',') } },
    signal,
  });
}

function parseMessage(data: unknown): unknown {
  if (typeof data !== 'string') return null;
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

/**
 * The live aircraft feed, with no React in it. start() opens the socket, and the HTTP poll while
 * the socket is not open; stop() ends both, and nothing reopens after it. A dropped socket is
 * reopened on a backoff that only a frame on the new socket resets, so a server that accepts and
 * then closes is asked less and less often. Each frame replaces the aircraft set and calls
 * onUpdate once. Which entries are one aircraft is kept across frames (identity.ts): stop() keeps
 * it, as its keys age out on their own, and a new feed starts with none.
 */
export function createLiveFeed(options: LiveFeedOptions): LiveFeed {
  const {
    apiBaseUrl,
    onUpdate,
    WebSocketImpl = WebSocket,
    fetchFrame = fetchLiveFrame,
    isOffline = deviceIsOffline,
  } = options;
  const socketUrl = liveSocketUrl(apiBaseUrl);

  let started = false;
  let box: FeedBox | null = null;

  // The current socket. Callbacks of any other one, closed or replaced, are ignored.
  let socket: WebSocket | null = null;
  let socketOpen = false;
  // The box last sent on the current socket, as text; null until one is.
  let sentBox: string | null = null;
  let lastMessageAt = 0;
  // Failed sockets since the last one that delivered a frame.
  let attempts = 0;

  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let settleTimer: ReturnType<typeof setTimeout> | null = null;
  let watchdogTimer: ReturnType<typeof setTimeout> | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let poll: AbortController | null = null;
  let polled = false;
  let nextRequest = 0;
  let latestSettled = 0;

  const identity = createAircraftIdentity();
  let aircraft: ReadonlyMap<string, LiveAircraft> = new Map();
  let collection = toFeatureCollection([]);
  let clipped = false;
  let lastFrameAt: number | null = null;
  let status: LiveFeedStatus = 'paused';

  const emit = () =>
    onUpdate({
      aircraft,
      collection,
      count: aircraft.size,
      status,
      clipped,
      lastFrameAt,
      idFor: identity.idFor,
    });

  function currentStatus(): LiveFeedStatus {
    if (!started) return 'paused';
    if (socketOpen) return 'live';
    return polled ? 'fallback' : 'connecting';
  }

  function refreshStatus(): void {
    const next = currentStatus();
    if (next === status) return;
    status = next;
    emit();
  }

  function takeFrame(frame: Frame): void {
    lastFrameAt = Date.now();
    aircraft = identity.resolve(frame.aircraft, lastFrameAt);
    collection = toFeatureCollection(aircraft);
    clipped = frame.clipped;
    status = currentStatus();
    emit();
  }

  function clearSettle(): void {
    if (settleTimer !== null) clearTimeout(settleTimer);
    settleTimer = null;
  }

  function clearWatchdog(): void {
    if (watchdogTimer !== null) clearTimeout(watchdogTimer);
    watchdogTimer = null;
  }

  // Checks the socket when the silence would reach WATCHDOG_MS, and again from the last message
  // if one came in meanwhile, so a message costs no timer.
  function armWatchdog(ws: WebSocket): void {
    clearWatchdog();
    watchdogTimer = setTimeout(
      () => {
        watchdogTimer = null;
        if (socket !== ws || !socketOpen) return;
        if (Date.now() - lastMessageAt >= WATCHDOG_MS) drop(ws);
        else armWatchdog(ws);
      },
      Math.max(0, lastMessageAt + WATCHDOG_MS - Date.now()),
    );
  }

  // Sends the latest box on the open socket unless it is the one sent last.
  function sendBox(): void {
    const ws = socket;
    if (!ws || !socketOpen || !box) return;
    const key = box.join(',');
    if (key === sentBox) return;
    try {
      ws.send(viewportMessage(box));
    } catch {
      drop(ws);
      return;
    }
    const first = sentBox === null;
    sentBox = key;
    // The server has been silent for want of a box, so the wait for its first frame starts now.
    if (first) {
      lastMessageAt = Date.now();
      armWatchdog(ws);
    }
  }

  function stopPoll(): void {
    if (pollTimer !== null) clearInterval(pollTimer);
    pollTimer = null;
    poll?.abort();
    poll = null;
    polled = false;
  }

  async function pollOnce(controller: AbortController): Promise<void> {
    const asked = box;
    if (!asked || isOffline()) return;
    const request = ++nextRequest;
    let data: unknown;
    try {
      data = await fetchFrame(asked, controller.signal);
    } catch {
      // A failed answer, a timeout or the abort: the next tick asks again.
      return;
    }
    // An answer older than one already shown is dropped, as is any after the poll ended.
    if (poll !== controller || controller.signal.aborted || request < latestSettled) return;
    latestSettled = request;
    const frame = parseFrame(data);
    if (!frame) return;
    polled = true;
    takeFrame(frame);
  }

  // The poll runs while the feed is started, the socket is not open and a box is known; it asks
  // at once, then every second.
  function startPoll(): void {
    if (!started || socketOpen || !box || pollTimer !== null) return;
    const controller = new AbortController();
    poll = controller;
    pollTimer = setInterval(() => void pollOnce(controller), POLL_INTERVAL_MS);
    void pollOnce(controller);
  }

  // Closes a socket and silences its callbacks. React Native's Android socket ignores close()
  // until its handshake is done and then opens anyway, so a socket still connecting here is
  // closed again as it opens; that late open reaches nothing else.
  function detach(ws: WebSocket): void {
    ws.onopen = ws.readyState === WebSocketImpl.CONNECTING ? () => ws.close() : null;
    ws.onmessage = null;
    ws.onclose = null;
    ws.onerror = null;
    try {
      ws.close();
    } catch {
      // Already closing or closed.
    }
  }

  // The current socket is gone (closed, failed or silent): forget it, reconnect on the backoff
  // and poll meanwhile.
  function drop(ws: WebSocket): void {
    if (socket !== ws) return;
    detach(ws);
    socket = null;
    socketOpen = false;
    sentBox = null;
    clearSettle();
    clearWatchdog();
    if (started) {
      reconnectTimer = setTimeout(connect, reconnectDelay(attempts));
      attempts += 1;
      startPoll();
    }
    refreshStatus();
  }

  function connect(): void {
    reconnectTimer = null;
    if (!started || socket) return;
    let ws: WebSocket;
    try {
      ws = new WebSocketImpl(socketUrl);
    } catch {
      reconnectTimer = setTimeout(connect, reconnectDelay(attempts));
      attempts += 1;
      return;
    }
    socket = ws;
    socketOpen = false;
    sentBox = null;
    const isCurrent = () => started && socket === ws;

    ws.onopen = () => {
      if (!isCurrent()) return;
      socketOpen = true;
      lastMessageAt = Date.now();
      stopPoll();
      // A box not known yet goes out when it is (setBox).
      sendBox();
      refreshStatus();
    };
    ws.onmessage = (event: MessageEvent) => {
      if (!isCurrent()) return;
      lastMessageAt = Date.now();
      const frame = parseFrame(parseMessage(event.data));
      if (!frame) return;
      // Only a frame proves the server serves this socket; an open alone does not.
      attempts = 0;
      takeFrame(frame);
    };
    ws.onclose = () => {
      if (isCurrent()) drop(ws);
    };
    ws.onerror = () => {
      if (isCurrent()) drop(ws);
    };
  }

  return {
    start() {
      if (started) return;
      started = true;
      attempts = 0;
      connect();
      startPoll();
      refreshStatus();
    },

    stop() {
      if (!started) return;
      started = false;
      if (reconnectTimer !== null) clearTimeout(reconnectTimer);
      reconnectTimer = null;
      clearSettle();
      clearWatchdog();
      stopPoll();
      const ws = socket;
      socket = null;
      socketOpen = false;
      sentBox = null;
      if (ws) detach(ws);
      refreshStatus();
    },

    // A box arriving on an open socket that has sent none goes at once: the server sends nothing
    // until it has one. A changed box goes once the view has been still for VIEWPORT_SETTLE_MS,
    // so of two changes inside that time only the second is sent. A socket not open yet sends
    // the latest box as it opens.
    setBox(next) {
      const changed = next?.join(',') !== box?.join(',');
      box = next;
      if (!started) return;
      startPoll();
      if (!socket || !socketOpen) return;
      if (!next) {
        clearSettle();
        return;
      }
      if (sentBox === null) {
        clearSettle();
        sendBox();
        return;
      }
      if (!changed) return;
      clearSettle();
      settleTimer = setTimeout(() => {
        settleTimer = null;
        sendBox();
      }, VIEWPORT_SETTLE_MS);
    },
  };
}
