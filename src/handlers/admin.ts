/**
 * Handlers for admin operations
 */

import { executeQuery } from '../neo4j';
import { errorResponse, jsonResponse } from '../utils/response';
import { Env, SuccessResponse } from '../types';

/**
 * POST /query
 * Execute a custom Cypher query
 * WARNING: Allows arbitrary queries - use with caution!
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
 * POST /admin/clear
 * Clear all data from the database (nodes and relationships)
 * WARNING: This is a destructive operation!
 */
export async function handleClearAllData(env: Env): Promise<Response> {
  try {
    const query = `
      MATCH (n)
      DETACH DELETE n
      RETURN count(n) as deleted_count
    `;

    const { records, summary } = await executeQuery(env, query);

    const deletedCount = records[0]?.get('deleted_count')?.toNumber() || 0;

    const response: SuccessResponse = {
      success: true,
      message: 'All data cleared successfully',
      data: {
        deleted_nodes: deletedCount,
        deleted_relationships: summary.counters.updates().relationshipsDeleted,
        cleared: true,
      },
    };

    return jsonResponse(response);
  } catch (error: any) {
    return errorResponse(
      error.message || 'Failed to clear data',
      error.code,
      { stack: error.stack }
    );
  }
}
