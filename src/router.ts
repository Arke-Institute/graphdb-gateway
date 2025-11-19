/**
 * Request router and handler dispatch
 */

import { handleCreatePI } from './handlers/pi';
import {
  handleCreateEntity,
  handleMergeEntity,
  handleQueryEntity,
  handleListEntities,
} from './handlers/entity';
import {
  handleFindInHierarchy,
  handleGetEntitiesHierarchy,
} from './handlers/hierarchy';
import { handleCreateRelationships } from './handlers/relationship';
import { errorResponse, handleOptions, jsonResponse } from './utils/response';
import { ERROR_CODES, API_VERSION, SERVICE_NAME } from './constants';
import { Env } from './types';

/**
 * Route table mapping method+path to handler functions
 */
type RouteHandler = (env: Env, body: any) => Promise<Response>;

interface RouteTable {
  [key: string]: RouteHandler;
}

const routes: RouteTable = {
  'POST /pi/create': handleCreatePI,
  'POST /entity/create': handleCreateEntity,
  'POST /entity/merge': handleMergeEntity,
  'POST /entity/query': handleQueryEntity,
  'POST /entity/find-in-hierarchy': handleFindInHierarchy,
  'POST /entities/list': handleListEntities,
  'POST /entities/hierarchy': handleGetEntitiesHierarchy,
  'POST /relationships/create': handleCreateRelationships,
};

/**
 * List of all available endpoints
 */
const ENDPOINTS = [
  'POST /pi/create',
  'POST /entity/create',
  'POST /entity/merge',
  'POST /entity/query',
  'POST /entity/find-in-hierarchy',
  'POST /entities/list',
  'POST /entities/hierarchy',
  'POST /relationships/create',
];

/**
 * Health check response
 */
function getHealthResponse(): any {
  return {
    status: 'healthy',
    service: SERVICE_NAME,
    version: API_VERSION,
    endpoints: ENDPOINTS,
  };
}

/**
 * Main request handler
 */
export async function handleRequest(
  request: Request,
  env: Env
): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;

  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return handleOptions();
  }

  // Health check endpoint accepts GET
  if (path === '/' || path === '/health') {
    if (request.method === 'GET') {
      return jsonResponse(getHealthResponse());
    }
  }

  // Only accept POST requests for API endpoints
  if (request.method !== 'POST') {
    return errorResponse(
      'Method not allowed',
      ERROR_CODES.METHOD_NOT_ALLOWED,
      null,
      405
    );
  }

  // Parse request body
  let body: any;
  try {
    body = await request.json();
  } catch (error) {
    return errorResponse(
      'Invalid JSON body',
      ERROR_CODES.INVALID_JSON,
      null,
      400
    );
  }

  // Route to appropriate handler
  const routeKey = `${request.method} ${path}`;
  const handler = routes[routeKey];

  if (handler) {
    try {
      return await handler(env, body);
    } catch (error: any) {
      return errorResponse(
        'Internal server error',
        ERROR_CODES.INTERNAL_ERROR,
        { message: error.message, stack: error.stack }
      );
    }
  }

  // Route not found
  return errorResponse(
    'Endpoint not found',
    ERROR_CODES.NOT_FOUND,
    { path, method: request.method },
    404
  );
}
