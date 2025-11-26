/**
 * Types for Entity operations
 */

/**
 * Request to create a new entity
 */
export interface CreateEntityRequest {
  canonical_id: string;
  code: string;
  label: string;
  type: string;
  properties: Record<string, any>;
  source_pi: string;
}

/**
 * Request for atomic entity merge (absorb source into target)
 */
export interface AtomicMergeRequest {
  source_id: string;  // Entity to be absorbed and deleted
  target_id: string;  // Entity to keep (receives all relationships)
}

/**
 * Response from atomic entity merge
 */
export interface AtomicMergeResponse {
  success: boolean;
  target_id: string;
  merged: {
    properties_transferred: number;
    relationships_transferred: number;
    source_pis_added: string[];
  };
}

/**
 * Request to query entity by code
 */
export interface QueryEntityRequest {
  code: string;
}

/**
 * Entity relationship information
 */
export interface EntityRelationship {
  type: string;
  direction: 'outgoing' | 'incoming';
  target_code: string;
  target_label: string;
  target_type: string;
  target_canonical_id: string;
  properties: Record<string, any>;
}

/**
 * Response from entity query
 */
export interface QueryEntityResponse {
  found: boolean;
  entity?: {
    canonical_id: string;
    code: string;
    label: string;
    type: string;
    properties: Record<string, any>;
    created_by_pi: string;
    source_pis: string[];
  };
  relationships?: EntityRelationship[];
}

/**
 * Request to list entities from specific PIs
 */
export interface ListEntitiesRequest {
  pi?: string;             // Single PI ID
  pis?: string[];          // OR array of PI IDs
  type?: string;           // Optional: filter by entity type
}

/**
 * Entity with source PI information
 */
export interface EntityWithSource {
  canonical_id: string;
  code: string;
  label: string;
  type: string;
  properties: Record<string, any>;
  created_by_pi: string;   // PI that created the canonical entity (immutable)
  source_pis: string[];    // Array of source PIs (deduplicated)
}

/**
 * Response from list entities query
 */
export interface ListEntitiesResponse {
  entities: EntityWithSource[];
  total_count: number;
}

/**
 * Response from delete entity operation
 */
export interface DeleteEntityResponse {
  success: boolean;
  canonical_id: string;
  deleted: boolean;
  relationship_count: number;    // Number of relationships deleted along with entity
}

/**
 * Response from get entity by canonical_id operation
 */
export interface GetEntityResponse {
  found: boolean;
  entity?: {
    canonical_id: string;
    code: string;
    label: string;
    type: string;
    properties: Record<string, any>;
    created_by_pi: string;
    source_pis: string[];
  };
}

/**
 * Response from entity exists check
 */
export interface EntityExistsResponse {
  exists: boolean;
}
