import type { LiveAircraft } from './feed';

// Which entries of the live feed are one aircraft, frame after frame. The server names an aircraft
// by up to three keys and changes them as it goes (services/aircraft_feed.py in retina-server): its
// `hex`, an ICAO hex for ADS-B and an mn<sha> for a solve; `adsb_hex`, the ICAO hex of the
// transponder an ADS-B-seeded solve follows, read off the solver's own key, which is all the web
// map pairs an ADS-B entry and its solve by (dashboard/src/pages/map/trackStores.ts); and
// `predecessor_hex`, the solve hex a re-keyed coasting track took over. An entry that shares a key
// with an aircraft is that aircraft, and the aircraft keeps the id it was first shown under through
// every rename.
//
// The feed's `ground_truth_hex` is not a key. It is the simulator's truth match, the simulated
// aircraft nearest the entry within 8 km (resolve_ground_truth_hex in services/feed_helpers.py),
// absent off the simulator, and it moves from one aircraft to another as they pass near each
// other: a link through it would hand an aircraft, and the card open on it, to whichever aircraft
// it matched last.

/** A key no entry has carried for this long, on the wall clock, is forgotten. */
const KEY_TTL_MS = 120_000;
/**
 * Entries further apart than this are two aircraft whatever their keys say: the backend's own
 * distance for duplicates (services/feed_helpers.py, _DEDUP_PROXIMITY_KM), so a key two entries
 * far apart both carry never hides a real aircraft.
 */
const SAME_AIRCRAFT_KM = 3;
const EARTH_RADIUS_KM = 6371;
const RADIANS = Math.PI / 180;

/** One aircraft as the identity knows it. */
type Group = {
  /** Its id: the adsb_hex, else the hex, of the entry it was first seen as; a key either way. */
  readonly id: string;
  /** The order it was first seen in; of two aircraft found to be one, the older stays. */
  readonly born: number;
  /** The aircraft it turned out to be, once merged into it. */
  into: Group | null;
};

type Link = { group: Group; seenAt: number };

/** An entry of a frame, and its place in the frame. */
type Slot = { aircraft: LiveAircraft; at: number };

export type AircraftIdentity = {
  /**
   * The aircraft of one frame, one per id, linking the keys of each entry to the aircraft it is.
   * `now` is the wall clock (ms since epoch), which ages the keys.
   */
  resolve(aircraft: readonly LiveAircraft[], now: number): ReadonlyMap<string, LiveAircraft>;
  /** The id an id, hex or other key of an aircraft is shown under now; else the key itself. */
  idFor(key: string): string;
};

function keysOf({ hex, adsb_hex, predecessor_hex }: LiveAircraft): string[] {
  const keys = [hex];
  for (const key of [adsb_hex, predecessor_hex]) {
    if (key && !keys.includes(key)) keys.push(key);
  }
  return keys;
}

/** Great-circle distance, as the web map measures it (dashboard/src/utils/geo.ts). */
function apartKm(a: LiveAircraft, b: LiveAircraft): number {
  const h =
    Math.sin(((b.lat - a.lat) * RADIANS) / 2) ** 2 +
    Math.cos(a.lat * RADIANS) *
      Math.cos(b.lat * RADIANS) *
      Math.sin(((b.lon - a.lon) * RADIANS) / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

const isMultinode = (aircraft: LiveAircraft) =>
  aircraft.multinode === true || aircraft.position_source === 'multinode_solve';

// Which of two entries for one aircraft a frame shows, as the web map reconciles an ADS-B track
// with the solve for the same aircraft (dashboard/src/pages/map/trackStores.ts): the fresher fix,
// by `seen` (seconds since it, a missing one counting as 0); on a tie the multinode entry, the
// server's own rank; otherwise the one later in the frame.
function replaces(next: Slot, kept: Slot): boolean {
  const nextAge = next.aircraft.seen ?? 0;
  const keptAge = kept.aircraft.seen ?? 0;
  if (nextAge !== keptAge) return nextAge < keptAge;
  const nextSolve = isMultinode(next.aircraft);
  if (nextSolve !== isMultinode(kept.aircraft)) return nextSolve;
  return next.at > kept.at;
}

/**
 * The identity of the feed's aircraft across frames. An entry whose keys name no aircraft is a new
 * one, under its adsb_hex or else its hex, so an ADS-B entry and the solve that follows its
 * transponder get one id whichever of them comes first; one whose keys name aircraft is that
 * aircraft, and when they name several, those are one aircraft from then on, under the id of the
 * oldest. A frame shows one entry per aircraft, by `replaces`, except that an entry over
 * SAME_AIRCRAFT_KM from the entry shown for an aircraft is not that aircraft: with no other
 * aircraft near it, it is shown under its own hex and links no key that frame. A key no entry
 * carries for KEY_TTL_MS is forgotten, so what is kept is the keys of the last two minutes; an id
 * is kept until its aircraft has not been shown for as long.
 */
export function createAircraftIdentity(): AircraftIdentity {
  const links = new Map<string, Link>();
  let born = 0;
  let shown: ReadonlyMap<string, LiveAircraft> = new Map();

  // The aircraft a key names, through any merges since it was linked.
  function groupOf(key: string): Group | undefined {
    const link = links.get(key);
    if (!link) return undefined;
    while (link.group.into) link.group = link.group.into;
    return link.group;
  }

  function link(key: string, group: Group, now: number): void {
    const known = links.get(key);
    if (known) {
      known.group = group;
      known.seenAt = now;
    } else {
      links.set(key, { group, seenAt: now });
    }
  }

  function resolve(
    aircraft: readonly LiveAircraft[],
    now: number,
  ): ReadonlyMap<string, LiveAircraft> {
    for (const [key, { seenAt }] of links) {
      if (now - seenAt >= KEY_TTL_MS) links.delete(key);
    }
    const slots = aircraft.map((entry, at) => ({ aircraft: entry, at }));
    // An aircraft holds the entry it was shown as in the last frame from the start, so an entry
    // far from it that names it by some key is told apart from it whatever order the server lists
    // them in.
    const kept = new Map<Group, Slot>();
    for (const slot of slots) {
      const group = groupOf(slot.aircraft.hex);
      if (group && !kept.has(group) && shown.get(group.id)?.hex === slot.aircraft.hex) {
        kept.set(group, slot);
      }
    }
    const loose: Slot[] = [];
    for (const slot of slots) {
      const keys = keysOf(slot.aircraft);
      // The aircraft its keys name, apart from those shown this frame too far away to be it.
      const near = new Set<Group>();
      const far = new Set<Group>();
      for (const key of keys) {
        const group = groupOf(key);
        if (!group || near.has(group) || far.has(group)) continue;
        const rival = kept.get(group);
        if (rival && apartKm(rival.aircraft, slot.aircraft) > SAME_AIRCRAFT_KM) far.add(group);
        else near.add(group);
      }
      if (near.size === 0 && far.size > 0) {
        loose.push(slot);
        continue;
      }
      let target: Group | undefined;
      for (const group of near) if (!target || group.born < target.born) target = group;
      target ??= {
        id: slot.aircraft.adsb_hex || slot.aircraft.hex,
        born: born++,
        into: null,
      };
      let best = slot;
      for (const group of near) {
        const rival = kept.get(group);
        if (rival && !replaces(best, rival)) best = rival;
        if (group !== target) {
          group.into = target;
          kept.delete(group);
        }
      }
      // A key of an aircraft too far away to be this one stays with that aircraft.
      for (const key of keys) {
        const group = groupOf(key);
        if (!group || group === target) link(key, target, now);
      }
      kept.set(target, best);
    }

    const next = new Map<string, Slot>();
    for (const [group, slot] of kept) {
      next.set(group.id, slot);
      link(group.id, group, now);
    }
    // An entry under a hex already shown is the server listing one aircraft twice.
    for (const slot of loose) {
      const other = next.get(slot.aircraft.hex);
      if (!other || replaces(slot, other)) next.set(slot.aircraft.hex, slot);
    }
    // In the order the server lists them, which is the order they are drawn in.
    const order = [...next].sort(([, a], [, b]) => a.at - b.at);
    shown = new Map(order.map(([id, slot]) => [id, slot.aircraft]));
    return shown;
  }

  function idFor(key: string): string {
    if (shown.has(key)) return key;
    return groupOf(key)?.id ?? key;
  }

  return { resolve, idFor };
}
