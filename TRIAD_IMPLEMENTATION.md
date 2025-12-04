# GraphDB Gateway: Triad Path-Finding Implementation

## Overview

This document describes the implementation of two new endpoints for the GraphDB Gateway that enable triad-based query execution. These endpoints allow the query-links service to offload graph traversal to Neo4j instead of performing BFS expansion across service boundaries.

## Background

The current architecture treats GraphDB as a key-value store, fetching relationships one entity at a time. This causes exponential subrequest growth for multi-hop queries. The new endpoints leverage Neo4j's native graph traversal capabilities to find paths efficiently.

## New Endpoints

### 1. `POST /paths/between`

Find shortest paths connecting a set of source entities to a set of target entities.

**Use Case:** When both source and target are known (e.g., from Pinecone semantic search), find how they're connected in the graph.

#### Request

```typescript
interface PathsBetweenRequest {
  source_ids: string[];      // Starting entity canonical IDs
  target_ids: string[];      // Target entity canonical IDs
  max_depth: number;         // Maximum path length (1-10)
  direction: 'outgoing' | 'incoming' | 'both';
  limit?: number;            // Max paths to return (default 100)
}
```

#### Response

```typescript
interface PathsBetweenResponse {
  paths: Array<{
    source_id: string;       // Which source this path starts from
    target_id: string;       // Which target this path ends at
    length: number;          // Number of hops
    edges: Array<{
      subject_id: string;    // Edge start entity
      predicate: string;     // Relationship type
      object_id: string;     // Edge end entity
      source_pi: string;     // PI that created this relationship
    }>;
  }>;
  truncated: boolean;        // True if more paths exist beyond limit
}
```

#### Example

```bash
curl -X POST http://localhost:8787/paths/between \
  -H "Content-Type: application/json" \
  -d '{
    "source_ids": ["a02e1ce8-d7c5-4008-a966-7f6da61747ee"],
    "target_ids": ["2e12cc37-2504-71ff-7fba-61ddd8531119", "c783b346-9bf3-38d0-fc6e-4882d3a96c9e"],
    "max_depth": 4,
    "direction": "outgoing",
    "limit": 10
  }'
```

#### Cypher Implementation

```cypher
// For 'both' direction (undirected paths)
UNWIND $source_ids AS src_id
UNWIND $target_ids AS tgt_id
MATCH (source:Entity {canonical_id: src_id})
MATCH (target:Entity {canonical_id: tgt_id})
WHERE source <> target
CALL {
  WITH source, target
  MATCH path = shortestPath((source)-[:RELATIONSHIP*1..10]-(target))
  WHERE length(path) <= $max_depth
  RETURN path
  LIMIT 1
}
WITH src_id AS source_id, tgt_id AS target_id, path
WHERE path IS NOT NULL
RETURN source_id,
       target_id,
       length(path) AS length,
       [rel IN relationships(path) | {
         subject_id: startNode(rel).canonical_id,
         predicate: rel.predicate,
         object_id: endNode(rel).canonical_id,
         source_pi: rel.source_pi
       }] AS edges
ORDER BY length ASC
LIMIT $limit
```

```cypher
// For 'outgoing' direction only
UNWIND $source_ids AS src_id
UNWIND $target_ids AS tgt_id
MATCH (source:Entity {canonical_id: src_id})
MATCH (target:Entity {canonical_id: tgt_id})
WHERE source <> target
CALL {
  WITH source, target
  MATCH path = shortestPath((source)-[:RELATIONSHIP*1..10]->(target))
  WHERE length(path) <= $max_depth
  RETURN path
  LIMIT 1
}
WITH src_id AS source_id, tgt_id AS target_id, path
WHERE path IS NOT NULL
RETURN source_id,
       target_id,
       length(path) AS length,
       [rel IN relationships(path) | {
         subject_id: startNode(rel).canonical_id,
         predicate: rel.predicate,
         object_id: endNode(rel).canonical_id,
         source_pi: rel.source_pi
       }] AS edges
ORDER BY length ASC
LIMIT $limit
```

```cypher
// For 'incoming' direction only
UNWIND $source_ids AS src_id
UNWIND $target_ids AS tgt_id
MATCH (source:Entity {canonical_id: src_id})
MATCH (target:Entity {canonical_id: tgt_id})
WHERE source <> target
CALL {
  WITH source, target
  MATCH path = shortestPath((source)<-[:RELATIONSHIP*1..10]-(target))
  WHERE length(path) <= $max_depth
  RETURN path
  LIMIT 1
}
WITH src_id AS source_id, tgt_id AS target_id, path
WHERE path IS NOT NULL
RETURN source_id,
       target_id,
       length(path) AS length,
       [rel IN relationships(path) | {
         subject_id: startNode(rel).canonical_id,
         predicate: rel.predicate,
         object_id: endNode(rel).canonical_id,
         source_pi: rel.source_pi
       }] AS edges
ORDER BY length ASC
LIMIT $limit
```

---

### 2. `POST /paths/reachable`

Find entities of a specific type that are reachable from source entities within N hops.

**Use Case:** When only the source is known semantically and the target is defined by type only (e.g., "find all files within 4 hops of this entity").

#### Request

```typescript
interface PathsReachableRequest {
  source_ids: string[];      // Starting entity canonical IDs
  target_type: string;       // Type of entities to find (e.g., "file", "person")
  max_depth: number;         // Maximum path length (1-10)
  direction: 'outgoing' | 'incoming' | 'both';
  limit: number;             // Max results to return
}
```

#### Response

```typescript
interface PathsReachableResponse {
  results: Array<{
    source_id: string;       // Which source this path starts from
    target_id: string;       // The found entity's canonical_id
    target_label: string;    // The found entity's label
    target_type: string;     // Confirms the type
    length: number;          // Path length (hops)
    edges: Array<{
      subject_id: string;
      predicate: string;
      object_id: string;
      source_pi: string;
    }>;
  }>;
  truncated: boolean;
}
```

#### Example

```bash
curl -X POST http://localhost:8787/paths/reachable \
  -H "Content-Type: application/json" \
  -d '{
    "source_ids": ["a02e1ce8-d7c5-4008-a966-7f6da61747ee"],
    "target_type": "file",
    "max_depth": 4,
    "direction": "outgoing",
    "limit": 10
  }'
```

#### Cypher Implementation

```cypher
// For 'both' direction
UNWIND $source_ids AS src_id
MATCH (source:Entity {canonical_id: src_id})
CALL {
  WITH source
  MATCH path = (source)-[:RELATIONSHIP*1..10]-(target:Entity)
  WHERE target.type = $target_type
    AND target.canonical_id <> source.canonical_id
    AND length(path) <= $max_depth
  WITH target, path, length(path) AS path_length
  ORDER BY path_length ASC
  RETURN target, path, path_length
  LIMIT $limit
}
RETURN src_id AS source_id,
       target.canonical_id AS target_id,
       target.label AS target_label,
       target.type AS target_type,
       path_length AS length,
       [rel IN relationships(path) | {
         subject_id: startNode(rel).canonical_id,
         predicate: rel.predicate,
         object_id: endNode(rel).canonical_id,
         source_pi: rel.source_pi
       }] AS edges
ORDER BY length ASC
LIMIT $limit
```

```cypher
// For 'outgoing' direction
UNWIND $source_ids AS src_id
MATCH (source:Entity {canonical_id: src_id})
CALL {
  WITH source
  MATCH path = (source)-[:RELATIONSHIP*1..10]->(target:Entity)
  WHERE target.type = $target_type
    AND target.canonical_id <> source.canonical_id
    AND length(path) <= $max_depth
  WITH target, path, length(path) AS path_length
  ORDER BY path_length ASC
  RETURN target, path, path_length
  LIMIT $limit
}
RETURN src_id AS source_id,
       target.canonical_id AS target_id,
       target.label AS target_label,
       target.type AS target_type,
       path_length AS length,
       [rel IN relationships(path) | {
         subject_id: startNode(rel).canonical_id,
         predicate: rel.predicate,
         object_id: endNode(rel).canonical_id,
         source_pi: rel.source_pi
       }] AS edges
ORDER BY length ASC
LIMIT $limit
```

```cypher
// For 'incoming' direction
UNWIND $source_ids AS src_id
MATCH (source:Entity {canonical_id: src_id})
CALL {
  WITH source
  MATCH path = (source)<-[:RELATIONSHIP*1..10]-(target:Entity)
  WHERE target.type = $target_type
    AND target.canonical_id <> source.canonical_id
    AND length(path) <= $max_depth
  WITH target, path, length(path) AS path_length
  ORDER BY path_length ASC
  RETURN target, path, path_length
  LIMIT $limit
}
RETURN src_id AS source_id,
       target.canonical_id AS target_id,
       target.label AS target_label,
       target.type AS target_type,
       path_length AS length,
       [rel IN relationships(path) | {
         subject_id: startNode(rel).canonical_id,
         predicate: rel.predicate,
         object_id: endNode(rel).canonical_id,
         source_pi: rel.source_pi
       }] AS edges
ORDER BY length ASC
LIMIT $limit
```

---

## Implementation Details

### File Structure

```
src/
├── handlers/
│   ├── paths.ts          # NEW: Path-finding handlers
│   └── ... (existing)
├── router.ts             # Add new routes
└── types/
    └── paths.ts          # NEW: Type definitions
```

### New Files

#### `src/types/paths.ts`

```typescript
export interface PathsBetweenRequest {
  source_ids: string[];
  target_ids: string[];
  max_depth: number;
  direction: 'outgoing' | 'incoming' | 'both';
  limit?: number;
}

export interface PathEdge {
  subject_id: string;
  predicate: string;
  object_id: string;
  source_pi: string;
}

export interface PathResult {
  source_id: string;
  target_id: string;
  length: number;
  edges: PathEdge[];
}

export interface PathsBetweenResponse {
  paths: PathResult[];
  truncated: boolean;
}

export interface PathsReachableRequest {
  source_ids: string[];
  target_type: string;
  max_depth: number;
  direction: 'outgoing' | 'incoming' | 'both';
  limit: number;
}

export interface ReachableResult {
  source_id: string;
  target_id: string;
  target_label: string;
  target_type: string;
  length: number;
  edges: PathEdge[];
}

export interface PathsReachableResponse {
  results: ReachableResult[];
  truncated: boolean;
}
```

#### `src/handlers/paths.ts`

```typescript
import { Driver } from 'neo4j-driver';
import type {
  PathsBetweenRequest,
  PathsBetweenResponse,
  PathsReachableRequest,
  PathsReachableResponse,
  PathEdge
} from '../types/paths';

const DEFAULT_LIMIT = 100;
const MAX_DEPTH = 10;

export async function handlePathsBetween(
  request: Request,
  driver: Driver,
  database: string
): Promise<Response> {
  const body: PathsBetweenRequest = await request.json();

  // Validation
  if (!body.source_ids?.length) {
    return new Response(JSON.stringify({ error: 'source_ids required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  if (!body.target_ids?.length) {
    return new Response(JSON.stringify({ error: 'target_ids required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  if (!body.max_depth || body.max_depth < 1 || body.max_depth > MAX_DEPTH) {
    return new Response(JSON.stringify({ error: `max_depth must be 1-${MAX_DEPTH}` }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  if (!['outgoing', 'incoming', 'both'].includes(body.direction)) {
    return new Response(JSON.stringify({ error: 'direction must be outgoing, incoming, or both' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const limit = Math.min(body.limit ?? DEFAULT_LIMIT, 1000);

  // Build direction-specific query
  const relationshipPattern = getRelationshipPattern(body.direction, body.max_depth);

  const query = `
    UNWIND $source_ids AS src_id
    UNWIND $target_ids AS tgt_id
    MATCH (source:Entity {canonical_id: src_id})
    MATCH (target:Entity {canonical_id: tgt_id})
    WHERE source <> target
    CALL {
      WITH source, target
      MATCH path = shortestPath((source)${relationshipPattern}(target))
      WHERE length(path) <= $max_depth
      RETURN path
      LIMIT 1
    }
    WITH src_id AS source_id, tgt_id AS target_id, path
    WHERE path IS NOT NULL
    RETURN source_id,
           target_id,
           length(path) AS length,
           [rel IN relationships(path) | {
             subject_id: startNode(rel).canonical_id,
             predicate: rel.predicate,
             object_id: endNode(rel).canonical_id,
             source_pi: rel.source_pi
           }] AS edges
    ORDER BY length ASC
    LIMIT $limit
  `;

  const session = driver.session({ database });
  try {
    const result = await session.run(query, {
      source_ids: body.source_ids,
      target_ids: body.target_ids,
      max_depth: body.max_depth,
      limit: limit + 1  // Fetch one extra to detect truncation
    });

    const paths = result.records.slice(0, limit).map(record => ({
      source_id: record.get('source_id'),
      target_id: record.get('target_id'),
      length: record.get('length').toNumber(),
      edges: record.get('edges') as PathEdge[]
    }));

    const response: PathsBetweenResponse = {
      paths,
      truncated: result.records.length > limit
    };

    return new Response(JSON.stringify(response), {
      headers: { 'Content-Type': 'application/json' }
    });
  } finally {
    await session.close();
  }
}

export async function handlePathsReachable(
  request: Request,
  driver: Driver,
  database: string
): Promise<Response> {
  const body: PathsReachableRequest = await request.json();

  // Validation
  if (!body.source_ids?.length) {
    return new Response(JSON.stringify({ error: 'source_ids required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  if (!body.target_type) {
    return new Response(JSON.stringify({ error: 'target_type required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  if (!body.max_depth || body.max_depth < 1 || body.max_depth > MAX_DEPTH) {
    return new Response(JSON.stringify({ error: `max_depth must be 1-${MAX_DEPTH}` }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  if (!body.limit || body.limit < 1) {
    return new Response(JSON.stringify({ error: 'limit required and must be positive' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const limit = Math.min(body.limit, 1000);
  const relationshipPattern = getRelationshipPattern(body.direction, body.max_depth);

  const query = `
    UNWIND $source_ids AS src_id
    MATCH (source:Entity {canonical_id: src_id})
    CALL {
      WITH source
      MATCH path = (source)${relationshipPattern}(target:Entity)
      WHERE target.type = $target_type
        AND target.canonical_id <> source.canonical_id
        AND length(path) <= $max_depth
      WITH target, path, length(path) AS path_length
      ORDER BY path_length ASC
      RETURN target, path, path_length
      LIMIT $limit
    }
    RETURN src_id AS source_id,
           target.canonical_id AS target_id,
           target.label AS target_label,
           target.type AS target_type,
           path_length AS length,
           [rel IN relationships(path) | {
             subject_id: startNode(rel).canonical_id,
             predicate: rel.predicate,
             object_id: endNode(rel).canonical_id,
             source_pi: rel.source_pi
           }] AS edges
    ORDER BY length ASC
    LIMIT $limit
  `;

  const session = driver.session({ database });
  try {
    const result = await session.run(query, {
      source_ids: body.source_ids,
      target_type: body.target_type,
      max_depth: body.max_depth,
      limit: limit + 1
    });

    const results = result.records.slice(0, limit).map(record => ({
      source_id: record.get('source_id'),
      target_id: record.get('target_id'),
      target_label: record.get('target_label'),
      target_type: record.get('target_type'),
      length: record.get('length').toNumber(),
      edges: record.get('edges') as PathEdge[]
    }));

    const response: PathsReachableResponse = {
      results,
      truncated: result.records.length > limit
    };

    return new Response(JSON.stringify(response), {
      headers: { 'Content-Type': 'application/json' }
    });
  } finally {
    await session.close();
  }
}

function getRelationshipPattern(direction: string, maxDepth: number): string {
  // Note: We use *1..10 as Neo4j requires literal bounds, then filter by max_depth in WHERE
  switch (direction) {
    case 'outgoing':
      return '-[:RELATIONSHIP*1..10]->';
    case 'incoming':
      return '<-[:RELATIONSHIP*1..10]-';
    case 'both':
    default:
      return '-[:RELATIONSHIP*1..10]-';
  }
}
```

### Router Updates

Add to `src/router.ts`:

```typescript
import { handlePathsBetween, handlePathsReachable } from './handlers/paths';

// In the route handling switch/if:
if (method === 'POST' && path === '/paths/between') {
  return handlePathsBetween(request, driver, database);
}

if (method === 'POST' && path === '/paths/reachable') {
  return handlePathsReachable(request, driver, database);
}

// Add to ENDPOINTS array for health check:
const ENDPOINTS = [
  // ... existing endpoints
  'POST /paths/between',
  'POST /paths/reachable',
];
```

---

## Performance Considerations

### Index Requirements

The queries use `canonical_id` and `type` for lookups. Ensure these indexes exist:

```cypher
CREATE INDEX entity_canonical_id IF NOT EXISTS FOR (e:Entity) ON (e.canonical_id);
CREATE INDEX entity_type IF NOT EXISTS FOR (e:Entity) ON (e.type);
```

### Query Complexity

- `shortestPath()` is optimized in Neo4j but can be expensive for deeply connected graphs
- The `LIMIT` inside the subquery bounds per-source results
- Consider adding timeout handling for very complex graphs

### Limits

- `max_depth` capped at 10 to prevent runaway queries
- `limit` capped at 1000 results
- Source/target ID arrays should be reasonably sized (query-links will use k_explore, typically 15-30)

---

## Testing

### Manual Testing

```bash
# Test /paths/between with known connected entities
curl -X POST http://localhost:8787/paths/between \
  -H "Content-Type: application/json" \
  -d '{
    "source_ids": ["SOURCE_ENTITY_ID"],
    "target_ids": ["TARGET_ENTITY_ID"],
    "max_depth": 4,
    "direction": "both"
  }'

# Test /paths/reachable for files from an organization
curl -X POST http://localhost:8787/paths/reachable \
  -H "Content-Type: application/json" \
  -d '{
    "source_ids": ["a02e1ce8-d7c5-4008-a966-7f6da61747ee"],
    "target_type": "file",
    "max_depth": 4,
    "direction": "outgoing",
    "limit": 10
  }'
```

### Integration Tests

Add test cases in `tests/`:

```typescript
describe('/paths/between', () => {
  it('finds shortest path between connected entities', async () => {
    // Setup: create A -> B -> C chain
    // Test: find path from A to C
    // Assert: path length is 2, edges are correct
  });

  it('returns empty when no path exists', async () => {
    // Setup: create disconnected A and B
    // Test: find path from A to B
    // Assert: paths array is empty
  });

  it('respects direction constraint', async () => {
    // Setup: create A -> B (outgoing only)
    // Test: find path from B to A with direction: outgoing
    // Assert: no path found (wrong direction)
  });

  it('respects max_depth', async () => {
    // Setup: create A -> B -> C -> D (3 hops)
    // Test: find path from A to D with max_depth: 2
    // Assert: no path found (too far)
  });
});

describe('/paths/reachable', () => {
  it('finds entities of target type within depth', async () => {
    // Setup: create org -> person -> file
    // Test: find files reachable from org with max_depth: 2
    // Assert: file is found with length: 2
  });

  it('returns shortest path when multiple paths exist', async () => {
    // Setup: create org -> file (direct) and org -> person -> file
    // Test: find files reachable from org
    // Assert: direct path (length: 1) comes first
  });
});
```

---

## Rollout Plan

1. **Deploy to staging** - Test with real data
2. **Monitor query performance** - Check Neo4j query times
3. **Deploy to production** - Behind feature flag if needed
4. **Update query-links** - Once endpoints are stable

---

## Appendix: Why Not Use APOC Path Procedures?

Neo4j's built-in `shortestPath()` is sufficient for our use case. APOC path procedures (`apoc.path.expand`, `apoc.path.spanningTree`) offer more flexibility but add complexity:

- `shortestPath()` is optimized and indexed
- We don't need weighted paths
- We don't need all paths, just shortest
- Keeping dependencies minimal

If performance becomes an issue with very large graphs, consider:
- `apoc.path.expandConfig` with `limit` and `bfs: true`
- Adding relationship type filtering at the Cypher level
- Caching common path queries
