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
