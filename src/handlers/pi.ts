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
