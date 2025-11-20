/**
 * Types for hierarchy operations (parent/child PI traversal)
 */

/**
 * Request to find entity in parent/child PI hierarchy
 */
export interface FindInHierarchyRequest {
  pi: string;                                      // Current PI ID
  code: string;                                    // Entity code to find
  search_scope: 'parents' | 'children' | 'both';   // Where to search
  include_placeholder?: boolean;                   // Include type="unknown" entities (default: true)
}

/**
 * Response from find-in-hierarchy query
 */
export interface FindInHierarchyResponse {
  found: boolean;
  entity?: {
    canonical_id: string;
    code: string;
    label: string;
    type: string;
    properties: Record<string, any>;
    created_by_pi: string;          // PI that created the canonical entity (immutable)
    source_pis: string[];           // All PIs that extracted this entity
    is_placeholder: boolean;        // Computed: type === "unknown" && properties empty
  };
  found_in?: 'parent' | 'child';   // Where was it found?
}

/**
 * Request to get all entities from parent/child hierarchy
 */
export interface GetEntitiesFromHierarchyRequest {
  pi: string;                                            // Current PI ID
  direction: 'ancestors' | 'descendants' | 'both';       // Which direction to traverse
  exclude_type?: string[];                               // Types to exclude (e.g., ["file"])
  include_placeholders?: boolean;                        // Include type="unknown" (default: true)
}

/**
 * Entity from hierarchy with source information
 */
export interface HierarchyEntity {
  canonical_id: string;
  code: string;
  label: string;
  type: string;
  properties: Record<string, any>;
  created_by_pi: string;            // PI that created the canonical entity (immutable)
  source_pi: string;                // PI from which this entity was extracted (in this hierarchy query)
  all_source_pis: string[];         // All PIs that extracted this entity
  is_placeholder: boolean;
}

/**
 * Response from get entities hierarchy query
 */
export interface GetEntitiesFromHierarchyResponse {
  entities: HierarchyEntity[];
  total_count: number;
  from_parents: number;      // How many came from parents
  from_children: number;     // How many came from children
}
