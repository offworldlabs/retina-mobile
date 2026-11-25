import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';

import { apiBaseUrl } from '@/config/env';

import { toFeatureCollection, type FeedBox } from './feed';
import { createLiveFeed, type LiveFeed, type LiveFeedState } from './liveFeed';

const PAUSED: LiveFeedState = {
  aircraft: new Map(),
  collection: toFeatureCollection([]),
  count: 0,
  status: 'paused',
  clipped: false,
  lastFrameAt: null,
};

function subscribeAppState(onChange: () => void): () => void {
  const subscription = AppState.addEventListener('change', onChange);
  return () => subscription.remove();
}

const appIsActive = () => AppState.currentState === 'active';

/**
 * The live aircraft in `box`, while `enabled` and the app is in the foreground. Going to the
 * background stops the feed, socket and poll alike, and coming back starts it afresh; the screen
 * does not have to watch the app state itself. A new box goes to the running feed without
 * restarting it. The last aircraft stay while the feed is paused or reconnecting, until a frame
 * replaces them.
 */
export function useLiveAircraft(box: FeedBox | null, enabled: boolean): LiveFeedState {
  const foreground = useSyncExternalStore(subscribeAppState, appIsActive);
  const active = enabled && foreground;
  const [state, setState] = useState(PAUSED);
  const feedRef = useRef<LiveFeed | null>(null);
  const boxRef = useRef(box);

  useEffect(() => {
    boxRef.current = box;
    feedRef.current?.setBox(box);
  }, [box]);

  useEffect(() => {
    if (!active) return;
    feedRef.current ??= createLiveFeed({ apiBaseUrl, onUpdate: setState });
    const feed = feedRef.current;
    feed.setBox(boxRef.current);
    feed.start();
    return () => feed.stop();
  }, [active]);

  return state;
}
