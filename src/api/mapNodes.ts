import { api, type ApiClient } from './client';
import { InvalidResponseError } from './errors';

// The route declares no response model, so this follows map_nodes in backend/routes/map_nodes.py:
// { nodes: { <node_ref>: { node_ref, status, is_synthetic, location, detection_area, ... } } }.

/** GET /api/map/nodes as served: every published real node, keyed by its node_ref. */
export interface MapNodesBody {
  nodes: Record<string, unknown>;
}

function isMapNodesBody(data: unknown): data is MapNodesBody {
  const nodes = (data as { nodes?: unknown } | null)?.nodes;
  return typeof nodes === 'object' && nodes !== null && !Array.isArray(nodes);
}

/** The public map's node listing, open to anyone. */
export async function fetchMapNodes(
  signal?: AbortSignal,
  client: ApiClient = api,
): Promise<MapNodesBody> {
  const data: unknown = await client.get('/api/map/nodes', { signal });
  if (!isMapNodesBody(data)) {
    throw new InvalidResponseError('GET /api/map/nodes: expected { nodes: { ... } }');
  }
  return data;
}
