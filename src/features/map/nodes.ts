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
    nodes.push({ ref, lat, lon, online: isOnline(status), status });
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
