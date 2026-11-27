import * as Network from 'expo-network';
import { useSyncExternalStore } from 'react';

type Listener = (offline: boolean) => void;

// Offline only when the OS says there is no connection at all. isInternetReachable is
// ignored: the dev backend is on the host's loopback, which an emulator's reachability
// probe does not count. Unknown means online.
let offline = false;
let started = false;
let heardEvent = false;
const listeners = new Set<Listener>();

function apply(state: Network.NetworkState | undefined): void {
  const next = state?.isConnected === false;
  if (next === offline) return;
  offline = next;
  for (const listener of listeners) listener(next);
}

function start(): void {
  if (started) return;
  started = true;
  Network.addNetworkStateListener((state) => {
    heardEvent = true;
    apply(state);
  });
  // An event that lands first is newer than this answer.
  Network.getNetworkStateAsync().then(
    (state) => {
      if (!heardEvent) apply(state);
    },
    () => {},
  );
}

/** Whether the device has no network connection, as last reported by the OS. */
export function isOffline(): boolean {
  start();
  return offline;
}

/** Calls `listener` whenever isOffline() changes; returns the unsubscribe. */
export function subscribe(listener: Listener): () => void {
  start();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** isOffline() for a component, re-rendering when it changes. */
export function useIsOffline(): boolean {
  return useSyncExternalStore(subscribe, isOffline);
}
