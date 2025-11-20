/**
 * Handlers for hierarchy operations (parent/child PI traversal)
 */

import { executeQuery } from '../neo4j';
import { errorResponse, jsonResponse } from '../utils/response';
import { isPlaceholder } from '../utils/validation';
import { ERROR_CODES } from '../constants';
import {
  Env,
  FindInHierarchyRequest,
  FindInHierarchyResponse,
  GetEntitiesFromHierarchyRequest,
  GetEntitiesFromHierarchyResponse,
  HierarchyEntity,
} from '../types';

/**
 * POST /entity/find-in-hierarchy
 * Find an entity by code in parent or child PIs
 */
export async function handleFindInHierarchy(
  env: Env,
  body: FindInHierarchyRequest
): Promise<Response> {
  try {
    const { pi, code, search_scope, include_placeholder = true } = body;

    if (!pi || !code || !search_scope) {
      return errorResponse(
        'Missing required fields: pi, code, search_scope',
        ERROR_CODES.VALIDATION_ERROR,
        null,
        400
      );
    }

    if (!['parents', 'children', 'both'].includes(search_scope)) {
      return errorResponse(
        'search_scope must be one of: parents, children, both',
        ERROR_CODES.VALIDATION_ERROR,
        { provided: search_scope },
        400
      );
    }

    let query = '';
    let foundIn: 'parent' | 'child' | undefined;

    // Try children first if searching children or both
    if (search_scope === 'children' || search_scope === 'both') {
      const childQuery = `
        MATCH (current:PI {id: $pi})<-[:CHILD_OF]-(descendant:PI)
        MATCH (descendant)<-[:EXTRACTED_FROM]-(entity:Entity {code: $code})
        ${include_placeholder ? '' : 'WHERE entity.type <> "unknown"'}
        OPTIONAL MATCH (entity)-[:EXTRACTED_FROM]->(source_pi:PI)
        WITH entity, collect(DISTINCT source_pi.id) AS source_pis
        RETURN entity.canonical_id AS canonical_id,
               entity.code AS code,
               entity.label AS label,
               entity.type AS type,
               entity.properties AS properties,
               entity.created_by_pi AS created_by_pi,
               source_pis
        LIMIT 1
      `;

      const { records: childRecords } = await executeQuery(env, childQuery, {
        pi,
        code,
      });

      if (childRecords.length > 0) {
        const record = childRecords[0];
        const properties = record.get('properties')
          ? JSON.parse(record.get('properties'))
          : {};

        const entity = {
          canonical_id: record.get('canonical_id'),
          code: record.get('code'),
          label: record.get('label'),
          type: record.get('type'),
          properties,
          created_by_pi: record.get('created_by_pi'),
          source_pis: record.get('source_pis'),
          is_placeholder: isPlaceholder({
            type: record.get('type'),
            properties,
          }),
        };

        const response: FindInHierarchyResponse = {
          found: true,
          entity,
          found_in: 'child',
        };

        return jsonResponse(response);
      }
    }

    // Try parents if searching parents or both (and not found in children)
    if (search_scope === 'parents' || search_scope === 'both') {
      const parentQuery = `
        MATCH (current:PI {id: $pi})-[:CHILD_OF]->(ancestor:PI)
        MATCH (ancestor)<-[:EXTRACTED_FROM]-(entity:Entity {code: $code})
        ${include_placeholder ? '' : 'WHERE entity.type <> "unknown"'}
        OPTIONAL MATCH (entity)-[:EXTRACTED_FROM]->(source_pi:PI)
        WITH entity, collect(DISTINCT source_pi.id) AS source_pis
        RETURN entity.canonical_id AS canonical_id,
               entity.code AS code,
               entity.label AS label,
               entity.type AS type,
               entity.properties AS properties,
               entity.created_by_pi AS created_by_pi,
               source_pis
        LIMIT 1
      `;

      const { records: parentRecords } = await executeQuery(env, parentQuery, {
        pi,
        code,
      });

      if (parentRecords.length > 0) {
        const record = parentRecords[0];
        const properties = record.get('properties')
          ? JSON.parse(record.get('properties'))
          : {};

        const entity = {
          canonical_id: record.get('canonical_id'),
          code: record.get('code'),
          label: record.get('label'),
          type: record.get('type'),
          properties,
          created_by_pi: record.get('created_by_pi'),
          source_pis: record.get('source_pis'),
          is_placeholder: isPlaceholder({
            type: record.get('type'),
            properties,
          }),
        };

        const response: FindInHierarchyResponse = {
          found: true,
          entity,
          found_in: 'parent',
        };

        return jsonResponse(response);
      }
    }

    // Not found
    const response: FindInHierarchyResponse = {
      found: false,
    };

    return jsonResponse(response);
  } catch (error: any) {
    return errorResponse(
      error.message || 'Failed to find entity in hierarchy',
      error.code,
      { stack: error.stack }
    );
  }
}

/**
 * POST /entities/hierarchy
 * Bulk fetch all entities from parent/child PIs (for indexing in SETUP phase)
 */
export async function handleGetEntitiesHierarchy(
  env: Env,
  body: GetEntitiesFromHierarchyRequest
): Promise<Response> {
  try {
    const {
      pi,
      direction,
      exclude_type = [],
      include_placeholders = true,
    } = body;

    if (!pi || !direction) {
      return errorResponse(
        'Missing required fields: pi, direction',
        ERROR_CODES.VALIDATION_ERROR,
        null,
        400
      );
    }

    if (!['ancestors', 'descendants', 'both'].includes(direction)) {
      return errorResponse(
        'direction must be one of: ancestors, descendants, both',
        ERROR_CODES.VALIDATION_ERROR,
        { provided: direction },
        400
      );
    }

    const entitiesFromParents: HierarchyEntity[] = [];
    const entitiesFromChildren: HierarchyEntity[] = [];

    // Helper to build WHERE clause
    const buildWhereClause = () => {
      const conditions: string[] = [];
      if (exclude_type.length > 0) {
        conditions.push('NOT entity.type IN $exclude_types');
      }
      if (!include_placeholders) {
        conditions.push('entity.type <> "unknown"');
      }
      return conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    };

    // Fetch from ancestors (parents)
    if (direction === 'ancestors' || direction === 'both') {
      const ancestorQuery = `
        MATCH (current:PI {id: $pi})-[:CHILD_OF*]->(ancestor:PI)
        MATCH (ancestor)<-[:EXTRACTED_FROM]-(entity:Entity)
        ${buildWhereClause()}
        OPTIONAL MATCH (entity)-[:EXTRACTED_FROM]->(all_source:PI)
        WITH entity,
             ancestor,
             collect(DISTINCT all_source.id) AS all_source_pis
        RETURN DISTINCT
          entity.canonical_id AS canonical_id,
          entity.code AS code,
          entity.label AS label,
          entity.type AS type,
          entity.properties AS properties,
          entity.created_by_pi AS created_by_pi,
          ancestor.id AS source_pi,
          all_source_pis
      `;

      const { records: ancestorRecords } = await executeQuery(
        env,
        ancestorQuery,
        {
          pi,
          exclude_types: exclude_type,
        }
      );

      for (const record of ancestorRecords) {
        const properties = record.get('properties')
          ? JSON.parse(record.get('properties'))
          : {};

        entitiesFromParents.push({
          canonical_id: record.get('canonical_id'),
          code: record.get('code'),
          label: record.get('label'),
          type: record.get('type'),
          properties,
          created_by_pi: record.get('created_by_pi'),
          source_pi: record.get('source_pi'),
          all_source_pis: record.get('all_source_pis'),
          is_placeholder: isPlaceholder({
            type: record.get('type'),
            properties,
          }),
        });
      }
    }

    // Fetch from descendants (children)
    if (direction === 'descendants' || direction === 'both') {
      const descendantQuery = `
        MATCH (current:PI {id: $pi})<-[:CHILD_OF*]-(descendant:PI)
        MATCH (descendant)<-[:EXTRACTED_FROM]-(entity:Entity)
        ${buildWhereClause()}
        OPTIONAL MATCH (entity)-[:EXTRACTED_FROM]->(all_source:PI)
        WITH entity,
             descendant,
             collect(DISTINCT all_source.id) AS all_source_pis
        RETURN DISTINCT
          entity.canonical_id AS canonical_id,
          entity.code AS code,
          entity.label AS label,
          entity.type AS type,
          entity.properties AS properties,
          entity.created_by_pi AS created_by_pi,
          descendant.id AS source_pi,
          all_source_pis
      `;

      const { records: descendantRecords } = await executeQuery(
        env,
        descendantQuery,
        {
          pi,
          exclude_types: exclude_type,
        }
      );

      for (const record of descendantRecords) {
        const properties = record.get('properties')
          ? JSON.parse(record.get('properties'))
          : {};

        entitiesFromChildren.push({
          canonical_id: record.get('canonical_id'),
          code: record.get('code'),
          label: record.get('label'),
          type: record.get('type'),
          properties,
          created_by_pi: record.get('created_by_pi'),
          source_pi: record.get('source_pi'),
          all_source_pis: record.get('all_source_pis'),
          is_placeholder: isPlaceholder({
            type: record.get('type'),
            properties,
          }),
        });
      }
    }

    // Combine and deduplicate by canonical_id
    const allEntities = [...entitiesFromParents, ...entitiesFromChildren];
    const deduplicatedMap = new Map<string, HierarchyEntity>();

    for (const entity of allEntities) {
      if (!deduplicatedMap.has(entity.canonical_id)) {
        deduplicatedMap.set(entity.canonical_id, entity);
      }
    }

    const entities = Array.from(deduplicatedMap.values());

    const response: GetEntitiesFromHierarchyResponse = {
      entities,
      total_count: entities.length,
      from_parents: entitiesFromParents.length,
      from_children: entitiesFromChildren.length,
    };

    return jsonResponse(response);
  } catch (error: any) {
    return errorResponse(
      error.message || 'Failed to get entities from hierarchy',
      error.code,
      { stack: error.stack }
    );
  }
}
