/**
 * Handlers for admin operations
 */

import { executeQuery } from '../neo4j';
import { errorResponse, jsonResponse } from '../utils/response';
import { ERROR_CODES } from '../constants';
import { Env, SuccessResponse } from '../types';

/**
 * Pattern that matches "nuke all" queries:
 * MATCH (n) DETACH DELETE n
 * MATCH (x) DELETE x
 * This catches queries that would delete ALL nodes without any filter.
 */
const MASS_DELETE_PATTERN = /MATCH\s*\(\s*(\w+)\s*\)\s*(DETACH\s+)?DELETE\s+\1/i;

/**
 * POST /query
 * Execute a custom Cypher query
 * WARNING: Allows arbitrary queries - use with caution!
 * SAFEGUARD: Blocks mass delete patterns (MATCH (n) DETACH DELETE n)
 */
export async function handleCustomQuery(
  env: Env,
  body: { query: string; params?: Record<string, any> }
): Promise<Response> {
  try {
    const { query, params = {} } = body;

    if (!query || typeof query !== 'string') {
      return errorResponse(
        'Missing or invalid field: query (must be a non-empty string)',
        'VALIDATION_ERROR',
        null,
        400
      );
    }

    // Block mass delete patterns to prevent accidental data loss
    if (MASS_DELETE_PATTERN.test(query)) {
      return errorResponse(
        'Mass delete blocked. This pattern would delete all nodes. Use /admin/clear-test-data for test cleanup or add filters to your query.',
        ERROR_CODES.VALIDATION_ERROR,
        { blocked_pattern: 'MATCH (n) [DETACH] DELETE n' },
        400
      );
    }

    const { records, summary } = await executeQuery(env, query, params);

    // Convert Neo4j records to plain objects
    const results = records.map((record) => {
      const obj: Record<string, any> = {};
      record.keys.forEach((key: string) => {
        const value = record.get(key);
        // Handle Neo4j types
        if (value && typeof value === 'object') {
          // Handle Integer type
          if (value.toNumber) {
            obj[key] = value.toNumber();
          } else if (value.properties) {
            // Handle Node/Relationship types
            obj[key] = value.properties;
          } else {
            obj[key] = value;
          }
        } else {
          obj[key] = value;
        }
      });
      return obj;
    });

    return jsonResponse({
      results,
      count: results.length,
      summary: {
        counters: summary.counters.updates(),
        queryType: summary.queryType,
      },
    });
  } catch (error: any) {
    return errorResponse(
      error.message || 'Failed to execute query',
      error.code,
      { stack: error.stack }
    );
  }
}

/**
 * POST /admin/clear-test-data
 * Clear only test data from the database
 *
 * Matches:
 * - Nodes with 'test' in id or canonical_id
 * - Nodes with id or canonical_id starting with 'II' (Arke testnet PIs)
 *
 * Safe to run in production - will not affect real data
 */
export async function handleClearTestData(env: Env): Promise<Response> {
  try {
    // Delete nodes that are test data:
    // 1. Contains 'test' in id or canonical_id
    // 2. Starts with 'II' (Arke testnet PI prefix - impossible for real ULIDs)
    const query = `
      MATCH (n)
      WHERE toString(n.id) CONTAINS 'test'
         OR toString(n.canonical_id) CONTAINS 'test'
         OR toString(n.id) STARTS WITH 'II'
         OR toString(n.canonical_id) STARTS WITH 'II'
      DETACH DELETE n
      RETURN count(n) as deleted_count
    `;

    const { records, summary } = await executeQuery(env, query);

    const deletedCount = records[0]?.get('deleted_count')?.toNumber() || 0;

    const response: SuccessResponse = {
      success: true,
      message: 'Test data cleared successfully',
      data: {
        deleted_nodes: deletedCount,
        deleted_relationships: summary.counters.updates().relationshipsDeleted,
        pattern: 'nodes with "test" in id/canonical_id OR starting with "II" (testnet)',
      },
    };

    return jsonResponse(response);
  } catch (error: any) {
    return errorResponse(
      error.message || 'Failed to clear test data',
      error.code,
      { stack: error.stack }
    );
  }
}
