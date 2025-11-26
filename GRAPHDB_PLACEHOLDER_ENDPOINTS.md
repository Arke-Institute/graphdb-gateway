# GraphDB Placeholder Resolution Endpoints

New endpoints required in graphdb-gateway to support placeholder resolution during reconciliation.

## Endpoint 1: Lookup Entities by Code

Find all entities with a specific code, optionally filtered by type.

### `POST /entities/lookup-by-code`

**Request:**
```json
{
  "code": "concert_a",
  "type": "unknown",        // Optional: only return entities of this type
  "excludeType": "unknown"  // Optional: exclude entities of this type
}
```

**Response:**
```json
{
  "entities": [
    {
      "canonical_id": "0de9afc6-3ef4-415d-911a-fa3b587f584e",
      "code": "concert_a",
      "label": "Concert A",
      "type": "event",
      "properties": { "date": "2024-06-15", "genre": "rock" },
      "created_by_pi": "01KAZ42PYCYBZAH002WPF25AE1",
      "source_pis": ["01KAZ42PYCYBZAH002WPF25AE1"]
    }
  ],
  "count": 1
}
```

**Neo4j Query:**
```cypher
MATCH (e:Entity {code: $code})
WHERE ($type IS NULL OR e.type = $type)
  AND ($excludeType IS NULL OR e.type <> $excludeType)
RETURN e
```

**Use Cases:**
- Find all placeholders with a specific code: `{ code: "concert_a", type: "unknown" }`
- Find all real entities with a specific code: `{ code: "concert_a", excludeType: "unknown" }`

---

## Endpoint 2: Find Nearest Entity by PI Hierarchy

Given a source PI and a list of candidate entity IDs, find the candidate whose creating PI is nearest in the PI hierarchy tree.

### `POST /entities/find-nearest-by-hierarchy`

**Request:**
```json
{
  "sourcePi": "01KAZ42PYC5BYS04M3GQ25TRHD",
  "candidateIds": [
    "0de9afc6-3ef4-415d-911a-fa3b587f584e",
    "abc12345-6789-0def-ghij-klmnopqrstuv"
  ],
  "maxHops": 10
}
```

**Response (match found):**
```json
{
  "found": true,
  "entity": {
    "canonical_id": "0de9afc6-3ef4-415d-911a-fa3b587f584e",
    "code": "concert_a",
    "label": "Concert A",
    "type": "event",
    "created_by_pi": "01KAZ42PYCYBZAH002WPF25AE1"
  },
  "hops": 1
}
```

**Response (no match within maxHops):**
```json
{
  "found": false
}
```

**Neo4j Query:**
```cypher
// Find the candidate entity whose PI is nearest to source PI
MATCH (source:PI {pi: $sourcePi})
MATCH (candidate:Entity)-[:MENTIONED_IN]->(candidatePi:PI)
WHERE candidate.canonical_id IN $candidateIds

// Find shortest path between source PI and candidate's PI
OPTIONAL MATCH path = shortestPath(
  (source)-[:PARENT_OF|CHILD_OF*..10]-(candidatePi)
)

WITH candidate, candidatePi,
     CASE WHEN path IS NULL THEN 999 ELSE length(path) END as hops
WHERE hops <= $maxHops

RETURN candidate, hops
ORDER BY hops ASC
LIMIT 1
```

**Notes:**
- Uses `PARENT_OF` and `CHILD_OF` relationships to traverse PI hierarchy
- `maxHops` prevents expensive traversals in large graphs
- Returns `found: false` if no candidate is reachable within maxHops
- Prefers `MENTIONED_IN` over `CREATED_BY` since entity might have been merged from another PI

---

## Type Definitions

Add to orchestrator's `types.ts`:

```typescript
// Lookup by code
export interface GraphDBLookupByCodeRequest {
  code: string;
  type?: string;        // Only return entities of this type
  excludeType?: string; // Exclude entities of this type
}

export interface GraphDBLookupByCodeResponse {
  entities: GraphDBEntity[];
  count: number;
}

// Find nearest by hierarchy
export interface GraphDBFindNearestRequest {
  sourcePi: string;
  candidateIds: string[];
  maxHops: number;
}

export interface GraphDBFindNearestResponse {
  found: boolean;
  entity?: GraphDBEntity;
  hops?: number;
}

```

---

## GraphDB Client Methods

Add to orchestrator's `graphdb.ts`:

```typescript
/**
 * Lookup entities by code with optional type filtering
 */
async lookupEntitiesByCode(
  request: GraphDBLookupByCodeRequest
): Promise<GraphDBLookupByCodeResponse> {
  const response = await this.service.fetch('http://api/entities/lookup-by-code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    throw new Error(`GraphDB lookupEntitiesByCode failed: ${response.status}`);
  }

  return await response.json();
}

/**
 * Find the nearest entity (by PI hierarchy) from a list of candidates
 */
async findNearestEntityByPIHierarchy(
  request: GraphDBFindNearestRequest
): Promise<GraphDBFindNearestResponse> {
  const response = await this.service.fetch('http://api/entities/find-nearest-by-hierarchy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    throw new Error(`GraphDB findNearestEntityByPIHierarchy failed: ${response.status}`);
  }

  return await response.json();
}

```

---

## Summary

Two endpoints are required:

1. **`/entities/lookup-by-code`** - Find placeholders/real entities by code
2. **`/entities/find-nearest-by-hierarchy`** - Disambiguate when multiple matches, also used to check connectivity by passing a single candidate
