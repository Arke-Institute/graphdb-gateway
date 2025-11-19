/**
 * Handlers for Entity operations
 */

import { executeQuery } from '../neo4j';
import { errorResponse, jsonResponse } from '../utils/response';
import { isValidMergeStrategy } from '../utils/validation';
import { ERROR_CODES } from '../constants';
import {
  Env,
  CreateEntityRequest,
  MergeEntityRequest,
  MergeEntityResponse,
  PropertyConflict,
  QueryEntityRequest,
  QueryEntityResponse,
  EntityRelationship,
  ListEntitiesRequest,
  ListEntitiesResponse,
  EntityWithSource,
  SuccessResponse,
} from '../types';

/**
 * POST /entity/create
 * Create new canonical entity with EXTRACTED_FROM relationship
 *
 * Note: Properties should NOT contain entity_refs - orchestrator resolves these BEFORE calling this endpoint
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

    // Check if entity already exists
    const checkQuery = `
      MATCH (e:Entity {canonical_id: $canonical_id})
      RETURN e.canonical_id as canonical_id, e.code as code
    `;

    const { records: existingRecords } = await executeQuery(env, checkQuery, { canonical_id });

    if (existingRecords.length > 0) {
      return errorResponse(
        `Entity with canonical_id ${canonical_id} already exists. Use /entity/merge to update it.`,
        ERROR_CODES.ENTITY_ALREADY_EXISTS,
        {
          canonical_id,
          existing_code: existingRecords[0].get('code')
        },
        409
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
 * Merge entity with existing canonical entity using specified merge strategy
 */
export async function handleMergeEntity(
  env: Env,
  body: MergeEntityRequest
): Promise<Response> {
  try {
    const { canonical_id, enrichment_data, source_pi } = body;

    if (!canonical_id || !source_pi) {
      return errorResponse(
        'Missing required fields: canonical_id, source_pi',
        ERROR_CODES.VALIDATION_ERROR,
        null,
        400
      );
    }

    if (!enrichment_data) {
      return errorResponse(
        'Missing required field: enrichment_data',
        ERROR_CODES.VALIDATION_ERROR,
        null,
        400
      );
    }

    const { type, label, new_properties, merge_strategy } = enrichment_data;

    if (!merge_strategy || !isValidMergeStrategy(merge_strategy)) {
      return errorResponse(
        `Invalid merge_strategy. Must be one of: enrich_placeholder, merge_peers, link_only, prefer_new`,
        ERROR_CODES.INVALID_MERGE_STRATEGY,
        { provided: merge_strategy },
        400
      );
    }

    // Route to appropriate merge strategy handler
    switch (merge_strategy) {
      case 'enrich_placeholder':
        return await handleEnrichPlaceholder(env, canonical_id, type, label, new_properties, source_pi);

      case 'merge_peers':
        return await handleMergePeers(env, canonical_id, new_properties, source_pi);

      case 'link_only':
        return await handleLinkOnly(env, canonical_id, source_pi);

      case 'prefer_new':
        return await handlePreferNew(env, canonical_id, type, label, new_properties, source_pi);

      default:
        return errorResponse(
          'Unknown merge strategy',
          ERROR_CODES.INVALID_MERGE_STRATEGY,
          { strategy: merge_strategy },
          400
        );
    }
  } catch (error: any) {
    return errorResponse(
      error.message || 'Failed to merge entity',
      error.code,
      { stack: error.stack }
    );
  }
}

/**
 * Merge Strategy: enrich_placeholder
 * Upgrade a placeholder entity to a rich entity
 */
async function handleEnrichPlaceholder(
  env: Env,
  canonical_id: string,
  type: string | undefined,
  label: string | undefined,
  new_properties: Record<string, any>,
  source_pi: string
): Promise<Response> {
  const query = `
    MATCH (e:Entity {canonical_id: $canonical_id})
    WHERE e.type = 'unknown'
    SET e.type = $new_type,
        e.label = COALESCE($new_label, e.label),
        e.properties = $new_properties,
        e.last_updated = datetime()
    MERGE (pi:PI {id: $source_pi})
    MERGE (e)-[:EXTRACTED_FROM {
      original_code: e.code,
      extracted_at: datetime()
    }]->(pi)
    RETURN e
  `;

  const { records } = await executeQuery(env, query, {
    canonical_id,
    new_type: type || 'unknown',
    new_label: label || null,
    new_properties: JSON.stringify(new_properties || {}),
    source_pi,
  });

  if (records.length === 0) {
    return errorResponse(
      `Entity ${canonical_id} not found or is not a placeholder (type must be "unknown")`,
      ERROR_CODES.NOT_A_PLACEHOLDER,
      { canonical_id },
      400
    );
  }

  const response: MergeEntityResponse = {
    canonical_id,
    updated: true,
  };

  return jsonResponse(response);
}

/**
 * Merge Strategy: merge_peers
 * Merge two rich entities with conflict resolution
 */
async function handleMergePeers(
  env: Env,
  canonical_id: string,
  new_properties: Record<string, any>,
  source_pi: string
): Promise<Response> {
  // First, fetch existing entity properties
  const fetchQuery = `
    MATCH (e:Entity {canonical_id: $canonical_id})
    RETURN e.properties AS properties
  `;

  const { records: fetchRecords } = await executeQuery(env, fetchQuery, { canonical_id });

  if (fetchRecords.length === 0) {
    return errorResponse(
      `Entity ${canonical_id} not found`,
      ERROR_CODES.ENTITY_NOT_FOUND,
      { canonical_id },
      404
    );
  }

  const existingPropsJson = fetchRecords[0].get('properties');
  const existingProps = existingPropsJson ? JSON.parse(existingPropsJson) : {};

  // Merge properties with conflict detection
  const mergedProps = { ...existingProps };
  const conflicts: PropertyConflict[] = [];

  for (const [key, newValue] of Object.entries(new_properties)) {
    if (key in existingProps) {
      const existingValue = existingProps[key];

      // Check if values are different
      if (JSON.stringify(existingValue) !== JSON.stringify(newValue)) {
        // Accumulate into array
        if (Array.isArray(existingValue)) {
          mergedProps[key] = [...existingValue, newValue];
        } else {
          mergedProps[key] = [existingValue, newValue];
        }

        conflicts.push({
          property: key,
          existing_value: existingValue,
          new_value: newValue,
          resolution: 'accumulated',
        });
      }
      // If same, keep existing (no change needed)
    } else {
      // New property, just add it
      mergedProps[key] = newValue;
    }
  }

  // Update entity with merged properties
  const updateQuery = `
    MATCH (e:Entity {canonical_id: $canonical_id})
    SET e.properties = $merged_properties,
        e.last_updated = datetime()
    MERGE (pi:PI {id: $source_pi})
    MERGE (e)-[:EXTRACTED_FROM {
      original_code: e.code,
      extracted_at: datetime()
    }]->(pi)
    RETURN e
  `;

  await executeQuery(env, updateQuery, {
    canonical_id,
    merged_properties: JSON.stringify(mergedProps),
    source_pi,
  });

  const response: MergeEntityResponse = {
    canonical_id,
    updated: true,
    conflicts: conflicts.length > 0 ? conflicts : undefined,
  };

  return jsonResponse(response);
}

/**
 * Merge Strategy: link_only
 * Just link a PI to existing entity (no data changes)
 */
async function handleLinkOnly(
  env: Env,
  canonical_id: string,
  source_pi: string
): Promise<Response> {
  const query = `
    MATCH (e:Entity {canonical_id: $canonical_id})
    MERGE (pi:PI {id: $source_pi})
    MERGE (e)-[:EXTRACTED_FROM {
      original_code: e.code,
      extracted_at: datetime()
    }]->(pi)
    SET e.last_updated = datetime()
    RETURN e
  `;

  const { records } = await executeQuery(env, query, { canonical_id, source_pi });

  if (records.length === 0) {
    return errorResponse(
      `Entity ${canonical_id} not found`,
      ERROR_CODES.ENTITY_NOT_FOUND,
      { canonical_id },
      404
    );
  }

  const response: MergeEntityResponse = {
    canonical_id,
    updated: true,
  };

  return jsonResponse(response);
}

/**
 * Merge Strategy: prefer_new
 * Overwrite existing data with new data
 */
async function handlePreferNew(
  env: Env,
  canonical_id: string,
  type: string | undefined,
  label: string | undefined,
  new_properties: Record<string, any>,
  source_pi: string
): Promise<Response> {
  const query = `
    MATCH (e:Entity {canonical_id: $canonical_id})
    SET e.type = COALESCE($new_type, e.type),
        e.label = COALESCE($new_label, e.label),
        e.properties = $new_properties,
        e.last_updated = datetime()
    MERGE (pi:PI {id: $source_pi})
    MERGE (e)-[:EXTRACTED_FROM {
      original_code: e.code,
      extracted_at: datetime()
    }]->(pi)
    RETURN e
  `;

  const { records } = await executeQuery(env, query, {
    canonical_id,
    new_type: type || null,
    new_label: label || null,
    new_properties: JSON.stringify(new_properties || {}),
    source_pi,
  });

  if (records.length === 0) {
    return errorResponse(
      `Entity ${canonical_id} not found`,
      ERROR_CODES.ENTITY_NOT_FOUND,
      { canonical_id },
      404
    );
  }

  const response: MergeEntityResponse = {
    canonical_id,
    updated: true,
  };

  return jsonResponse(response);
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

    // Query for entity and its relationships
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
             source_pis,
             outgoing_rels + incoming_rels AS relationships
    `;

    const { records } = await executeQuery(env, query, { code });

    if (records.length === 0) {
      const response: QueryEntityResponse = {
        found: false,
      };
      return jsonResponse(response);
    }

    const record = records[0];
    const relationships: EntityRelationship[] = record
      .get('relationships')
      .filter((rel: any) => rel.type !== null) // Filter out null relationships
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

    // Validate: must provide either pi or pis
    if (!pi && (!pis || pis.length === 0)) {
      return errorResponse(
        'Must provide either "pi" (string) or "pis" (array of strings)',
        ERROR_CODES.VALIDATION_ERROR,
        null,
        400
      );
    }

    // Normalize to array
    const piArray = pi ? [pi] : pis!;

    // Build Cypher query with optional type filter
    // This query deduplicates entities by canonical_id and collects all source PIs
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
