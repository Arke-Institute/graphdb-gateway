/**
 * GraphDB Gateway Worker
 * Cloudflare Worker gateway to Neo4j graph database
 */

import { executeQuery } from './neo4j';
import {
  Env,
  CreatePIRequest,
  QueryChildrenRequest,
  QueryChildrenResponse,
  CreateEntityRequest,
  MergeEntityRequest,
  CreateRelationshipsRequest,
  ErrorResponse,
  SuccessResponse,
} from './types';

/**
 * CORS headers for all responses
 */
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

/**
 * Handle CORS preflight requests
 */
function handleOptions(): Response {
  return new Response(null, {
    headers: CORS_HEADERS,
  });
}

/**
 * Create JSON response with CORS headers
 */
function jsonResponse(data: any, status: number = 200): Response {
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
function errorResponse(error: string, code?: string, details?: any, status: number = 500): Response {
  const response: ErrorResponse = { error, code, details };
  return jsonResponse(response, status);
}

/**
 * POST /pi/create
 * Create PI node with parent-child relationships
 */
async function handleCreatePI(env: Env, body: CreatePIRequest): Promise<Response> {
  try {
    const { pi, parent, children = [] } = body;

    if (!pi) {
      return errorResponse('Missing required field: pi', 'VALIDATION_ERROR', null, 400);
    }

    // Build query dynamically based on provided relationships
    let query = `
      MERGE (p:PI {id: $pi})
      ON CREATE SET p.created_at = datetime(), p.indexed_at = datetime()
      ON MATCH SET p.indexed_at = datetime()
    `;

    const params: Record<string, any> = { pi };

    // Add parent relationship if provided
    if (parent) {
      query += `
        WITH p
        MERGE (parent:PI {id: $parent})
        ON CREATE SET parent.created_at = datetime(), parent.indexed_at = datetime()
        MERGE (parent)-[:PARENT_OF]->(p)
        MERGE (p)-[:CHILD_OF]->(parent)
      `;
      params.parent = parent;
    }

    // Add children relationships if provided
    if (children.length > 0) {
      query += `
        WITH p
        UNWIND $children AS childId
        MERGE (child:PI {id: childId})
        ON CREATE SET child.created_at = datetime(), child.indexed_at = datetime()
        MERGE (p)-[:PARENT_OF]->(child)
        MERGE (child)-[:CHILD_OF]->(p)
      `;
      params.children = children;
    }

    query += ` RETURN p`;

    const { summary } = await executeQuery(env, query, params);

    const response: SuccessResponse = {
      success: true,
      message: 'PI node created successfully',
      data: {
        pi,
        nodesCreated: summary.counters.updates().nodesCreated,
        relationshipsCreated: summary.counters.updates().relationshipsCreated,
      },
    };

    return jsonResponse(response);
  } catch (error: any) {
    return errorResponse(
      error.message || 'Failed to create PI',
      error.code,
      { stack: error.stack }
    );
  }
}

/**
 * POST /entities/query_children
 * Query entities from child PIs with exact label+type match
 */
async function handleQueryChildren(env: Env, body: QueryChildrenRequest): Promise<Response> {
  try {
    const { pi, label, type } = body;

    if (!pi || !label || !type) {
      return errorResponse(
        'Missing required fields: pi, label, type',
        'VALIDATION_ERROR',
        null,
        400
      );
    }

    const query = `
      MATCH (pi:PI {id: $pi})<-[:CHILD_OF]-(child:PI)<-[:EXTRACTED_FROM]-(e:Entity)
      WHERE e.label = $label AND e.type = $type
      RETURN DISTINCT
        e.canonical_id AS canonical_id,
        e.label AS label,
        e.type AS type,
        e.properties AS properties
    `;

    const { records } = await executeQuery(env, query, { pi, label, type });

    const candidates = records.map((record) => ({
      canonical_id: record.get('canonical_id'),
      label: record.get('label'),
      type: record.get('type'),
      properties: record.get('properties') ? JSON.parse(record.get('properties')) : {},
    }));

    const response: QueryChildrenResponse = { candidates };
    return jsonResponse(response);
  } catch (error: any) {
    return errorResponse(
      error.message || 'Failed to query children',
      error.code,
      { stack: error.stack }
    );
  }
}

/**
 * POST /entity/create
 * Create new canonical entity with EXTRACTED_FROM relationship
 */
async function handleCreateEntity(env: Env, body: CreateEntityRequest): Promise<Response> {
  try {
    const { canonical_id, code, label, type, properties, source_pi } = body;

    if (!canonical_id || !code || !label || !type || !source_pi) {
      return errorResponse(
        'Missing required fields: canonical_id, code, label, type, source_pi',
        'VALIDATION_ERROR',
        null,
        400
      );
    }

    // Determine if entity should have a subtype label
    let entityLabel = 'Entity';
    if (type === 'date') {
      entityLabel = 'Entity:Date';
    } else if (type === 'file') {
      entityLabel = 'Entity:File';
    }

    const query = `
      MATCH (pi:PI {id: $source_pi})
      CREATE (e:${entityLabel} {
        canonical_id: $canonical_id,
        code: $code,
        label: $label,
        type: $type,
        properties: $properties,
        first_seen: datetime(),
        last_updated: datetime()
      })
      CREATE (e)-[:EXTRACTED_FROM {
        original_code: $code,
        extracted_at: datetime()
      }]->(pi)
      RETURN e
    `;

    const { summary } = await executeQuery(env, query, {
      canonical_id,
      code,
      label,
      type,
      properties: JSON.stringify(properties || {}),
      source_pi,
    });

    const response: SuccessResponse = {
      success: true,
      message: 'Entity created successfully',
      data: {
        canonical_id,
        nodesCreated: summary.counters.updates().nodesCreated,
        relationshipsCreated: summary.counters.updates().relationshipsCreated,
      },
    };

    return jsonResponse(response);
  } catch (error: any) {
    return errorResponse(
      error.message || 'Failed to create entity',
      error.code,
      { stack: error.stack }
    );
  }
}

/**
 * POST /entity/merge
 * Merge entity with existing canonical entity (add new source PI)
 */
async function handleMergeEntity(env: Env, body: MergeEntityRequest): Promise<Response> {
  try {
    const { canonical_id, new_properties, source_pi } = body;

    if (!canonical_id || !source_pi) {
      return errorResponse(
        'Missing required fields: canonical_id, source_pi',
        'VALIDATION_ERROR',
        null,
        400
      );
    }

    // For property merging, we'll just overwrite with new properties
    // A more sophisticated merge would require APOC or application-level logic
    const query = `
      MATCH (e:Entity {canonical_id: $canonical_id})
      MATCH (pi:PI {id: $source_pi})

      // Update properties (simple overwrite for now)
      SET e.properties = $new_properties
      SET e.last_updated = datetime()

      // Create new EXTRACTED_FROM relationship if it doesn't exist
      MERGE (e)-[:EXTRACTED_FROM {
        original_code: e.code,
        extracted_at: datetime()
      }]->(pi)

      RETURN e
    `;

    const { summary } = await executeQuery(env, query, {
      canonical_id,
      new_properties: JSON.stringify(new_properties || {}),
      source_pi,
    });

    const response: SuccessResponse = {
      success: true,
      message: 'Entity merged successfully',
      data: {
        canonical_id,
        propertiesUpdated: summary.counters.updates().propertiesSet,
        relationshipsCreated: summary.counters.updates().relationshipsCreated,
      },
    };

    return jsonResponse(response);
  } catch (error: any) {
    return errorResponse(
      error.message || 'Failed to merge entity',
      error.code,
      { stack: error.stack }
    );
  }
}

/**
 * POST /relationships/create
 * Batch create relationships between canonical entities
 */
async function handleCreateRelationships(env: Env, body: CreateRelationshipsRequest): Promise<Response> {
  try {
    const { relationships } = body;

    if (!relationships || !Array.isArray(relationships) || relationships.length === 0) {
      return errorResponse(
        'Missing or invalid field: relationships (must be non-empty array)',
        'VALIDATION_ERROR',
        null,
        400
      );
    }

    // Validate all relationships have required fields
    for (const rel of relationships) {
      if (!rel.subject_id || !rel.predicate || !rel.object_id || !rel.source_pi) {
        return errorResponse(
          'Each relationship must have: subject_id, predicate, object_id, source_pi',
          'VALIDATION_ERROR',
          null,
          400
        );
      }
    }

    // Serialize properties to JSON strings
    const relationshipsWithJsonProps = relationships.map(rel => ({
      subject_id: rel.subject_id,
      predicate: rel.predicate,
      object_id: rel.object_id,
      properties: JSON.stringify(rel.properties || {}),
      source_pi: rel.source_pi,
    }));

    const query = `
      UNWIND $relationships AS rel
      MATCH (subject:Entity {canonical_id: rel.subject_id})
      MATCH (object:Entity {canonical_id: rel.object_id})
      CREATE (subject)-[:RELATIONSHIP {
        predicate: rel.predicate,
        properties: rel.properties,
        source_pi: rel.source_pi,
        created_at: datetime()
      }]->(object)
    `;

    const { summary } = await executeQuery(env, query, { relationships: relationshipsWithJsonProps });

    const response: SuccessResponse = {
      success: true,
      message: 'Relationships created successfully',
      data: {
        count: relationships.length,
        relationshipsCreated: summary.counters.updates().relationshipsCreated,
      },
    };

    return jsonResponse(response);
  } catch (error: any) {
    return errorResponse(
      error.message || 'Failed to create relationships',
      error.code,
      { stack: error.stack }
    );
  }
}

/**
 * Router function
 */
async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;

  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return handleOptions();
  }

  // Health check endpoint accepts GET
  if (path === '/' || path === '/health') {
    if (request.method === 'GET') {
      return jsonResponse({
        status: 'healthy',
        service: 'GraphDB Gateway Worker',
        version: '1.0.0',
        endpoints: [
          'POST /pi/create',
          'POST /entities/query_children',
          'POST /entity/create',
          'POST /entity/merge',
          'POST /relationships/create',
        ],
      });
    }
  }

  // Only accept POST requests for API endpoints
  if (request.method !== 'POST') {
    return errorResponse('Method not allowed', 'METHOD_NOT_ALLOWED', null, 405);
  }

  // Parse request body
  let body: any;
  try {
    body = await request.json();
  } catch (error) {
    return errorResponse('Invalid JSON body', 'INVALID_JSON', null, 400);
  }

  // Route to appropriate handler
  try {
    switch (path) {
      case '/pi/create':
        return await handleCreatePI(env, body);

      case '/entities/query_children':
        return await handleQueryChildren(env, body);

      case '/entity/create':
        return await handleCreateEntity(env, body);

      case '/entity/merge':
        return await handleMergeEntity(env, body);

      case '/relationships/create':
        return await handleCreateRelationships(env, body);

      case '/':
      case '/health':
        return jsonResponse({
          status: 'healthy',
          service: 'GraphDB Gateway Worker',
          version: '1.0.0',
          endpoints: [
            'POST /pi/create',
            'POST /entities/query_children',
            'POST /entity/create',
            'POST /entity/merge',
            'POST /relationships/create',
          ],
        });

      default:
        return errorResponse('Endpoint not found', 'NOT_FOUND', { path }, 404);
    }
  } catch (error: any) {
    return errorResponse(
      'Internal server error',
      'INTERNAL_ERROR',
      { message: error.message, stack: error.stack }
    );
  }
}

/**
 * Cloudflare Worker entry point
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env);
  },
};
