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
import {
  Env,
  CreatePIRequest,
  SuccessResponse,
  PIEntitiesWithRelationshipsRequest,
  PIEntitiesWithRelationshipsResponse,
  EntityWithRelationships,
  EntityRelationshipInline,
  PurgePIDataResponse,
} from '../types';

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

/**
 * POST /pi/entities-with-relationships
 * Get all entities extracted from a PI with their relationships in a single query
 *
 * This is an optimized endpoint that combines:
 * - POST /entities/list (get entities for PI)
 * - GET /relationships/:canonical_id (for each entity)
 *
 * Into a single Neo4j query for better performance.
 */
export async function handleGetPIEntitiesWithRelationships(
  env: Env,
  body: PIEntitiesWithRelationshipsRequest
): Promise<Response> {
  try {
    const { pi, type } = body;

    if (!pi) {
      return errorResponse(
        'Missing required field: pi',
        ERROR_CODES.VALIDATION_ERROR,
        null,
        400
      );
    }

    // Single query to get entities and their relationships
    const query = `
      MATCH (pi:Entity {type: 'pi', canonical_id: $pi})
      OPTIONAL MATCH (pi)<-[:EXTRACTED_FROM]-(e:Entity)
      WHERE e.type <> 'pi'
        AND ($type IS NULL OR e.type = $type)
      WITH e
      WHERE e IS NOT NULL

      // Get outgoing relationships
      OPTIONAL MATCH (e)-[r_out:RELATIONSHIP]->(target_out:Entity)

      // Get incoming relationships
      OPTIONAL MATCH (source_in:Entity)-[r_in:RELATIONSHIP]->(e)

      // Collect relationships
      WITH e,
           collect(DISTINCT CASE WHEN r_out IS NOT NULL THEN {
             direction: 'outgoing',
             predicate: r_out.predicate,
             target_id: target_out.canonical_id,
             target_code: target_out.code,
             target_label: target_out.label,
             target_type: target_out.type,
             properties: r_out.properties,
             source_pi: r_out.source_pi,
             created_at: toString(r_out.created_at)
           } END) as outgoing_rels,
           collect(DISTINCT CASE WHEN r_in IS NOT NULL THEN {
             direction: 'incoming',
             predicate: r_in.predicate,
             target_id: source_in.canonical_id,
             target_code: source_in.code,
             target_label: source_in.label,
             target_type: source_in.type,
             properties: r_in.properties,
             source_pi: r_in.source_pi,
             created_at: toString(r_in.created_at)
           } END) as incoming_rels

      // Get source PIs for the entity
      OPTIONAL MATCH (e)-[:EXTRACTED_FROM]->(src_pi:Entity {type: 'pi'})
      WITH e, outgoing_rels, incoming_rels, collect(DISTINCT src_pi.canonical_id) as source_pis

      RETURN
        e.canonical_id AS canonical_id,
        e.code AS code,
        e.label AS label,
        e.type AS type,
        e.properties AS properties,
        e.created_by_pi AS created_by_pi,
        source_pis,
        [r IN outgoing_rels WHERE r IS NOT NULL] + [r IN incoming_rels WHERE r IS NOT NULL] AS relationships
      ORDER BY e.type, e.label
    `;

    const { records } = await executeQuery(env, query, {
      pi,
      type: type || null,
    });

    const entities: EntityWithRelationships[] = records.map((record) => {
      // Parse properties JSON
      let properties: Record<string, any> = {};
      const propsStr = record.get('properties');
      if (propsStr) {
        try {
          properties = JSON.parse(propsStr);
        } catch {
          properties = {};
        }
      }

      // Parse relationship properties
      const relationships: EntityRelationshipInline[] = (record.get('relationships') || [])
        .map((rel: any) => {
          let relProps: Record<string, any> = {};
          if (rel.properties) {
            try {
              relProps = typeof rel.properties === 'string'
                ? JSON.parse(rel.properties)
                : rel.properties;
            } catch {
              relProps = {};
            }
          }

          return {
            direction: rel.direction,
            predicate: rel.predicate,
            target_id: rel.target_id,
            target_code: rel.target_code,
            target_label: rel.target_label,
            target_type: rel.target_type,
            properties: relProps,
            source_pi: rel.source_pi,
            created_at: rel.created_at,
          };
        });

      return {
        canonical_id: record.get('canonical_id'),
        code: record.get('code'),
        label: record.get('label'),
        type: record.get('type'),
        properties,
        created_by_pi: record.get('created_by_pi'),
        source_pis: record.get('source_pis') || [],
        relationships,
      };
    });

    const response: PIEntitiesWithRelationshipsResponse = {
      pi,
      entities,
      total_count: entities.length,
    };

    return jsonResponse(response);
  } catch (error: any) {
    return errorResponse(
      error.message || 'Failed to get PI entities with relationships',
      error.code,
      { stack: error.stack }
    );
  }
}

/**
 * POST /pi/:pi/purge
 * Remove all data contributed by a PI
 *
 * This endpoint performs a "clean slate" operation:
 * 1. Identifies entities that will be orphaned (only this PI as source)
 * 2. Identifies entities that have other sources (will be detached, not deleted)
 * 3. Deletes all RELATIONSHIP edges with source_pi = this PI
 * 4. Deletes all EXTRACTED_FROM relationships to this PI
 * 5. Deletes orphaned entities (entities with no remaining EXTRACTED_FROM)
 *
 * Returns the list of deleted entity IDs so the caller can clean up Pinecone.
 *
 * Note: This does NOT delete the PI entity itself, only its contributed data.
 * The PI can then be re-processed with new data.
 */
export async function handlePurgePIData(
  env: Env,
  pi: string
): Promise<Response> {
  try {
    if (!pi) {
      return errorResponse(
        'Missing required parameter: pi',
        ERROR_CODES.VALIDATION_ERROR,
        null,
        400
      );
    }

    // Step 1: Check if PI exists
    const piExistsQuery = `
      MATCH (pi:Entity {canonical_id: $pi, type: 'pi'})
      RETURN pi.canonical_id AS id
    `;
    const { records: piRecords } = await executeQuery(env, piExistsQuery, { pi });

    if (piRecords.length === 0) {
      // PI doesn't exist - nothing to purge
      const response: PurgePIDataResponse = {
        success: true,
        pi,
        purged: {
          entities_deleted: [],
          entities_detached: [],
          relationships_deleted: 0,
          extracted_from_deleted: 0,
        },
      };
      return jsonResponse(response);
    }

    // Step 2: Find entities that will be orphaned (only this PI as source)
    // These are entities where:
    // - They have EXTRACTED_FROM to this PI
    // - They have NO EXTRACTED_FROM to any other PI
    // - They are not PI entities themselves
    const findOrphanedQuery = `
      MATCH (e:Entity)-[:EXTRACTED_FROM]->(pi:Entity {canonical_id: $pi, type: 'pi'})
      WHERE e.type <> 'pi'
      WITH e
      OPTIONAL MATCH (e)-[:EXTRACTED_FROM]->(other:Entity {type: 'pi'})
      WHERE other.canonical_id <> $pi
      WITH e, count(other) as other_source_count
      WHERE other_source_count = 0
      RETURN collect(e.canonical_id) as orphaned_ids
    `;
    const { records: orphanedRecords } = await executeQuery(env, findOrphanedQuery, { pi });
    const orphanedIds: string[] = orphanedRecords[0]?.get('orphaned_ids') || [];

    // Step 3: Find entities that have other sources (will be detached, not deleted)
    const findDetachedQuery = `
      MATCH (e:Entity)-[:EXTRACTED_FROM]->(pi:Entity {canonical_id: $pi, type: 'pi'})
      WHERE e.type <> 'pi'
      WITH e
      MATCH (e)-[:EXTRACTED_FROM]->(other:Entity {type: 'pi'})
      WHERE other.canonical_id <> $pi
      RETURN collect(DISTINCT e.canonical_id) as detached_ids
    `;
    const { records: detachedRecords } = await executeQuery(env, findDetachedQuery, { pi });
    const detachedIds: string[] = detachedRecords[0]?.get('detached_ids') || [];

    // Step 4: Delete all RELATIONSHIP edges with source_pi = this PI
    // Use directed pattern to avoid double-counting
    const deleteRelationshipsQuery = `
      MATCH ()-[r:RELATIONSHIP {source_pi: $pi}]->()
      WITH count(r) as rel_count
      MATCH ()-[r:RELATIONSHIP {source_pi: $pi}]->()
      DELETE r
      RETURN rel_count
    `;
    const { records: relRecords } = await executeQuery(env, deleteRelationshipsQuery, { pi });
    const relationshipsDeleted = Number(relRecords[0]?.get('rel_count') || 0);

    // Step 5: Delete all EXTRACTED_FROM relationships to this PI
    const deleteExtractedFromQuery = `
      MATCH (e:Entity)-[ef:EXTRACTED_FROM]->(pi:Entity {canonical_id: $pi, type: 'pi'})
      WITH count(ef) as ef_count
      MATCH (e:Entity)-[ef:EXTRACTED_FROM]->(pi:Entity {canonical_id: $pi, type: 'pi'})
      DELETE ef
      RETURN ef_count
    `;
    const { records: efRecords } = await executeQuery(env, deleteExtractedFromQuery, { pi });
    const extractedFromDeleted = Number(efRecords[0]?.get('ef_count') || 0);

    // Step 6: Delete orphaned entities
    // Only delete entities that:
    // - Are in our orphaned list
    // - Have no remaining EXTRACTED_FROM relationships (double-check after step 5)
    if (orphanedIds.length > 0) {
      const deleteOrphanedQuery = `
        UNWIND $orphaned_ids as oid
        MATCH (e:Entity {canonical_id: oid})
        WHERE NOT EXISTS { (e)-[:EXTRACTED_FROM]->(:Entity {type: 'pi'}) }
        DETACH DELETE e
        RETURN count(*) as deleted_count
      `;
      await executeQuery(env, deleteOrphanedQuery, { orphaned_ids: orphanedIds });
    }

    const response: PurgePIDataResponse = {
      success: true,
      pi,
      purged: {
        entities_deleted: orphanedIds,
        entities_detached: detachedIds,
        relationships_deleted: relationshipsDeleted,
        extracted_from_deleted: extractedFromDeleted,
      },
    };

    return jsonResponse(response);
  } catch (error: any) {
    return errorResponse(
      error.message || 'Failed to purge PI data',
      error.code,
      { stack: error.stack }
    );
  }
}
