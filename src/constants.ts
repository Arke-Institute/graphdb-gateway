/**
 * Constants and configuration values
 */

/**
 * CORS headers for all responses
 */
export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

/**
 * Error codes used throughout the API
 */
export const ERROR_CODES = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  ENTITY_NOT_FOUND: 'ENTITY_NOT_FOUND',
  ENTITY_ALREADY_EXISTS: 'ENTITY_ALREADY_EXISTS',
  NOT_A_PLACEHOLDER: 'NOT_A_PLACEHOLDER',
  PI_NOT_FOUND: 'PI_NOT_FOUND',
  INVALID_MERGE_STRATEGY: 'INVALID_MERGE_STRATEGY',
  HIERARCHY_NOT_FOUND: 'HIERARCHY_NOT_FOUND',
  BATCH_TOO_LARGE: 'BATCH_TOO_LARGE',
  METHOD_NOT_ALLOWED: 'METHOD_NOT_ALLOWED',
  INVALID_JSON: 'INVALID_JSON',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  NOT_FOUND: 'NOT_FOUND',
} as const;

/**
 * API version
 */
export const API_VERSION = '1.0.0';

/**
 * Service name
 */
export const SERVICE_NAME = 'GraphDB Gateway Worker';
