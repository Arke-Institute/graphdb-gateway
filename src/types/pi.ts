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
