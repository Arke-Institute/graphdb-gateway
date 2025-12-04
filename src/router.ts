/**
 * Request router and handler dispatch
 */

import { handleCreatePI, handleGetPIEntitiesWithRelationships, handlePurgePIData } from './handlers/pi';
import {
  handleCreateEntity,
  handleMergeEntity,
  handleQueryEntity,
  handleListEntities,
  handleDeleteEntity,
  handleGetEntity,
  handleEntityExists,
  handleLookupByCode,
} from './handlers/entity';
import { handleFindInLineage, handleGetLineage } from './handlers/hierarchy';
import {
  handleCreateRelationships,
  handleMergeRelationships,
  handleGetEntityRelationships,
} from './handlers/relationship';
import { handleClearTestData, handleCustomQuery } from './handlers/admin';
import { handlePathsBetween, handlePathsReachable } from './handlers/paths';
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
  'POST /pi/lineage': handleGetLineage,
  'POST /pi/entities-with-relationships': handleGetPIEntitiesWithRelationships,
  'POST /entity/create': handleCreateEntity,
  'POST /entity/merge': handleMergeEntity,
  'POST /entity/query': handleQueryEntity,
  'POST /entities/list': handleListEntities,
  'POST /entities/lookup-by-code': handleLookupByCode,
  'POST /entities/find-in-lineage': handleFindInLineage,
  'POST /relationships/create': handleCreateRelationships,
  'POST /relationships/merge': handleMergeRelationships,
  'POST /paths/between': handlePathsBetween,
  'POST /paths/reachable': handlePathsReachable,
  'POST /query': handleCustomQuery,
  'POST /admin/clear-test-data': (env: Env) => handleClearTestData(env),
};

/**
 * List of all available endpoints
 */
const ENDPOINTS = [
  'POST /pi/create',
  'POST /pi/lineage',
  'POST /pi/entities-with-relationships',
  'POST /pi/:pi/purge',
  'POST /entity/create',
  'POST /entity/merge',
  'POST /entity/query',
  'GET /entity/exists/:canonical_id',
  'GET /entity/:canonical_id',
  'DELETE /entity/:canonical_id',
  'POST /entities/list',
  'POST /entities/lookup-by-code',
  'POST /entities/find-in-lineage',
  'POST /relationships/create',
  'POST /relationships/merge',
  'GET /relationships/:canonical_id',
  'POST /paths/between',
  'POST /paths/reachable',
  'POST /query',
  'POST /admin/clear-test-data',
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

  // Handle POST /pi/:pi/purge
  if (request.method === 'POST' && path.startsWith('/pi/') && path.endsWith('/purge')) {
    // Extract PI from path: /pi/{pi}/purge
    const pathParts = path.split('/');
    if (pathParts.length === 4 && pathParts[1] === 'pi' && pathParts[3] === 'purge') {
      const pi = decodeURIComponent(pathParts[2]);
      if (pi) {
        try {
          return await handlePurgePIData(env, pi);
        } catch (error: any) {
          return errorResponse(
            'Internal server error',
            ERROR_CODES.INTERNAL_ERROR,
            { message: error.message, stack: error.stack }
          );
        }
      }
    }
  }

  // Handle GET /entity/exists/:canonical_id (must check before /entity/:id)
  if (request.method === 'GET' && path.startsWith('/entity/exists/')) {
    const canonical_id = path.split('/entity/exists/')[1];
    if (canonical_id) {
      try {
        return await handleEntityExists(env, canonical_id);
      } catch (error: any) {
        return errorResponse(
          'Internal server error',
          ERROR_CODES.INTERNAL_ERROR,
          { message: error.message, stack: error.stack }
        );
      }
    }
  }

  // Handle GET /entity/:canonical_id
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

  // Handle DELETE /entity/:canonical_id
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

  // Handle GET /relationships/:canonical_id (must check before /relationships)
  if (request.method === 'GET' && path.startsWith('/relationships/')) {
    const canonical_id = path.split('/relationships/')[1];
    if (canonical_id) {
      try {
        return await handleGetEntityRelationships(env, canonical_id);
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
