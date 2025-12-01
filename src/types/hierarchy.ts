/**
 * Types for hierarchy/lineage operations
 */

/**
 * Request to find entity in direct lineage (ancestors/descendants only)
 */
export interface FindInLineageRequest {
  sourcePi: string;           // The PI to search from
  candidateIds: string[];     // Entity canonical_ids to look for
  maxHops: number;            // Maximum hops up/down to search
}

/**
 * Response from find-in-lineage query
 */
export interface FindInLineageResponse {
  found: boolean;
  entity?: {
    canonical_id: string;
    code: string;
    label: string;
    type: string;
    properties: Record<string, any>;
    created_by_pi: string;
  };
  hops?: number;
  direction?: 'ancestor' | 'descendant' | 'same';
}

/**
 * Request to get full lineage (ancestors and/or descendants)
 */
export interface GetLineageRequest {
  sourcePi: string;
  direction: 'ancestors' | 'descendants' | 'both';
  maxHops: number;
}

/**
 * A PI node in the lineage result
 */
export interface LineagePiNode {
  id: string;
  hops: number;
  created_at?: string;
}

/**
 * Lineage result for one direction
 */
export interface LineageDirection {
  pis: LineagePiNode[];
  count: number;
  truncated: boolean;
}

/**
 * Response from get-lineage query
 */
export interface GetLineageResponse {
  sourcePi: string;
  ancestors?: LineageDirection;
  descendants?: LineageDirection;
}
