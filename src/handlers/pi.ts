/**
 * Handlers for PI (Processed Item) operations
 *
 * PIs are now stored as Entity nodes with type='pi'.
 * This handler provides a convenience wrapper for creating PI entities
 * with parent-child hierarchy relationships.
 */

import { executeQuery } from '../neo4j';
import { errorResponse, jsonResponse } from '../utils/response';
import { ERROR_CODES } from '../constants';
import { Env, CreatePIRequest, SuccessResponse } from '../types';

/**
 * POST /pi/create
 * Create PI entity with parent-child relationships
 *
 * Creates Entity nodes with type='pi' and establishes PARENT_OF/CHILD_OF relationships.
 * Auto-creates parent and children PI entities if they don't exist.
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
      MERGE (p:Entity {canonical_id: $pi, type: 'pi'})
      ON CREATE SET
        p.code = 'pi_' + $pi,
        p.label = $pi,
        p.properties = '{}',
        p.created_by_pi = null,
        p.first_seen = datetime(),
        p.last_updated = datetime()
      ON MATCH SET
        p.last_updated = datetime()
    `;

    const params: Record<string, any> = { pi };

    // Add parent relationship if provided (auto-creates parent if needed)
    if (parent) {
      query += `
        WITH p
        MERGE (parent:Entity {canonical_id: $parent, type: 'pi'})
        ON CREATE SET
          parent.code = 'pi_' + $parent,
          parent.label = $parent,
          parent.properties = '{}',
          parent.created_by_pi = null,
          parent.first_seen = datetime(),
          parent.last_updated = datetime()
        MERGE (parent)-[:PARENT_OF]->(p)
        MERGE (p)-[:CHILD_OF]->(parent)
      `;
      params.parent = parent;
    }

    // Add children relationships if provided (auto-creates children if needed)
    if (children.length > 0) {
      query += `
        WITH p
        UNWIND $children AS childId
        MERGE (child:Entity {canonical_id: childId, type: 'pi'})
        ON CREATE SET
          child.code = 'pi_' + childId,
          child.label = childId,
          child.properties = '{}',
          child.created_by_pi = null,
          child.first_seen = datetime(),
          child.last_updated = datetime()
        MERGE (p)-[:PARENT_OF]->(child)
        MERGE (child)-[:CHILD_OF]->(p)
      `;
      params.children = children;
    }

    query += ` RETURN p`;

    const { summary } = await executeQuery(env, query, params);

    const response: SuccessResponse = {
      success: true,
      message: 'PI entity created successfully',
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
