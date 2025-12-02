/**
 * Handlers for hierarchy/lineage operations
 */

import { executeQuery } from '../neo4j';
import { errorResponse, jsonResponse } from '../utils/response';
import { ERROR_CODES } from '../constants';
import {
  Env,
  FindInLineageRequest,
  FindInLineageResponse,
  GetLineageRequest,
  GetLineageResponse,
  LineagePiNode,
  LineageDirection,
} from '../types';

interface LineageMatch {
  canonical_id: string;
  code: string;
  label: string;
  type: string;
  properties: Record<string, any>;
  created_by_pi: string;
  hops: number;
  direction: 'same' | 'ancestor' | 'descendant';
}

/**
 * POST /entities/find-in-lineage
 * Find a candidate entity in direct lineage (ancestors/descendants only)
 * Does NOT match across sibling branches - only up or down the current branch
 */
export async function handleFindInLineage(
  env: Env,
  body: FindInLineageRequest
): Promise<Response> {
  try {
    const { sourcePi, candidateIds, maxHops } = body;

    if (!sourcePi || !candidateIds || !Array.isArray(candidateIds) || candidateIds.length === 0) {
      return errorResponse(
        'Missing required fields: sourcePi, candidateIds (non-empty array)',
        ERROR_CODES.VALIDATION_ERROR,
        null,
        400
      );
    }

    if (typeof maxHops !== 'number' || maxHops < 0) {
      return errorResponse(
        'maxHops must be a non-negative number',
        ERROR_CODES.VALIDATION_ERROR,
        { provided: maxHops },
        400
      );
    }

    const matches: LineageMatch[] = [];

    // 1. Check same PI (hops = 0)
    const samePiQuery = `
      MATCH (source:Entity {canonical_id: $sourcePi, type: 'pi'})
      MATCH (candidate:Entity)-[:EXTRACTED_FROM]->(source)
      WHERE candidate.canonical_id IN $candidateIds
        AND candidate.type <> 'pi'
      RETURN candidate.canonical_id AS canonical_id,
             candidate.code AS code,
             candidate.label AS label,
             candidate.type AS type,
             candidate.properties AS properties,
             candidate.created_by_pi AS created_by_pi
      LIMIT 1
    `;

    const { records: samePiRecords } = await executeQuery(env, samePiQuery, {
      sourcePi,
      candidateIds,
    });

    if (samePiRecords.length > 0) {
      const record = samePiRecords[0];
      matches.push({
        canonical_id: record.get('canonical_id'),
        code: record.get('code'),
        label: record.get('label'),
        type: record.get('type'),
        properties: record.get('properties') ? JSON.parse(record.get('properties')) : {},
        created_by_pi: record.get('created_by_pi'),
        hops: 0,
        direction: 'same',
      });
    }

    // 2. Check ancestors (source goes UP via CHILD_OF)
    // Only if we haven't found a same-PI match (hops=0 is best)
    if (matches.length === 0 && maxHops > 0) {
      const ancestorQuery = `
        MATCH (source:Entity {canonical_id: $sourcePi, type: 'pi'})
        MATCH path = (source)-[:CHILD_OF*1..20]->(ancestorPi:Entity {type: 'pi'})
        MATCH (candidate:Entity)-[:EXTRACTED_FROM]->(ancestorPi)
        WHERE candidate.canonical_id IN $candidateIds
          AND candidate.type <> 'pi'
          AND length(path) <= $maxHops
        RETURN candidate.canonical_id AS canonical_id,
               candidate.code AS code,
               candidate.label AS label,
               candidate.type AS type,
               candidate.properties AS properties,
               candidate.created_by_pi AS created_by_pi,
               length(path) AS hops
        ORDER BY hops ASC
        LIMIT 1
      `;

      const { records: ancestorRecords } = await executeQuery(env, ancestorQuery, {
        sourcePi,
        candidateIds,
        maxHops,
      });

      if (ancestorRecords.length > 0) {
        const record = ancestorRecords[0];
        matches.push({
          canonical_id: record.get('canonical_id'),
          code: record.get('code'),
          label: record.get('label'),
          type: record.get('type'),
          properties: record.get('properties') ? JSON.parse(record.get('properties')) : {},
          created_by_pi: record.get('created_by_pi'),
          hops: typeof record.get('hops') === 'object'
            ? record.get('hops').toNumber()
            : record.get('hops'),
          direction: 'ancestor',
        });
      }
    }

    // 3. Check descendants (descendantPi goes UP via CHILD_OF to reach source)
    // Only check if maxHops > 0
    if (maxHops > 0) {
      const descendantQuery = `
        MATCH (source:Entity {canonical_id: $sourcePi, type: 'pi'})
        MATCH path = (descendantPi:Entity {type: 'pi'})-[:CHILD_OF*1..20]->(source)
        MATCH (candidate:Entity)-[:EXTRACTED_FROM]->(descendantPi)
        WHERE candidate.canonical_id IN $candidateIds
          AND candidate.type <> 'pi'
          AND length(path) <= $maxHops
        RETURN candidate.canonical_id AS canonical_id,
               candidate.code AS code,
               candidate.label AS label,
               candidate.type AS type,
               candidate.properties AS properties,
               candidate.created_by_pi AS created_by_pi,
               length(path) AS hops
        ORDER BY hops ASC
        LIMIT 1
      `;

      const { records: descendantRecords } = await executeQuery(env, descendantQuery, {
        sourcePi,
        candidateIds,
        maxHops,
      });

      if (descendantRecords.length > 0) {
        const record = descendantRecords[0];
        matches.push({
          canonical_id: record.get('canonical_id'),
          code: record.get('code'),
          label: record.get('label'),
          type: record.get('type'),
          properties: record.get('properties') ? JSON.parse(record.get('properties')) : {},
          created_by_pi: record.get('created_by_pi'),
          hops: typeof record.get('hops') === 'object'
            ? record.get('hops').toNumber()
            : record.get('hops'),
          direction: 'descendant',
        });
      }
    }

    // No matches found in lineage
    if (matches.length === 0) {
      const response: FindInLineageResponse = { found: false };
      return jsonResponse(response);
    }

    // Return the nearest match (lowest hops)
    matches.sort((a, b) => a.hops - b.hops);
    const nearest = matches[0];

    const response: FindInLineageResponse = {
      found: true,
      entity: {
        canonical_id: nearest.canonical_id,
        code: nearest.code,
        label: nearest.label,
        type: nearest.type,
        properties: nearest.properties,
        created_by_pi: nearest.created_by_pi,
      },
      hops: nearest.hops,
      direction: nearest.direction,
    };

    return jsonResponse(response);
  } catch (error: any) {
    return errorResponse(
      error.message || 'Failed to find entity in lineage',
      error.code,
      { stack: error.stack }
    );
  }
}

/**
 * POST /pi/lineage
 * Get full lineage (ancestors and/or descendants) of a PI
 */
export async function handleGetLineage(
  env: Env,
  body: GetLineageRequest
): Promise<Response> {
  try {
    const { sourcePi, direction, maxHops } = body;

    // Validation
    if (!sourcePi) {
      return errorResponse(
        'Missing required field: sourcePi',
        ERROR_CODES.VALIDATION_ERROR,
        null,
        400
      );
    }

    if (!direction || !['ancestors', 'descendants', 'both'].includes(direction)) {
      return errorResponse(
        'direction must be one of: ancestors, descendants, both',
        ERROR_CODES.VALIDATION_ERROR,
        { provided: direction },
        400
      );
    }

    if (typeof maxHops !== 'number' || maxHops < 1) {
      return errorResponse(
        'maxHops must be a positive number',
        ERROR_CODES.VALIDATION_ERROR,
        { provided: maxHops },
        400
      );
    }

    const response: GetLineageResponse = { sourcePi };

    // Helper to convert Neo4j Integer to JS number
    const toNumber = (val: any): number => {
      if (typeof val === 'object' && val !== null && 'toNumber' in val) {
        return val.toNumber();
      }
      return val;
    };

    // Query ancestors (source goes UP via CHILD_OF)
    if (direction === 'ancestors' || direction === 'both') {
      const ancestorQuery = `
        MATCH (source:Entity {canonical_id: $sourcePi, type: 'pi'})
        MATCH path = (source)-[:CHILD_OF*1..100]->(ancestor:Entity {type: 'pi'})
        WHERE length(path) <= $maxHops
        RETURN ancestor.canonical_id AS id,
               ancestor.first_seen AS created_at,
               length(path) AS hops
        ORDER BY hops ASC
      `;

      const { records: ancestorRecords } = await executeQuery(env, ancestorQuery, {
        sourcePi,
        maxHops,
      });

      const ancestorPis: LineagePiNode[] = ancestorRecords.map((record) => ({
        id: record.get('id'),
        hops: toNumber(record.get('hops')),
        created_at: record.get('created_at')?.toString(),
      }));

      // Check if we hit the limit (truncated)
      const truncated = ancestorPis.length > 0 &&
        ancestorPis[ancestorPis.length - 1].hops >= maxHops;

      response.ancestors = {
        pis: ancestorPis,
        count: ancestorPis.length,
        truncated,
      };
    }

    // Query descendants (descendants have CHILD_OF pointing toward source)
    if (direction === 'descendants' || direction === 'both') {
      const descendantQuery = `
        MATCH (source:Entity {canonical_id: $sourcePi, type: 'pi'})
        MATCH path = (descendant:Entity {type: 'pi'})-[:CHILD_OF*1..100]->(source)
        WHERE length(path) <= $maxHops
        RETURN descendant.canonical_id AS id,
               descendant.first_seen AS created_at,
               length(path) AS hops
        ORDER BY hops ASC
      `;

      const { records: descendantRecords } = await executeQuery(env, descendantQuery, {
        sourcePi,
        maxHops,
      });

      const descendantPis: LineagePiNode[] = descendantRecords.map((record) => ({
        id: record.get('id'),
        hops: toNumber(record.get('hops')),
        created_at: record.get('created_at')?.toString(),
      }));

      // Check if we hit the limit (truncated)
      const truncated = descendantPis.length > 0 &&
        descendantPis[descendantPis.length - 1].hops >= maxHops;

      response.descendants = {
        pis: descendantPis,
        count: descendantPis.length,
        truncated,
      };
    }

    return jsonResponse(response);
  } catch (error: any) {
    return errorResponse(
      error.message || 'Failed to get lineage',
      error.code,
      { stack: error.stack }
    );
  }
}
