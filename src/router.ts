/**
 * Request router and handler dispatch
 */

import { handleCreatePI } from './handlers/pi';
import {
  handleCreateEntity,
  handleMergeEntity,
  handleQueryEntity,
  handleListEntities,
  handleDeleteEntity,
  handleGetEntity,
  handleLookupByCode,
  handleLookupByLabel,
} from './handlers/entity';
import {
  handleFindInHierarchy,
  handleGetEntitiesHierarchy,
} from './handlers/hierarchy';
import {
  handleCreateRelationships,
  handleMergeRelationships,
  handleListRelationships,
} from './handlers/relationship';
import { handleClearAllData, handleCustomQuery } from './handlers/admin';
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
  'POST /entity/lookup/code': handleLookupByCode,
  'POST /entity/lookup/label': handleLookupByLabel,
  'POST /entity/find-in-hierarchy': handleFindInHierarchy,
  'POST /entities/list': handleListEntities,
  'POST /entities/hierarchy': handleGetEntitiesHierarchy,
  'POST /relationships/create': handleCreateRelationships,
  'POST /relationships/merge': handleMergeRelationships,
  'GET /relationships': (env: Env) => handleListRelationships(env),
  'POST /query': handleCustomQuery,
  'POST /admin/clear': (env: Env) => handleClearAllData(env),
};

/**
 * List of all available endpoints
 */
const ENDPOINTS = [
  'POST /pi/create',
  'POST /entity/create',
  'POST /entity/merge',
  'POST /entity/query',
  'POST /entity/lookup/code',
  'POST /entity/lookup/label',
  'GET /entity/:canonical_id',
  'DELETE /entity/:canonical_id',
  'POST /entity/find-in-hierarchy',
  'POST /entities/list',
  'POST /entities/hierarchy',
  'POST /relationships/create',
  'POST /relationships/merge',
  'GET /relationships',
  'POST /query',
  'POST /admin/clear',
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

  // Handle GET /entity/:canonical_id specially (URL parameter)
  if (request.method === 'GET' && path.startsWith('/entity/')) {
    const canonical_id = path.split('/entity/')[1];
    if (canonical_id) {
      try {
        return await handleGetEntity(env, canonical_id);
      } catch (error: any) {
        return errorResponse(
          'Internal server error',
          ERROR_CODES.INTERNAL_ERROR,
          { message: error.message, stack: error.stack }
        );
      }
    }
  }

  // Handle DELETE /entity/:canonical_id specially (URL parameter)
  if (request.method === 'DELETE' && path.startsWith('/entity/')) {
    const canonical_id = path.split('/entity/')[1];
    if (canonical_id) {
      try {
        return await handleDeleteEntity(env, canonical_id);
      } catch (error: any) {
        return errorResponse(
          'Internal server error',
          ERROR_CODES.INTERNAL_ERROR,
          { message: error.message, stack: error.stack }
        );
      }
    }
  }

  // Route to appropriate handler
  const routeKey = `${request.method} ${path}`;
  const handler = routes[routeKey];

  if (!handler) {
    // Route not found
    return errorResponse(
      'Endpoint not found',
      ERROR_CODES.NOT_FOUND,
      { path, method: request.method },
      404
    );
  }

  // Parse request body for POST requests
  let body: any = {};
  if (request.method === 'POST') {
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
  }

  // Execute handler
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
