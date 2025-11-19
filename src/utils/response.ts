/**
 * Response utility functions
 */

import { CORS_HEADERS } from '../constants';
import { ErrorResponse } from '../types';

/**
 * Handle CORS preflight requests
 */
export function handleOptions(): Response {
  return new Response(null, {
    headers: CORS_HEADERS,
  });
}

/**
 * Create JSON response with CORS headers
 */
export function jsonResponse(data: any, status: number = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...CORS_HEADERS,
    },
  });
}

/**
 * Create error response
 */
export function errorResponse(
  error: string,
  code?: string,
  details?: any,
  status: number = 500
): Response {
  const response: ErrorResponse = { error, code, details };
  return jsonResponse(response, status);
}
