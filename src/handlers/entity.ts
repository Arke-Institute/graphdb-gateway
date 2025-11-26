/**
 * Handlers for Entity operations
 */

import { executeQuery } from '../neo4j';
import { errorResponse, jsonResponse } from '../utils/response';
import { ERROR_CODES } from '../constants';
import {
  Env,
  CreateEntityRequest,
  AtomicMergeRequest,
  AtomicMergeResponse,
  QueryEntityRequest,
  QueryEntityResponse,
  EntityRelationship,
  ListEntitiesRequest,
  ListEntitiesResponse,
  EntityWithSource,
  SuccessResponse,
  DeleteEntityResponse,
  GetEntityResponse,
  EntityExistsResponse,
} from '../types';

/**
 * POST /entity/create
 * Create new canonical entity with EXTRACTED_FROM relationship
 */
export async function handleCreateEntity(
  env: Env,
  body: CreateEntityRequest
): Promise<Response> {
  try {
    const { canonical_id, code, label, type, properties, source_pi } = body;

    if (!canonical_id || !code || !label || !type || !source_pi) {
      return errorResponse(
        'Missing required fields: canonical_id, code, label, type, source_pi',
        ERROR_CODES.VALIDATION_ERROR,
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

    // Use MERGE on canonical_id to make this atomic and idempotent
    const query = `
      MATCH (pi:PI {id: $source_pi})
      MERGE (e:${entityLabel} {canonical_id: $canonical_id})
      ON CREATE SET
        e.code = $code,
        e.label = $label,
        e.type = $type,
        e.properties = $properties,
        e.created_by_pi = $source_pi,
        e.first_seen = datetime(),
        e.last_updated = datetime()
      ON MATCH SET
        e.last_updated = datetime()
      WITH e, pi
      MERGE (e)-[rel:EXTRACTED_FROM]->(pi)
      ON CREATE SET
        rel.original_code = $code,
        rel.extracted_at = datetime()
      RETURN e,
             CASE WHEN e.first_seen = e.last_updated THEN true ELSE false END as was_created
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
 * Atomic merge: absorb source entity into target entity
 * - Transfers all relationships from source to target
 * - Merges properties (combines into arrays for conflicts)
 * - Deletes source entity
 *
 * Uses APOC refactor.mergeNodes for atomic relationship transfer.
 * The entire operation is a single Neo4j transaction - either completes fully or rolls back.
 */
export async function handleMergeEntity(
  env: Env,
  body: AtomicMergeRequest
): Promise<Response> {
  try {
    const { source_id, target_id } = body;

    if (!source_id || !target_id) {
      return errorResponse(
        'Missing required fields: source_id, target_id',
        ERROR_CODES.VALIDATION_ERROR,
        null,
        400
      );
    }

    if (source_id === target_id) {
      return errorResponse(
        'source_id and target_id cannot be the same',
        ERROR_CODES.VALIDATION_ERROR,
        null,
        400
      );
    }

    // First, check existence of both entities to provide proper error messages
    // (APOC mergeNodes doesn't give granular errors)
    const checkQuery = `
      OPTIONAL MATCH (source:Entity {canonical_id: $source_id})
      OPTIONAL MATCH (target:Entity {canonical_id: $target_id})
      RETURN source IS NOT NULL AS source_exists,
             target IS NOT NULL AS target_exists
    `;

    const { records: checkRecords } = await executeQuery(env, checkQuery, {
      source_id,
      target_id,
    });

    const sourceExists = checkRecords[0]?.get('source_exists');
    const targetExists = checkRecords[0]?.get('target_exists');

    if (!targetExists) {
      return errorResponse(
        'Target entity does not exist',
        'target_not_found',
        { target_id },
        404
      );
    }

    if (!sourceExists) {
      return errorResponse(
        'Source entity does not exist (may have been merged already)',
        'source_not_found',
        { source_id },
        404
      );
    }

    // Atomic merge using APOC refactor.mergeNodes
    // This transfers all relationships and merges properties in a single transaction
    const mergeQuery = `
      MATCH (source:Entity {canonical_id: $source_id})
      MATCH (target:Entity {canonical_id: $target_id})

      // Count relationships before merge for response
      OPTIONAL MATCH (source)-[r]-()
      WITH source, target, count(DISTINCT r) AS rel_count

      // Get source's EXTRACTED_FROM PIs before merge
      OPTIONAL MATCH (source)-[:EXTRACTED_FROM]->(pi:PI)
      WITH source, target, rel_count, collect(DISTINCT pi.id) AS source_pis

      // Count source properties and merge them into target's properties
      WITH source, target, rel_count, source_pis,
           apoc.convert.fromJsonMap(coalesce(source.properties, '{}')) AS source_props,
           apoc.convert.fromJsonMap(coalesce(target.properties, '{}')) AS target_props

      WITH source, target, rel_count, source_pis,
           size(keys(source_props)) AS props_count,
           // Merge properties: combine maps, target wins on conflicts
           apoc.map.merge(source_props, target_props) AS merged_props

      // Store target identity properties before merge (APOC would overwrite them)
      WITH source, target, rel_count, source_pis, props_count, merged_props,
           target.canonical_id AS target_canonical_id,
           target.code AS target_code,
           target.label AS target_label,
           target.type AS target_type,
           target.created_by_pi AS target_created_by_pi,
           target.first_seen AS target_first_seen

      // Use APOC to merge nodes - transfers all relationships
      // First node (target) is kept, second node (source) is deleted
      // Use 'discard' for properties since we handle them manually
      CALL apoc.refactor.mergeNodes([target, source], {
        properties: 'discard',
        mergeRels: true
      })
      YIELD node

      // Restore target's identity properties and set merged properties
      SET node.canonical_id = target_canonical_id,
          node.code = target_code,
          node.label = target_label,
          node.type = target_type,
          node.created_by_pi = target_created_by_pi,
          node.first_seen = target_first_seen,
          node.last_updated = datetime(),
          node.properties = apoc.convert.toJson(merged_props)

      RETURN target_canonical_id AS target_id,
             rel_count AS relationships_transferred,
             props_count AS properties_transferred,
             source_pis
    `;

    const { records } = await executeQuery(env, mergeQuery, {
      source_id,
      target_id,
    });

    if (records.length === 0) {
      // This shouldn't happen if the checks passed, but handle gracefully
      return errorResponse(
        'Merge failed unexpectedly',
        'MERGE_FAILED',
        { source_id, target_id },
        500
      );
    }

    const record = records[0];
    const response: AtomicMergeResponse = {
      success: true,
      target_id: record.get('target_id'),
      merged: {
        properties_transferred: record.get('properties_transferred') || 0,
        relationships_transferred: record.get('relationships_transferred') || 0,
        source_pis_added: record.get('source_pis') || [],
      },
    };

    return jsonResponse(response);
  } catch (error: any) {
    // Handle Neo4j deadlock errors
    if (error.code === 'Neo.TransientError.Transaction.DeadlockDetected') {
      return errorResponse(
        'Concurrent merge collision - please retry',
        'deadlock',
        { message: error.message },
        409
      );
    }

    return errorResponse(
      error.message || 'Failed to merge entity',
      error.code,
      { stack: error.stack }
    );
  }
}

/**
 * GET /entity/exists/:canonical_id
 * Quick existence check without fetching full entity
 */
export async function handleEntityExists(
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
      RETURN count(e) > 0 as exists
    `;

    const { records } = await executeQuery(env, query, { canonical_id });

    const exists = records.length > 0 && records[0].get('exists');

    const response: EntityExistsResponse = { exists };
    return jsonResponse(response);
  } catch (error: any) {
    return errorResponse(
      error.message || 'Failed to check entity existence',
      error.code,
      { stack: error.stack }
    );
  }
}

/**
 * POST /entity/query
 * Query entity by code and return all its relationships
 */
export async function handleQueryEntity(
  env: Env,
  body: QueryEntityRequest
): Promise<Response> {
  try {
    const { code } = body;

    if (!code) {
      return errorResponse(
        'Missing required field: code',
        ERROR_CODES.VALIDATION_ERROR,
        null,
        400
      );
    }

    const query = `
      MATCH (e:Entity {code: $code})
      OPTIONAL MATCH (e)-[r_out]->(target_out:Entity)
      OPTIONAL MATCH (source_in:Entity)-[r_in]->(e)
      OPTIONAL MATCH (e)-[:EXTRACTED_FROM]->(pi:PI)

      WITH e,
           collect(DISTINCT pi.id) as source_pis,
           collect(DISTINCT {
             type: type(r_out),
             direction: 'outgoing',
             target_code: target_out.code,
             target_label: target_out.label,
             target_type: target_out.type,
             target_canonical_id: target_out.canonical_id,
             properties: properties(r_out)
           }) as outgoing_rels,
           collect(DISTINCT {
             type: type(r_in),
             direction: 'incoming',
             target_code: source_in.code,
             target_label: source_in.label,
             target_type: source_in.type,
             target_canonical_id: source_in.canonical_id,
             properties: properties(r_in)
           }) as incoming_rels

      RETURN e.canonical_id AS canonical_id,
             e.code AS code,
             e.label AS label,
             e.type AS type,
             e.properties AS properties,
             e.created_by_pi AS created_by_pi,
             source_pis,
             outgoing_rels + incoming_rels AS relationships
    `;

    const { records } = await executeQuery(env, query, { code });

    if (records.length === 0) {
      const response: QueryEntityResponse = { found: false };
      return jsonResponse(response);
    }

    const record = records[0];
    const relationships: EntityRelationship[] = record
      .get('relationships')
      .filter((rel: any) => rel.type !== null)
      .map((rel: any) => ({
        type: rel.type,
        direction: rel.direction,
        target_code: rel.target_code,
        target_label: rel.target_label,
        target_type: rel.target_type,
        target_canonical_id: rel.target_canonical_id,
        properties: rel.properties || {},
      }));

    const response: QueryEntityResponse = {
      found: true,
      entity: {
        canonical_id: record.get('canonical_id'),
        code: record.get('code'),
        label: record.get('label'),
        type: record.get('type'),
        properties: record.get('properties')
          ? JSON.parse(record.get('properties'))
          : {},
        created_by_pi: record.get('created_by_pi'),
        source_pis: record.get('source_pis'),
      },
      relationships,
    };

    return jsonResponse(response);
  } catch (error: any) {
    return errorResponse(
      error.message || 'Failed to query entity',
      error.code,
      { stack: error.stack }
    );
  }
}

/**
 * POST /entities/list
 * List all entities from specified PI(s) with deduplication
 */
export async function handleListEntities(
  env: Env,
  body: ListEntitiesRequest
): Promise<Response> {
  try {
    const { pi, pis, type } = body;

    if (!pi && (!pis || pis.length === 0)) {
      return errorResponse(
        'Must provide either "pi" (string) or "pis" (array of strings)',
        ERROR_CODES.VALIDATION_ERROR,
        null,
        400
      );
    }

    const piArray = pi ? [pi] : pis!;

    const query = `
      MATCH (pi:PI)<-[:EXTRACTED_FROM]-(e:Entity)
      WHERE pi.id IN $pis
        AND ($type IS NULL OR e.type = $type)
      WITH e, collect(DISTINCT pi.id) AS source_pis
      RETURN DISTINCT
        e.canonical_id AS canonical_id,
        e.code AS code,
        e.label AS label,
        e.type AS type,
        e.properties AS properties,
        e.created_by_pi AS created_by_pi,
        source_pis
      ORDER BY e.type, e.label
    `;

    const { records } = await executeQuery(env, query, {
      pis: piArray,
      type: type || null,
    });

    const entities: EntityWithSource[] = records.map((record) => ({
      canonical_id: record.get('canonical_id'),
      code: record.get('code'),
      label: record.get('label'),
      type: record.get('type'),
      properties: record.get('properties')
        ? JSON.parse(record.get('properties'))
        : {},
      created_by_pi: record.get('created_by_pi'),
      source_pis: record.get('source_pis'),
    }));

    const response: ListEntitiesResponse = {
      entities,
      total_count: entities.length,
    };

    return jsonResponse(response);
  } catch (error: any) {
    return errorResponse(
      error.message || 'Failed to list entities',
      error.code,
      { stack: error.stack }
    );
  }
}

/**
 * DELETE /entity/:canonical_id
 * Delete an entity and all its relationships (cascade delete)
 */
export async function handleDeleteEntity(
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
      OPTIONAL MATCH (e)-[r]-()
      WITH e, count(DISTINCT r) as rel_count
      DETACH DELETE e
      RETURN rel_count
    `;

    const { records } = await executeQuery(env, query, { canonical_id });

    if (records.length === 0) {
      return errorResponse(
        'Entity not found',
        ERROR_CODES.ENTITY_NOT_FOUND,
        { canonical_id },
        404
      );
    }

    const relationshipCount = Number(records[0].get('rel_count') || 0);

    const response: DeleteEntityResponse = {
      success: true,
      canonical_id,
      deleted: true,
      relationship_count: relationshipCount,
    };

    return jsonResponse(response);
  } catch (error: any) {
    return errorResponse(
      error.message || 'Failed to delete entity',
      error.code,
      { stack: error.stack }
    );
  }
}

/**
 * GET /entity/:canonical_id
 * Get entity by canonical_id
 */
export async function handleGetEntity(
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
      OPTIONAL MATCH (e)-[:EXTRACTED_FROM]->(pi:PI)
      WITH e, collect(DISTINCT pi.id) as source_pis
      RETURN e.canonical_id AS canonical_id,
             e.code AS code,
             e.label AS label,
             e.type AS type,
             e.properties AS properties,
             e.created_by_pi AS created_by_pi,
             source_pis
    `;

    const { records } = await executeQuery(env, query, { canonical_id });

    if (records.length === 0) {
      const response: GetEntityResponse = { found: false };
      return jsonResponse(response);
    }

    const record = records[0];
    const response: GetEntityResponse = {
      found: true,
      entity: {
        canonical_id: record.get('canonical_id'),
        code: record.get('code'),
        label: record.get('label'),
        type: record.get('type'),
        properties: record.get('properties')
          ? JSON.parse(record.get('properties'))
          : {},
        created_by_pi: record.get('created_by_pi'),
        source_pis: record.get('source_pis'),
      },
    };

    return jsonResponse(response);
  } catch (error: any) {
    return errorResponse(
      error.message || 'Failed to get entity',
      error.code,
      { stack: error.stack }
    );
  }
}
