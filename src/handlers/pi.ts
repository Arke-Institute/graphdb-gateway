/**
 * Handlers for PI (Processed Item) operations
 */

import { executeQuery } from '../neo4j';
import { errorResponse, jsonResponse } from '../utils/response';
import { ERROR_CODES } from '../constants';
import { Env, CreatePIRequest, SuccessResponse } from '../types';

/**
 * POST /pi/create
 * Create PI node with parent-child relationships
 */
export async function handleCreatePI(
  env: Env,
  body: CreatePIRequest
): Promise<Response> {
  try {
    const { pi, parent, children = [] } = body;

    if (!pi) {
      return errorResponse(
        'Missing required field: pi',
        ERROR_CODES.VALIDATION_ERROR,
        null,
        400
      );
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
