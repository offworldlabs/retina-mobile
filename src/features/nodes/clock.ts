import { useIsFocused } from 'expo-router';
import { useCallback, useState, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';

interface Clock {
  read: () => number;
  /** Keeps the time moving while the app is active; the returned function stops it. */
  run: (intervalMs: number, onChange: () => void) => () => void;
  /** Says the time is left standing, so the next run reads it afresh. */
  rest: () => void;
}

/**
 * One component's time: read when it mounts, then moved on only while a run keeps it going.
 * A run ticks every `intervalMs` while the app is active and stops its timer whenever the app is
 * not. Once the time has stood still, the next start reads it afresh at once.
 */
function createClock(): Clock {
  let now = Date.now();
  // Whether `now` is still the time: true from the read at mount until anything stops it.
  let current = true;
  return {
    read: () => now,
    rest: () => {
      current = false;
    },
    run(intervalMs, onChange) {
      let timer: ReturnType<typeof setInterval> | null = null;
      const tick = () => {
        now = Date.now();
        onChange();
      };
      const start = () => {
        if (timer !== null) return;
        if (!current) tick();
        current = true;
        timer = setInterval(tick, intervalMs);
      };
      const stop = () => {
        current = false;
        if (timer !== null) clearInterval(timer);
        timer = null;
      };
      const subscription = AppState.addEventListener('change', (state) =>
        state === 'active' ? start() : stop(),
      );
      if (AppState.currentState === 'active') start();
      else stop();
      return () => {
        subscription.remove();
        stop();
      };
    },
  };
}

/**
 * The time for a render to read instead of the clock. It moves on every `intervalMs` while the
 * screen is focused and the app is in the foreground, and stands still with no timer running
 * otherwise; coming back to the screen or to the app reads it afresh at once. A render must never
 * read the clock itself: the React Compiler caches what a render works out on the render's other
 * inputs, so a time read there stops moving.
 */
export function useNow(intervalMs: number): number {
  const focused = useIsFocused();
  const [clock] = useState(createClock);
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (focused) return clock.run(intervalMs, onChange);
      clock.rest();
      return () => {};
    },
    [clock, focused, intervalMs],
  );
  return useSyncExternalStore(subscribe, clock.read);
}
