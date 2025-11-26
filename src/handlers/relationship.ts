/**
 * Handlers for relationship operations
 */

import { executeQuery } from '../neo4j';
import { errorResponse, jsonResponse } from '../utils/response';
import { ERROR_CODES } from '../constants';
import {
  Env,
  CreateRelationshipsRequest,
  SuccessResponse,
  GetEntityRelationshipsResponse,
  EntityRelationshipDetail,
} from '../types';

/**
 * GET /relationships/:canonical_id
 * Get all relationships for a specific entity
 */
export async function handleGetEntityRelationships(
  env: Env,
  canonical_id: string
): Promise<Response> {
  try {
    if (!canonical_id) {
      return errorResponse(
        'Missing required parameter: canonical_id',
        ERROR_CODES.VALIDATION_ERROR,
        null,
        400
      );
    }

    const query = `
      MATCH (e:Entity {canonical_id: $canonical_id})
      OPTIONAL MATCH (e)-[r_out:RELATIONSHIP]->(target_out:Entity)
      OPTIONAL MATCH (source_in:Entity)-[r_in:RELATIONSHIP]->(e)
      WITH e,
           collect(DISTINCT {
             direction: 'outgoing',
             predicate: r_out.predicate,
             target_id: target_out.canonical_id,
             target_code: target_out.code,
             target_label: target_out.label,
             target_type: target_out.type,
             properties: r_out.properties,
             source_pi: r_out.source_pi,
             created_at: r_out.created_at
           }) as outgoing,
           collect(DISTINCT {
             direction: 'incoming',
             predicate: r_in.predicate,
             target_id: source_in.canonical_id,
             target_code: source_in.code,
             target_label: source_in.label,
             target_type: source_in.type,
             properties: r_in.properties,
             source_pi: r_in.source_pi,
             created_at: r_in.created_at
           }) as incoming
      RETURN e.canonical_id as canonical_id, outgoing, incoming
    `;

    const { records } = await executeQuery(env, query, { canonical_id });

    if (records.length === 0) {
      const response: GetEntityRelationshipsResponse = {
        found: false,
      };
      return jsonResponse(response);
    }

    const record = records[0];
    const outgoing = record.get('outgoing') || [];
    const incoming = record.get('incoming') || [];

    // Filter out null relationships (from OPTIONAL MATCH with no results)
    const relationships: EntityRelationshipDetail[] = [
      ...outgoing.filter((r: any) => r.predicate !== null),
      ...incoming.filter((r: any) => r.predicate !== null),
    ].map((r: any) => ({
      direction: r.direction,
      predicate: r.predicate,
      target_id: r.target_id,
      target_code: r.target_code,
      target_label: r.target_label,
      target_type: r.target_type,
      properties: r.properties ? JSON.parse(r.properties) : {},
      source_pi: r.source_pi,
      created_at: r.created_at?.toString(),
    }));

    const response: GetEntityRelationshipsResponse = {
      found: true,
      canonical_id: record.get('canonical_id'),
      relationships,
      total_count: relationships.length,
    };

    return jsonResponse(response);
  } catch (error: any) {
    return errorResponse(
      error.message || 'Failed to get entity relationships',
      error.code,
      { stack: error.stack }
    );
  }
}

/**
 * GET /relationships
 * List all relationships in the database
 */
export async function handleListRelationships(env: Env): Promise<Response> {
  try {
    const query = `
      MATCH (subject:Entity)-[rel:RELATIONSHIP]->(object:Entity)
      RETURN
        subject.canonical_id as subject_id,
        rel.predicate as predicate,
        object.canonical_id as object_id,
        rel.properties as properties,
        rel.source_pi as source_pi,
        rel.created_at as created_at
      ORDER BY rel.created_at DESC
    `;

    const { records } = await executeQuery(env, query);

    const relationships = records.map((record) => ({
      subject_id: record.get('subject_id'),
      predicate: record.get('predicate'),
      object_id: record.get('object_id'),
      properties: JSON.parse(record.get('properties') || '{}'),
      source_pi: record.get('source_pi'),
      created_at: record.get('created_at'),
    }));

    return jsonResponse({
      relationships,
      total_count: relationships.length,
    });
  } catch (error: any) {
    return errorResponse(
      error.message || 'Failed to list relationships',
      error.code,
      { stack: error.stack }
    );
  }
}

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

/**
 * POST /relationships/merge
 * Batch merge relationships between canonical entities (idempotent)
 * Uses MERGE to prevent duplicates and allow property updates
 */
export async function handleMergeRelationships(
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

    // Use MERGE to make this idempotent
    // Uniqueness key: (subject, predicate, object, source_pi)
    const query = `
      UNWIND $relationships AS rel
      MATCH (subject:Entity {canonical_id: rel.subject_id})
      MATCH (object:Entity {canonical_id: rel.object_id})
      MERGE (subject)-[r:RELATIONSHIP {
        predicate: rel.predicate,
        source_pi: rel.source_pi
      }]->(object)
      ON CREATE SET
        r.properties = rel.properties,
        r.created_at = datetime()
      ON MATCH SET
        r.properties = rel.properties,
        r.last_updated = datetime()
    `;

    const { summary } = await executeQuery(env, query, {
      relationships: relationshipsWithJsonProps,
    });

    const relationshipsCreated = summary.counters.updates().relationshipsCreated;
    const relationshipsUpdated = relationships.length - relationshipsCreated;

    const response: SuccessResponse = {
      success: true,
      message: 'Relationships merged successfully',
      data: {
        count: relationships.length,
        relationshipsCreated,
        relationshipsUpdated,
      },
    };

    return jsonResponse(response);
  } catch (error: any) {
    return errorResponse(
      error.message || 'Failed to merge relationships',
      error.code,
      { stack: error.stack }
    );
  }
}
