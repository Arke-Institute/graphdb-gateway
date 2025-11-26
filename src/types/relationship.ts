/**
 * Types for relationship operations
 */

/**
 * Relationship data between entities
 */
export interface RelationshipData {
  subject_id: string;
  predicate: string;
  object_id: string;
  properties: Record<string, any>;
  source_pi: string;
}

/**
 * Request to create relationships in batch
 */
export interface CreateRelationshipsRequest {
  relationships: RelationshipData[];
}

/**
 * Detail of a relationship for GET /relationships/:canonical_id
 */
export interface EntityRelationshipDetail {
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
 * Response for GET /relationships/:canonical_id
 */
export interface GetEntityRelationshipsResponse {
  found: boolean;
  canonical_id?: string;
  relationships?: EntityRelationshipDetail[];
  total_count?: number;
}
