/**
 * Handlers for path-finding operations
 *
 * These endpoints enable efficient graph traversal by leveraging Neo4j's
 * native path-finding capabilities instead of doing BFS across service boundaries.
 */

import neo4j from 'neo4j-driver';
import { executeQueryWithTimeout } from '../neo4j';
import { errorResponse, jsonResponse } from '../utils/response';
import { ERROR_CODES } from '../constants';
import {
  Env,
  PathsBetweenRequest,
  PathsBetweenResponse,
  PathsReachableRequest,
  PathsReachableResponse,
  PathResult,
  ReachableResult,
  PathEdge,
} from '../types';

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 1000;
// Max depth of 4 keeps worst-case query time under 5 seconds
// Depth 5+ causes exponential graph traversal that can take 40+ seconds
const MAX_DEPTH = 4;
// Query timeout to prevent runaway queries in highly connected graph regions
const QUERY_TIMEOUT_MS = 5000;

/**
 * Helper to convert Neo4j Integer to JS number
 */
function toNumber(val: any): number {
  if (typeof val === 'object' && val !== null && 'toNumber' in val) {
    return val.toNumber();
  }
  return typeof val === 'number' ? val : 0;
}

/**
 * POST /paths/between
 * Find shortest paths between source and target entity sets
 */
export async function handlePathsBetween(
  env: Env,
  body: PathsBetweenRequest
): Promise<Response> {
  try {
    const { source_ids, target_ids, max_depth, direction, limit } = body;

    // Validation
    if (!source_ids || !Array.isArray(source_ids) || source_ids.length === 0) {
      return errorResponse(
        'source_ids must be a non-empty array',
        ERROR_CODES.VALIDATION_ERROR,
        null,
        400
      );
    }

    if (!target_ids || !Array.isArray(target_ids) || target_ids.length === 0) {
      return errorResponse(
        'target_ids must be a non-empty array',
        ERROR_CODES.VALIDATION_ERROR,
        null,
        400
      );
    }

    if (typeof max_depth !== 'number' || max_depth < 1 || max_depth > MAX_DEPTH) {
      return errorResponse(
        `max_depth must be between 1 and ${MAX_DEPTH}`,
        ERROR_CODES.VALIDATION_ERROR,
        { provided: max_depth },
        400
      );
    }

    if (!['outgoing', 'incoming', 'both'].includes(direction)) {
      return errorResponse(
        'direction must be one of: outgoing, incoming, both',
        ERROR_CODES.VALIDATION_ERROR,
        { provided: direction },
        400
      );
    }

    const effectiveLimit = Math.min(limit ?? DEFAULT_LIMIT, MAX_LIMIT);

    // Build direction-specific relationship pattern with actual depth bounds
    let relPattern: string;
    switch (direction) {
      case 'outgoing':
        relPattern = `-[:RELATIONSHIP*1..${max_depth}]->`;
        break;
      case 'incoming':
        relPattern = `<-[:RELATIONSHIP*1..${max_depth}]-`;
        break;
      case 'both':
      default:
        relPattern = `-[:RELATIONSHIP*1..${max_depth}]-`;
        break;
    }

    // Cypher query to find shortest paths between source and target sets
    // Using shortestPath() which uses BFS internally for efficient pathfinding
    const query = `
      UNWIND $source_ids AS src_id
      UNWIND $target_ids AS tgt_id
      MATCH (source:Entity {canonical_id: src_id})
      MATCH (target:Entity {canonical_id: tgt_id})
      WHERE source <> target
      MATCH path = shortestPath((source)${relPattern}(target))
      WHERE path IS NOT NULL
      RETURN src_id AS source_id,
             tgt_id AS target_id,
             length(path) AS length,
             [rel IN relationships(path) | {
               subject_id: startNode(rel).canonical_id,
               subject_label: startNode(rel).label,
               subject_type: startNode(rel).type,
               predicate: rel.predicate,
               object_id: endNode(rel).canonical_id,
               object_label: endNode(rel).label,
               object_type: endNode(rel).type,
               source_pi: rel.source_pi
             }] AS edges
      LIMIT $limit
    `;

    const { records } = await executeQueryWithTimeout(env, query, {
      source_ids,
      target_ids,
      limit: neo4j.int(effectiveLimit + 1), // Fetch one extra to detect truncation
    }, QUERY_TIMEOUT_MS);

    const paths: PathResult[] = records.slice(0, effectiveLimit).map((record) => ({
      source_id: record.get('source_id'),
      target_id: record.get('target_id'),
      length: toNumber(record.get('length')),
      edges: record.get('edges') as PathEdge[],
    }));

    const response: PathsBetweenResponse = {
      paths,
      truncated: records.length > effectiveLimit,
    };

    return jsonResponse(response);
  } catch (error: any) {
    return errorResponse(
      error.message || 'Failed to find paths between entities',
      ERROR_CODES.INTERNAL_ERROR,
      { stack: error.stack }
    );
  }
}

/**
 * POST /paths/reachable
 * Find entities of a specific type reachable from source entities within N hops
 */
export async function handlePathsReachable(
  env: Env,
  body: PathsReachableRequest
): Promise<Response> {
  try {
    const { source_ids, target_type, max_depth, direction, limit } = body;

    // Validation
    if (!source_ids || !Array.isArray(source_ids) || source_ids.length === 0) {
      return errorResponse(
        'source_ids must be a non-empty array',
        ERROR_CODES.VALIDATION_ERROR,
        null,
        400
      );
    }

    if (!target_type || typeof target_type !== 'string') {
      return errorResponse(
        'target_type is required and must be a string',
        ERROR_CODES.VALIDATION_ERROR,
        null,
        400
      );
    }

    if (typeof max_depth !== 'number' || max_depth < 1 || max_depth > MAX_DEPTH) {
      return errorResponse(
        `max_depth must be between 1 and ${MAX_DEPTH}`,
        ERROR_CODES.VALIDATION_ERROR,
        { provided: max_depth },
        400
      );
    }

    if (!['outgoing', 'incoming', 'both'].includes(direction)) {
      return errorResponse(
        'direction must be one of: outgoing, incoming, both',
        ERROR_CODES.VALIDATION_ERROR,
        { provided: direction },
        400
      );
    }

    if (typeof limit !== 'number' || limit < 1) {
      return errorResponse(
        'limit is required and must be a positive number',
        ERROR_CODES.VALIDATION_ERROR,
        { provided: limit },
        400
      );
    }

    const effectiveLimit = Math.min(limit, MAX_LIMIT);

    // Build direction-specific arrow for relationship pattern
    let relArrow: { left: string; right: string };
    switch (direction) {
      case 'outgoing':
        relArrow = { left: '-', right: '->' };
        break;
      case 'incoming':
        relArrow = { left: '<-', right: '-' };
        break;
      case 'both':
      default:
        relArrow = { left: '-', right: '-' };
        break;
    }

    // Build BFS-style query using UNION ALL for each depth level
    // This naturally returns shortest paths first without ORDER BY
    // which allows Neo4j to terminate early once we hit the limit
    const depthQueries: string[] = [];
    for (let d = 1; d <= max_depth; d++) {
      depthQueries.push(`
        WITH source
        MATCH path = (source)${relArrow.left}[:RELATIONSHIP*${d}]${relArrow.right}(target:Entity {type: $target_type})
        WHERE target.canonical_id <> source.canonical_id
        RETURN target, path, ${d} AS path_length
        LIMIT $limit
      `);
    }

    const query = `
      UNWIND $source_ids AS src_id
      MATCH (source:Entity {canonical_id: src_id})
      CALL {
        ${depthQueries.join('\n        UNION ALL\n        ')}
      }
      WITH src_id, target, path, path_length
      LIMIT $limit
      RETURN src_id AS source_id,
             target.canonical_id AS target_id,
             target.label AS target_label,
             target.type AS target_type,
             path_length AS length,
             [rel IN relationships(path) | {
               subject_id: startNode(rel).canonical_id,
               subject_label: startNode(rel).label,
               subject_type: startNode(rel).type,
               predicate: rel.predicate,
               object_id: endNode(rel).canonical_id,
               object_label: endNode(rel).label,
               object_type: endNode(rel).type,
               source_pi: rel.source_pi
             }] AS edges
    `;

    const { records } = await executeQueryWithTimeout(env, query, {
      source_ids,
      target_type,
      limit: neo4j.int(effectiveLimit + 1),
    }, QUERY_TIMEOUT_MS);

    const results: ReachableResult[] = records.slice(0, effectiveLimit).map((record) => ({
      source_id: record.get('source_id'),
      target_id: record.get('target_id'),
      target_label: record.get('target_label'),
      target_type: record.get('target_type'),
      length: toNumber(record.get('length')),
      edges: record.get('edges') as PathEdge[],
    }));

    const response: PathsReachableResponse = {
      results,
      truncated: records.length > effectiveLimit,
    };

    return jsonResponse(response);
  } catch (error: any) {
    return errorResponse(
      error.message || 'Failed to find reachable entities',
      ERROR_CODES.INTERNAL_ERROR,
      { stack: error.stack }
    );
  }
}
