/**
 * Common types shared across the application
 */

/**
 * Environment bindings for Cloudflare Worker
 */
export interface Env {
  NEO4J_URI: string;
  NEO4J_USERNAME: string;
  NEO4J_PASSWORD: string;
  NEO4J_DATABASE: string;
}

/**
 * Standard error response format
 */
export interface ErrorResponse {
  error: string;
  code?: string;
  details?: any;
}

/**
 * Standard success response format
 */
export interface SuccessResponse {
  success: boolean;
  message?: string;
  data?: any;
}
