/**
 * Handlers for relationship operations
 */

import { executeQuery } from '../neo4j';
import { errorResponse, jsonResponse } from '../utils/response';
import { ERROR_CODES } from '../constants';
import { Env, CreateRelationshipsRequest, SuccessResponse } from '../types';

/**
 * POST /relationships/create
 * Batch create relationships between canonical entities
 */
export async function handleCreateRelationships(
  env: Env,
  body: CreateRelationshipsRequest
): Promise<Response> {
  try {
    const { relationships } = body;

    if (!relationships || !Array.isArray(relationships) || relationships.length === 0) {
      return errorResponse(
        'Missing or invalid field: relationships (must be non-empty array)',
        ERROR_CODES.VALIDATION_ERROR,
        null,
        400
      );
    }

    // Validate all relationships have required fields
    for (const rel of relationships) {
      if (!rel.subject_id || !rel.predicate || !rel.object_id || !rel.source_pi) {
        return errorResponse(
          'Each relationship must have: subject_id, predicate, object_id, source_pi',
          ERROR_CODES.VALIDATION_ERROR,
          null,
          400
        );
      }
    }

    // Serialize properties to JSON strings
    const relationshipsWithJsonProps = relationships.map((rel) => ({
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

    const { summary } = await executeQuery(env, query, {
      relationships: relationshipsWithJsonProps,
    });

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
