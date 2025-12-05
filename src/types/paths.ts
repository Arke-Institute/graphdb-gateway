/**
 * Types for path-finding operations
 */

/**
 * A single edge in a path
 */
export interface PathEdge {
  subject_id: string;
  subject_label: string;
  subject_type: string;
  predicate: string;
  object_id: string;
  object_label: string;
  object_type: string;
  source_pi: string;
}

/**
 * Request for finding paths between source and target entity sets
 */
export interface PathsBetweenRequest {
  source_ids: string[];
  target_ids: string[];
  max_depth: number;
  direction: 'outgoing' | 'incoming' | 'both';
  limit?: number;
}

/**
 * A single path result from paths/between
 */
export interface PathResult {
  source_id: string;
  target_id: string;
  length: number;
  edges: PathEdge[];
}

/**
 * Response for paths/between endpoint
 */
export interface PathsBetweenResponse {
  paths: PathResult[];
  truncated: boolean;
}

/**
 * Request for finding reachable entities of a type
 */
export interface PathsReachableRequest {
  source_ids: string[];
  target_type: string;
  max_depth: number;
  direction: 'outgoing' | 'incoming' | 'both';
  limit: number;
}

/**
 * A single result from paths/reachable
 */
export interface ReachableResult {
  source_id: string;
  target_id: string;
  target_label: string;
  target_type: string;
  length: number;
  edges: PathEdge[];
}

/**
 * Response for paths/reachable endpoint
 */
export interface PathsReachableResponse {
  results: ReachableResult[];
  truncated: boolean;
}
