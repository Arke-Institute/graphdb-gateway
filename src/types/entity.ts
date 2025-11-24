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
 * Merge strategy options for entity merging
 */
export type MergeStrategy =
  | 'enrich_placeholder'   // Upgrade unknown→typed, empty→propertied
  | 'merge_peers'          // Merge two rich entities with conflict resolution
  | 'link_only'            // Just add PI to EXTRACTED_FROM (no data changes)
  | 'prefer_new';          // Overwrite with incoming data

/**
 * Enrichment data for entity merging
 */
export interface EnrichmentData {
  type?: string;                        // For upgrading placeholders
  label?: string;                       // For refining labels
  new_properties: Record<string, any>;
  merge_strategy: MergeStrategy;
}

/**
 * Request to merge entity data with existing entity
 */
export interface MergeEntityRequest {
  canonical_id: string;
  enrichment_data: EnrichmentData;
  source_pi: string;

  /**
   * Optional: If provided, absorb relationships from this duplicate entity using APOC.
   * The duplicate entity will be deleted automatically after relationships are transferred.
   */
  absorb_duplicate_id?: string;
}

/**
 * Property conflict information
 */
export interface PropertyConflict {
  property: string;
  existing_value: any;
  new_value: any;
  resolution: 'accumulated' | 'kept_existing' | 'preferred_new';
}

/**
 * Response from entity merge operation
 */
export interface MergeEntityResponse {
  canonical_id: string;
  updated: boolean;
  conflicts?: PropertyConflict[];
  absorbed_duplicate?: string;  // ID of absorbed entity (if absorb_duplicate_id was provided)
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
 * Request to lookup entity by code
 */
export interface LookupByCodeRequest {
  code: string;
}

/**
 * Response from lookup by code
 */
export interface LookupByCodeResponse {
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
 * Request to lookup entity by label and type
 */
export interface LookupByLabelRequest {
  label: string;
  type: string;
}

/**
 * Response from lookup by label (can return multiple matches)
 */
export interface LookupByLabelResponse {
  found: boolean;
  entities: Array<{
    canonical_id: string;
    code: string;
    label: string;
    type: string;
    properties: Record<string, any>;
    created_by_pi: string;
    source_pis: string[];
  }>;
}
