/**
 * Type definitions for GraphDB Gateway Worker
 */

// Environment bindings for Cloudflare Worker
export interface Env {
  NEO4J_URI: string;
  NEO4J_USERNAME: string;
  NEO4J_PASSWORD: string;
  NEO4J_DATABASE: string;
}

// API Request/Response types

export interface CreatePIRequest {
  pi: string;
  parent?: string;
  children?: string[];
}

export interface QueryChildrenRequest {
  pi: string;
  label: string;
  type: string;
}

export interface EntityCandidate {
  canonical_id: string;
  label: string;
  type: string;
  properties: Record<string, any>;
}

export interface QueryChildrenResponse {
  candidates: EntityCandidate[];
}

export interface ListEntitiesRequest {
  pi?: string;             // Single PI ID
  pis?: string[];          // OR array of PI IDs
  type?: string;           // Optional: filter by entity type
}

export interface EntityWithSource {
  canonical_id: string;
  code: string;
  label: string;
  type: string;
  properties: Record<string, any>;
  source_pis: string[];    // Array of source PIs (deduplicated)
}

export interface ListEntitiesResponse {
  entities: EntityWithSource[];
  total_count: number;
}

export interface CreateEntityRequest {
  canonical_id: string;
  code: string;
  label: string;
  type: string;
  properties: Record<string, any>;
  source_pi: string;
}

export interface MergeEntityRequest {
  canonical_id: string;
  new_properties: Record<string, any>;
  source_pi: string;
}

export interface RelationshipData {
  subject_id: string;
  predicate: string;
  object_id: string;
  properties: Record<string, any>;
  source_pi: string;
}

export interface CreateRelationshipsRequest {
  relationships: RelationshipData[];
}

export interface ErrorResponse {
  error: string;
  code?: string;
  details?: any;
}

export interface SuccessResponse {
  success: boolean;
  message?: string;
  data?: any;
}
