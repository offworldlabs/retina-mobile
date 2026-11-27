import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { fetchMapNodes } from '@/api';

import type { PointCollection } from './feed';

/** A public node as the map draws it. */
export type MapNode = {
  ref: string;
  lat: number;
  lon: number;
  online: boolean;
  /** The server's word for its liveness, as served; null when it gives none. */
  status: string | null;
  /** How far the server says it displaced the published position, in km; 0 when it gives none. */
  uncertaintyKm: number;
  coverage: NodeCoverage;
};

/** What the node's coverage line quotes: the served polygon's source, and what it measured. */
export type NodeCoverage = {
  /** The server's empirical_coverage.polygon_source; "evidence" when it gives none. */
  source: string;
  /** The calibration points behind the polygon; 0 when the server gives none. */
  points: number;
  /** The distance to the polygon's furthest vertex from the receiver, whole km; null without one. */
  reachKm: number | null;
  /** Whether the polygon has the three points an area needs. */
  drawable: boolean;
};

export type NodeCollection = PointCollection<{ ref: string; online: boolean }>;

type Entry = Record<string, unknown>;

function isRecord(value: unknown): value is Entry {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// The web's one reading of a node's status (dashboard/src/utils/nodes.ts): these two mean the
// server holds no connection for it, a missing status reads as offline, and any other word is a
// node that is there.
const ABSENT = new Set(['disconnected', 'never_connected']);

function isOnline(status: string | null): boolean {
  return status !== null && status !== '' && !ABSENT.has(status);
}

// The server's flag decides; the id prefixes cover only payloads that predate it
// (dashboard/src/utils/nodeKind.ts).
const SYNTHETIC_PREFIXES = ['synth-', 'e2e-', 'test-', 'realnode-'];

function isSynthetic(entry: Entry, ref: string): boolean {
  if (typeof entry.is_synthetic === 'boolean') return entry.is_synthetic;
  return SYNTHETIC_PREFIXES.some((prefix) => ref.startsWith(prefix));
}

// Same earth radius and haversine form as dashboard/src/utils/geo.ts.
const EARTH_RADIUS_KM = 6371;

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

function distanceKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const dLat = toRadians(bLat - aLat);
  const dLon = toRadians(bLon - aLon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(aLat)) * Math.cos(toRadians(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

function isLatLon(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    value.every((part) => typeof part === 'number' && Number.isFinite(part))
  );
}

// The served polygon as [lat, lon] pairs; anything that is not an array of them counts as none.
function readPolygon(value: unknown): [number, number][] | null {
  return Array.isArray(value) && value.every(isLatLon) ? (value as [number, number][]) : null;
}

// polygonMaxReachKm in dashboard/src/pages/map/nodeSites.ts: the furthest vertex, in whole km.
function polygonMaxReachKm(
  lat: number,
  lon: number,
  polygon: readonly [number, number][] | null,
): number | null {
  if (polygon === null || polygon.length === 0) return null;
  let max = 0;
  for (const [pLat, pLon] of polygon) {
    const d = distanceKm(lat, lon, pLat, pLon);
    if (d > max) max = d;
  }
  return Math.round(max);
}

// The defaults are the web's (nodeListing.ts): no polygon, no points, and evidence as the source.
function readCoverage(entry: Entry, lat: number, lon: number): NodeCoverage {
  const ec = isRecord(entry.empirical_coverage) ? entry.empirical_coverage : {};
  const polygon = readPolygon(ec.polygon);
  return {
    source: typeof ec.polygon_source === 'string' ? ec.polygon_source : 'evidence',
    points: typeof ec.n_points === 'number' && Number.isFinite(ec.n_points) ? ec.n_points : 0,
    reachKm: polygonMaxReachKm(lat, lon, polygon),
    drawable: polygon !== null && polygon.length >= 3,
  };
}

/**
 * The real nodes of a GET /api/map/nodes body, placed as the web map places them (radarNodeFrom
 * in dashboard/src/pages/map/nodeListing.ts): at the receiver end of the node's detection area,
 * which the backend has already displaced for the public. A node with no detection area, or one
 * whose receiver is the exact 0, 0 sentinel, has nowhere to go and is left out; so is a synthetic
 * one, which the route should never list.
 */
export function parseMapNodes(body: unknown): MapNode[] {
  if (!isRecord(body) || !isRecord(body.nodes)) return [];
  const nodes: MapNode[] = [];
  for (const [ref, entry] of Object.entries(body.nodes)) {
    if (!isRecord(entry) || isSynthetic(entry, ref)) continue;
    const area = entry.detection_area;
    const rx = isRecord(area) ? area.rx : undefined;
    if (!isRecord(rx)) continue;
    const { lat, lon } = rx;
    if (typeof lat !== 'number' || typeof lon !== 'number') continue;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    if (Math.abs(lat) < 1e-6 && Math.abs(lon) < 1e-6) continue;
    const status = typeof entry.status === 'string' ? entry.status : null;
    const uncertainty = rx.location_uncertainty_km;
    nodes.push({
      ref,
      lat,
      lon,
      online: isOnline(status),
      status,
      uncertaintyKm:
        typeof uncertainty === 'number' && Number.isFinite(uncertainty) ? uncertainty : 0,
      coverage: readCoverage(entry, lat, lon),
    });
  }
  return nodes;
}

/** The nodes as one GeoJSON source: a point per node, at [lon, lat]. */
export function nodesToFeatureCollection(nodes: readonly MapNode[]): NodeCollection {
  return {
    type: 'FeatureCollection',
    features: nodes.map((node) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [node.lon, node.lat] },
      properties: { ref: node.ref, online: node.online },
    })),
  };
}

/**
 * The one line the site popup prints about a node's coverage (coverageLine in
 * dashboard/src/pages/map/nodeSites.ts). "declared" is a synthetic node's cone; any other source
 * is a real receiver, quoted only for what it has been seen to detect.
 */
export function coverageLine(node: MapNode): string {
  const { source, points, reachKm, drawable } = node.coverage;
  if (source === 'declared') {
    return drawable
      ? `Coverage: declared beam (synthetic node), reach ≤ ${reachKm} km`
      : 'Coverage: declared beam (synthetic node)';
  }
  if (drawable) {
    return `Coverage: measured from ${points} calibration pts, reach ≤ ${reachKm} km`;
  }
  return `Coverage: not yet measured (${points || 0} calibration pts)`;
}

// A site is the exact published point, compared as groupNodesBySite does in nodeSites.ts.
function siteKey(node: MapNode): string {
  return `${node.lat.toFixed(5)},${node.lon.toFixed(5)}`;
}

/** The nodes published at the point of node `ref`, ordered by ref; none when `ref` is not listed. */
export function nodesAtSite(nodes: readonly MapNode[], ref: string): MapNode[] {
  const node = nodes.find((candidate) => candidate.ref === ref);
  if (!node) return [];
  const key = siteKey(node);
  return nodes
    .filter((candidate) => siteKey(candidate) === key)
    .sort((a, b) => a.ref.localeCompare(b.ref));
}

// The web map polls the listing as often; the server refreshes it every 30 s.
const REFRESH_INTERVAL_MS = 30_000;
const NO_NODES: MapNode[] = [];

/**
 * The public nodes, refreshed every 30 s while `enabled`. A failed refresh keeps the last
 * listing on the map, and `error` says why until one succeeds.
 */
export function useMapNodes(enabled: boolean): {
  nodes: MapNode[];
  byRef: ReadonlyMap<string, MapNode>;
  collection: NodeCollection;
  error: unknown | null;
} {
  const query = useQuery({
    queryKey: ['map', 'nodes'],
    queryFn: async ({ signal }) => parseMapNodes(await fetchMapNodes(signal)),
    enabled,
    refetchInterval: enabled ? REFRESH_INTERVAL_MS : false,
  });
  const nodes = query.data ?? NO_NODES;
  const byRef = useMemo(() => new Map(nodes.map((node) => [node.ref, node])), [nodes]);
  const collection = useMemo(() => nodesToFeatureCollection(nodes), [nodes]);
  return { nodes, byRef, collection, error: query.isError ? query.error : null };
}
