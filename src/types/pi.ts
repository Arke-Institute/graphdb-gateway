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
