import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from 'react';
import { AccessibilityInfo } from 'react-native';

import type { AircraftCollection, AircraftProps, PointFeature } from './feed';
import type { LiveFeedState } from './liveFeed';
import {
  FRAME_MS,
  motionPlan,
  startGlide,
  stepGlide,
  stepLimitS,
  takeFix,
  type Glide,
  type MotionPlan,
} from './motion';
import { useAppActive } from './useLiveAircraft';

/** The weight of the latest step in the running average of what a step costs. */
const COST_WEIGHT = 0.2;
/** How long smoothing that the load turned off stays off before it is tried again. */
const RETRY_MS = 10_000;
/** A move smaller than this, in degrees (about a centimetre, or of heading), changes nothing seen. */
const UNSEEN_DEGREES = 1e-7;

type Track = { glide: Glide; props: AircraftProps };

type Smoother = {
  subscribe(onChange: () => void): () => void;
  /** The aircraft as the loop last drew them, or null while it is not drawing. */
  current(): AircraftCollection | null;
  start(): void;
  stop(): void;
  /** A feed state; its aircraft are taken in when they are a new frame. */
  take(feed: LiveFeedState): void;
  /** A drawn collection has reached the map, which ends the measure of the step that made it. */
  committed(collection: AircraftCollection): void;
};

/**
 * The glide loop, with no React in it. Between start() and stop() it takes each frame in and,
 * while the plan smooths, steps every aircraft on a frame callback every plan interval, building
 * one collection per step with plain loops; a step that moves nothing draws nothing. A new frame is
 * drawn at the next callback whatever the interval, so an aircraft that came or went shows at once.
 * Each step is timed from its start until the map has the result, and further while the thread
 * stays busy past the next frame; the average sets the plan. Smoothing the load turns off is tried
 * again after RETRY_MS; too many aircraft turn it off with nothing remembered.
 */
function createSmoother(): Smoother {
  const listeners = new Set<() => void>();
  let started = false;
  let frameId: number | null = null;
  // Each aircraft by id, and the same in the frame's order, which is the order they are drawn in.
  let tracks = new Map<string, Track>();
  let order: Track[] = [];
  let source: LiveFeedState['aircraft'] | null = null;
  let current: AircraftCollection | null = null;
  let plan: MotionPlan | undefined;
  let offSince: number | null = null;
  let averageCost: number | null = null;
  // The step being measured: when it began, and when its work, then the render it caused, ended.
  let measuring = false;
  let stepStartAt = 0;
  let stepEndAt = 0;
  let lastStepAt: number | null = null;
  let due = false;

  function publish(next: AircraftCollection | null): void {
    if (next === current) return;
    current = next;
    for (const listener of listeners) listener();
  }

  // Ends the drawing: the callback is cancelled and every aircraft forgotten, so drawing again
  // starts each one at its fix rather than gliding from wherever it was left.
  function halt(announce: boolean): void {
    if (frameId !== null) cancelAnimationFrame(frameId);
    frameId = null;
    tracks = new Map();
    order = [];
    measuring = false;
    lastStepAt = null;
    due = false;
    if (announce) publish(null);
    else current = null;
  }

  function forget(): void {
    plan = undefined;
    averageCost = null;
    offSince = null;
  }

  // The plan for `count` aircraft at the cost measured so far; false, with drawing halted, when
  // it does not smooth.
  function replan(count: number, now: number): boolean {
    plan = motionPlan(count, averageCost ?? 0, false, plan);
    if (plan.smooth) {
      offSince = null;
      return true;
    }
    offSince ??= now;
    halt(true);
    return false;
  }

  function ingest({ aircraft, collection }: LiveFeedState, now: number): void {
    const nextTracks = new Map<string, Track>();
    const nextOrder: Track[] = [];
    for (const { properties } of collection.features) {
      const fix = aircraft.get(properties.id);
      if (!fix || nextTracks.has(properties.id)) continue;
      // Matched by id, so an aircraft the server renames carries on from where it is drawn.
      let track = tracks.get(properties.id);
      if (track) {
        takeFix(track.glide, fix, now);
        track.props = properties;
      } else {
        track = { glide: startGlide(fix, now), props: properties };
      }
      nextTracks.set(properties.id, track);
      nextOrder.push(track);
    }
    tracks = nextTracks;
    order = nextOrder;
  }

  // Moves every aircraft to `now` and draws them; false when nothing moved, which draws nothing.
  // Each eases by the time since the last step, up to the step limit of the planned interval.
  function step(now: number, intervalMs: number): boolean {
    const dtS = lastStepAt === null ? 0 : (now - lastStepAt) / 1000;
    const maxStepS = stepLimitS(intervalMs);
    lastStepAt = now;
    let changed = due;
    due = false;
    for (const { glide } of order) {
      const { lat, lon, track } = glide;
      stepGlide(glide, now, dtS, maxStepS);
      changed ||=
        Math.abs(glide.lat - lat) > UNSEEN_DEGREES ||
        Math.abs(glide.lon - lon) > UNSEEN_DEGREES ||
        (glide.track !== null && track !== null && Math.abs(glide.track - track) > UNSEEN_DEGREES);
    }
    if (!changed) return false;
    const features = new Array<PointFeature<AircraftProps>>(order.length);
    for (let i = 0; i < order.length; i += 1) {
      const { glide, props } = order[i];
      features[i] = {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [glide.lon, glide.lat] },
        properties: {
          id: props.id,
          hex: props.hex,
          track: glide.track,
          callsign: props.callsign,
          alt: props.alt,
        },
      };
    }
    publish({ type: 'FeatureCollection', features });
    measuring = true;
    stepStartAt = now;
    stepEndAt = performance.now();
    return true;
  }

  function onFrame(): void {
    frameId = null;
    if (!started) return;
    const now = performance.now();
    if (measuring) {
      measuring = false;
      const cost = stepEndAt - stepStartAt + Math.max(0, now - stepEndAt - FRAME_MS);
      averageCost = averageCost === null ? cost : averageCost + COST_WEIGHT * (cost - averageCost);
      if (!replan(order.length, now)) return;
    }
    const interval = plan?.intervalMs ?? 0;
    // Half a frame early counts as on time, so a 33 ms interval is every other 60 Hz frame. A step
    // that moves nothing (no aircraft, or all of them parked or settled) ends the loop until the
    // next frame comes in, rather than waking the thread every display frame for nothing.
    if (due || lastStepAt === null || now - lastStepAt >= interval - FRAME_MS / 2) {
      if (!step(now, interval)) return;
    }
    frameId = requestAnimationFrame(onFrame);
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    current: () => current,

    start() {
      if (started) return;
      started = true;
      source = null;
      forget();
    },

    stop() {
      if (!started) return;
      started = false;
      source = null;
      halt(false);
    },

    take(feed) {
      if (!started || feed.aircraft === source) return;
      source = feed.aircraft;
      const now = performance.now();
      const count = feed.aircraft.size;
      if (!motionPlan(count, 0, false).smooth) {
        // Too many aircraft at any cost; a cost measured on these says nothing once they are fewer.
        forget();
        halt(true);
        return;
      }
      if (offSince !== null && now - offSince >= RETRY_MS) forget();
      if (!replan(count, now)) return;
      ingest(feed, now);
      due = true;
      frameId ??= requestAnimationFrame(onFrame);
    },

    committed(collection) {
      if (measuring && collection === current) stepEndAt = performance.now();
    },
  };
}

/** The system's reduce motion setting, kept current; null until it has been read. */
function useReduceMotion(): boolean | null {
  const [reduceMotion, setReduceMotion] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    let changed = false;
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', (enabled) => {
      changed = true;
      if (live) setReduceMotion(enabled);
    });
    // A change heard meanwhile is newer than the answer. A setting that cannot be read counts as
    // off, the system default.
    AccessibilityInfo.isReduceMotionEnabled().then(
      (enabled) => {
        if (live && !changed) setReduceMotion(enabled);
      },
      () => {
        if (live && !changed) setReduceMotion(false);
      },
    );
    return () => {
      live = false;
      subscription.remove();
    };
  }, []);
  return reduceMotion;
}

/**
 * The live aircraft as the map draws them: gliding between the feed's frames while `active` (the
 * screen in view), the app in the foreground and reduce motion off, at a rate the number of
 * aircraft and the measured cost allow (motionPlan). Otherwise, and until the first glide step,
 * it is `feed.collection` itself, so the map moves once a frame as the feed does. The loop stops
 * with the screen out of view, the app in the background or the component gone, and leaves no
 * frame callback or listener behind.
 */
export function useSmoothedAircraft(feed: LiveFeedState, active: boolean): AircraftCollection {
  const foreground = useAppActive();
  const reduceMotion = useReduceMotion();
  const [smoother] = useState(createSmoother);
  const smoothed = useSyncExternalStore(smoother.subscribe, smoother.current);
  const running = active && foreground && reduceMotion === false;

  useEffect(() => {
    if (!running) return;
    smoother.start();
    return smoother.stop;
  }, [running, smoother]);

  useEffect(() => {
    if (running) smoother.take(feed);
  }, [running, smoother, feed]);

  useLayoutEffect(() => {
    if (smoothed) smoother.committed(smoothed);
  }, [smoother, smoothed]);

  // Decided in this render for all that is known here, so the map gets each frame as it comes
  // from the moment smoothing is off, not one step later.
  const smooth = active && foreground && motionPlan(feed.count, 0, reduceMotion !== false).smooth;
  return smooth && smoothed ? smoothed : feed.collection;
}
