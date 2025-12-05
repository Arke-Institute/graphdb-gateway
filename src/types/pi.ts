/**
 * Types for PI (Processed Item) operations
 */

/**
 * Request to create a PI node with optional parent-child relationships
 */
export interface CreatePIRequest {
  pi: string;
  parent?: string;
  children?: string[];
}

/**
 * Request to get entities with relationships for a PI
 */
export interface PIEntitiesWithRelationshipsRequest {
  pi: string;
  type?: string;  // Optional: filter by entity type
}

/**
 * Relationship detail included with entity
 */
export interface EntityRelationshipInline {
  direction: 'incoming' | 'outgoing';
  predicate: string;
  target_id: string;
  target_code: string;
  target_label: string;
  target_type: string;
  properties: Record<string, any>;
  source_pi: string;
  created_at?: string;
}

/**
 * Entity with embedded relationships
 */
export interface EntityWithRelationships {
  canonical_id: string;
  code: string;
  label: string;
  type: string;
  properties: Record<string, any>;
  created_by_pi: string;
  source_pis: string[];
  relationships: EntityRelationshipInline[];
}

/**
 * Response from /pi/entities-with-relationships
 */
export interface PIEntitiesWithRelationshipsResponse {
  pi: string;
  entities: EntityWithRelationships[];
  total_count: number;
}

/**
 * Response from /pi/:pi/purge
 *
 * Removes all data contributed by a PI:
 * - Deletes RELATIONSHIP edges with source_pi = this PI
 * - Deletes EXTRACTED_FROM relationships to this PI
 * - Deletes orphaned entities (entities with no remaining EXTRACTED_FROM relationships
 *   that were created by this PI)
 * - Detaches entities that have other sources (removes EXTRACTED_FROM but keeps entity)
 */
export interface PurgePIDataResponse {
  success: boolean;
  pi: string;
  purged: {
    /** Canonical IDs of entities that were fully deleted (orphaned - no other sources) */
    entities_deleted: string[];
    /** Canonical IDs of entities that were detached (still have other sources) */
    entities_detached: string[];
    /** Number of RELATIONSHIP edges deleted */
    relationships_deleted: number;
    /** Number of EXTRACTED_FROM relationships deleted */
    extracted_from_deleted: number;
  };
}
