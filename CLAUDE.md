# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

GraphDB Gateway Worker is a Cloudflare Worker that provides a RESTful API gateway to Neo4j AuraDB for entity linking operations. It's part of the Arke Institute's entity linking pipeline, deployed at https://graphdb-gateway.arke.institute.

**Technology Stack**:
- Runtime: Cloudflare Workers (V8 isolates, edge-deployed)
- Language: TypeScript 5.9
- Database: Neo4j AuraDB 5.27
- Driver: neo4j-driver 5.28
- Deploy: Wrangler CLI

## Development Commands

```bash
# Install dependencies
npm install

# Local development server
npm run dev                  # Start Wrangler dev server

# Testing
npm test                     # Test Neo4j connectivity
npm run test:neo4j          # Same as npm test
npm run test:endpoints      # Test API endpoints locally (requires dev server running)
npm run test:production     # Test production deployment

# Database utilities
npm run populate            # Add sample data to Neo4j
npm run explore             # View database contents
npm run cleanup             # Remove test data
npm run add-indexes         # Add performance indexes to Neo4j

# Deployment
npm run deploy              # Deploy to Cloudflare
npm run logs                # View production logs
```

### Environment Setup

Create `.dev.vars` file for local development:
```env
NEO4J_URI=neo4j+s://xxx.databases.neo4j.io
NEO4J_USERNAME=neo4j
NEO4J_PASSWORD=your-password
NEO4J_DATABASE=neo4j
```

For production, set secrets via Wrangler:
```bash
npx wrangler secret put NEO4J_URI
npx wrangler secret put NEO4J_USERNAME
npx wrangler secret put NEO4J_PASSWORD
```

## Architecture

### High-Level Structure

```
Orchestrator (entity linking pipeline)
     ↓
[GraphDB Gateway Worker] (Cloudflare edge)
     ↓ (neo4j+s://)
Neo4j AuraDB (graph database)
```

### Code Organization

The codebase is organized in a modular structure:

```
src/
├── index.ts              # Entry point (minimal, delegates to router)
├── router.ts             # Route matching and handler dispatch
├── constants.ts          # CORS headers, error codes, config
├── neo4j.ts              # Neo4j connection management
│
├── handlers/             # Request handlers by domain
│   ├── pi.ts            # PI creation and management
│   ├── entity.ts        # Entity CRUD (create, merge, query, list, delete, get, exists)
│   ├── hierarchy.ts     # Lineage lookups (find-in-lineage)
│   └── relationship.ts  # Relationship creation
│
├── types/                # Type definitions by domain
│   ├── index.ts         # Re-exports all types
│   ├── common.ts        # Env, ErrorResponse, SuccessResponse
│   ├── pi.ts            # PI-related types
│   ├── entity.ts        # Entity-related types
│   ├── hierarchy.ts     # Hierarchy-related types
│   └── relationship.ts  # Relationship-related types
│
└── utils/                # Shared utilities
    ├── response.ts      # jsonResponse, errorResponse, handleOptions
    └── validation.ts    # Input validation helpers
```

### Cloudflare Workers Pattern

The worker uses a **stateless request handler** pattern:
1. Export a `fetch` handler as the entry point
2. Parse request URL and body
3. Route to appropriate handler function
4. Return JSON response with CORS headers

Important: Cloudflare Workers are stateless V8 isolates, so each request creates a new Neo4j driver instance and closes it after the query.

### Neo4j Connection Management

**Key Pattern** (src/neo4j.ts):
```typescript
// Create driver per-request, close after query
export async function executeQuery(env, query, params) {
  const driver = createDriver(env);
  try {
    const result = await driver.executeQuery(query, params);
    return { records, summary };
  } finally {
    await driver.close();  // Always close!
  }
}
```

**Why this pattern?**
- Cloudflare Workers are stateless and short-lived
- Creating/closing drivers per-request is the recommended approach for edge functions
- The neo4j-driver handles connection pooling internally

## Neo4j Schema

### Node Types

**Unified Entity Model**: All nodes (including PIs) are stored as Entity nodes. PIs are distinguished by `type: 'pi'`.

**Entity Nodes**:
```cypher
(:Entity {
  canonical_id: string,         // UUID or ULID (primary identifier)
  code: string,                 // Human-readable code (PIs use 'pi_' + canonical_id)
  label: string,                // Display name
  type: string,                 // Entity type: 'pi', 'person', 'event', 'date', 'file', etc.
  properties: string,           // JSON-serialized map
  created_by_pi: string|null,   // PI that created this entity (null for PI entities)
  first_seen: datetime,
  last_updated: datetime
})
```

**PI Entities** (Processed Items with `type: 'pi'`):
```cypher
(:Entity {
  canonical_id: '01KAZ42PYC...',  // ULID identifier
  code: 'pi_01KAZ42PYC...',       // Prefixed with 'pi_'
  label: '01KAZ42PYC...',         // Same as canonical_id
  type: 'pi',                     // Distinguishes PI entities
  properties: '{}',
  created_by_pi: null,            // PIs have no creator
  first_seen: datetime,
  last_updated: datetime
})
```

**Entity Subtypes** (applied as additional labels):
- `(:Entity:Date)` - Date entities
- `(:Entity:File)` - File entities

### Relationship Types

**PI Hierarchy** (between Entity nodes with `type: 'pi'`):
```cypher
(:Entity {type:'pi'})-[:PARENT_OF]->(:Entity {type:'pi'})
(:Entity {type:'pi'})-[:CHILD_OF]->(:Entity {type:'pi'})
```

**Entity Extraction** (non-PI entities link to PI entities):
```cypher
(:Entity)-[:EXTRACTED_FROM {
  original_code: string,
  extracted_at: datetime
}]->(:Entity {type:'pi'})
```

**Note**: PI entities do NOT have EXTRACTED_FROM relationships to themselves.

**Entity Relationships**:
```cypher
(:Entity)-[:RELATIONSHIP {
  predicate: string,            // Relationship type (e.g., "affiliated_with")
  properties: string,           // JSON-serialized map
  source_pi: string,            // PI that created this relationship
  created_at: datetime
}]->(:Entity)
```

### Important Conventions

**Properties Storage**:
- All `properties` fields are JSON strings, not native Neo4j maps
- Always use `JSON.stringify()` when writing, `JSON.parse()` when reading
- Example: `properties: JSON.stringify({ role: "researcher" })`

**Entity Creator Tracking (`created_by_pi`)**:
- `created_by_pi` tracks which PI first created the canonical entity record
- Set once during `/entity/create`, never modified
- Different from `source_pis` (via EXTRACTED_FROM relationships), which tracks all PIs that mention this entity
- Provides O(1) lookup of entity creator (faster than relationship traversal)

**Concurrency Safety**:
- Entity creation uses `MERGE` on `canonical_id` (not `CREATE`) for atomic idempotency
- The unique constraint on `canonical_id` prevents duplicate entities under concurrent load
- Multiple concurrent requests with the same `canonical_id` will:
  - First request: creates the entity (ON CREATE)
  - Subsequent requests: match existing entity (ON MATCH)
  - All requests succeed with HTTP 200 (idempotent behavior)

## API Endpoint Patterns

### Request Flow

1. **CORS handling**: All OPTIONS requests return CORS headers
2. **Body parsing**: Parse JSON body, return 400 if invalid
3. **Validation**: Check required fields, return 400 with VALIDATION_ERROR
4. **Query execution**: Call `executeQuery()` with Cypher and parameters
5. **Response**: Return JSON with appropriate status code

### Error Response Format

All errors return this structure:
```typescript
{
  error: string,      // Human-readable message
  code?: string,      // Error code (VALIDATION_ERROR, etc.)
  details?: any       // Additional context
}
```

### Cypher Query Patterns

**MERGE for idempotency** (create or update):
```cypher
MERGE (p:Entity {canonical_id: $pi, type: 'pi'})
ON CREATE SET p.code = 'pi_' + $pi, p.label = $pi, p.first_seen = datetime()
ON MATCH SET p.last_updated = datetime()
```

**UNWIND for batch operations**:
```cypher
UNWIND $relationships AS rel
MATCH (subject:Entity {canonical_id: rel.subject_id})
MATCH (object:Entity {canonical_id: rel.object_id})
CREATE (subject)-[:RELATIONSHIP {...}]->(object)
```

## Entity Linking Architecture

### Division of Responsibilities

**Orchestrator** (external service calling this API):
- Decides whether to merge or create entities
- Semantic similarity scoring (via Pinecone)
- Resolves ALL entity references from properties
- Generates canonical IDs (UUIDs)
- Workflow orchestration

**GraphDB Gateway** (this service):
- Simple storage and retrieval of entities
- Atomic entity merging (absorb source into target)
- Track source PIs via EXTRACTED_FROM relationships
- Query parent/child entity hierarchies
- Database constraints and validation

**Key Principle**: The orchestrator handles all decision-making logic; the Graph API is a data layer.

## API Endpoints

### PI Operations

**POST /pi/create** - Create PI entity with parent-child relationships
- Creates Entity node with `type: 'pi'` (convenience wrapper)
- Optionally links to parent and/or children PIs via PARENT_OF/CHILD_OF
- Auto-creates parent/children PI entities if they don't exist
- Idempotent (uses MERGE)

### Entity Operations

**POST /entity/create** - Create new entity (idempotent via MERGE)
- Simple storage (does NOT resolve entity refs)
- Accepts clean properties only
- **For PI entities** (`type: 'pi'`):
  - `source_pi` must equal `canonical_id` (self-referential)
  - No EXTRACTED_FROM relationship created
  - `created_by_pi` is set to `null`
- **For other entities** (`type !== 'pi'`):
  - `source_pi` must exist as an `Entity {type: 'pi'}` (404 if not found)
  - Creates EXTRACTED_FROM relationship to the PI entity
  - `created_by_pi` is set to `source_pi`
- **Idempotent**: Uses MERGE on canonical_id to handle concurrent requests safely
- If entity exists, updates `last_updated` timestamp and adds source PI relationship

**POST /entity/merge** - Atomic merge: absorb source entity into target
- Absorbs source entity into target entity
- Transfers ALL relationships from source to target
- Merges properties
- Deletes source entity after transfer
- **Atomic**: Either completes fully or rolls back (Neo4j transaction)
- Request:
  ```json
  {
    "source_id": "uuid-of-entity-to-delete",
    "target_id": "uuid-of-entity-to-keep"
  }
  ```
- Response (Success):
  ```json
  {
    "success": true,
    "target_id": "uuid-of-entity-to-keep",
    "merged": {
      "properties_transferred": 5,
      "relationships_transferred": 12,
      "source_pis_added": ["pi1", "pi2"]
    }
  }
  ```
- Response (Target Not Found): HTTP 404
  ```json
  {
    "success": false,
    "error": "target_not_found",
    "message": "Target entity does not exist"
  }
  ```
- Response (Source Not Found): HTTP 404
  ```json
  {
    "success": false,
    "error": "source_not_found",
    "message": "Source entity does not exist (may have been merged already)"
  }
  ```

**GET /entity/exists/:canonical_id** - Quick existence check
- Returns whether an entity exists without fetching full data
- Used before merge operations to verify target exists
- Response:
  ```json
  {
    "exists": true
  }
  ```

**GET /entity/:canonical_id** - Get entity by canonical_id
- Fetches entity details by canonical_id
- Returns entity with properties and source_pis
- Response on success:
  ```json
  {
    "found": true,
    "entity": {
      "canonical_id": "...",
      "code": "...",
      "label": "...",
      "type": "...",
      "properties": {...},
      "created_by_pi": "...",
      "source_pis": ["pi1", "pi2", ...]
    }
  }
  ```
- Response when not found:
  ```json
  {
    "found": false
  }
  ```

**DELETE /entity/:canonical_id** - Delete entity and all relationships (cascade delete)
- Deletes entity AND all its relationships using `DETACH DELETE`
- No safety checks - completely removes entity from graph
- Used for cleanup operations where full removal is intended
- Response:
  ```json
  {
    "success": true,
    "canonical_id": "...",
    "deleted": true,
    "relationship_count": 5
  }
  ```

**POST /entity/query** - Query entity by code
- Returns entity details and all relationships
- Includes both incoming and outgoing relationships

**POST /entities/list** - List entities from specific PI(s)
- Supports single PI or multiple PIs
- Optional type filtering
- Deduplicates entities by canonical_id

**POST /entities/lookup-by-code** - Find entities by code with type filtering
- Find all entities with a specific code
- Optional `type` filter: only return entities of this type
- Optional `excludeType` filter: exclude entities of this type
- Use cases:
  - Find placeholders: `{ code: "concert_a", type: "unknown" }`
  - Find real entities: `{ code: "concert_a", excludeType: "unknown" }`
- Request:
  ```json
  {
    "code": "concert_a",
    "type": "unknown",
    "excludeType": "unknown"
  }
  ```
- Response:
  ```json
  {
    "entities": [...],
    "count": 1
  }
  ```

### Lineage Operations

**POST /pi/lineage** - Get full lineage (ancestors and/or descendants) of a PI
- Returns PI nodes in the lineage hierarchy
- Supports three directions: `ancestors`, `descendants`, or `both`
- `maxHops` limits traversal depth per direction
- Request:
  ```json
  {
    "sourcePi": "01KAZ42PYC...",
    "direction": "both",
    "maxHops": 50
  }
  ```
- Response:
  ```json
  {
    "sourcePi": "01KAZ42PYC...",
    "ancestors": {
      "pis": [
        { "id": "01KAZ...", "hops": 1, "created_at": "2025-..." },
        { "id": "01KAY...", "hops": 2, "created_at": "2025-..." }
      ],
      "count": 2,
      "truncated": false
    },
    "descendants": {
      "pis": [
        { "id": "01KAZ...", "hops": 1, "created_at": "2025-..." }
      ],
      "count": 1,
      "truncated": false
    }
  }
  ```
- `truncated: true` indicates more PIs exist beyond maxHops limit
- Use case: Discover full document hierarchy for context/navigation

**POST /entities/find-in-lineage** - Find entity in direct lineage (ancestors/descendants only)
- Given a source PI and list of candidate entity IDs, find candidates in the direct lineage
- **Direct lineage only**: Only matches ancestors (up) or descendants (down)
- **No cousin matching**: Entities in sibling branches (up then down) are NOT matched
- Request:
  ```json
  {
    "sourcePi": "01KAZ42PYC...",
    "candidateIds": ["uuid1", "uuid2", "uuid3"],
    "maxHops": 10
  }
  ```
- Response (found):
  ```json
  {
    "found": true,
    "entity": {
      "canonical_id": "...",
      "code": "concert_a",
      "label": "Concert A",
      "type": "event",
      "properties": {...},
      "created_by_pi": "..."
    },
    "hops": 2,
    "direction": "ancestor"
  }
  ```
- Response (not in lineage):
  ```json
  {
    "found": false
  }
  ```
- Use case: Placeholder resolution - find the real entity in the same document branch

### Relationship Operations

**POST /relationships/create** - Batch create relationships (allows duplicates)
- Creates multiple relationships in one request
- Uses UNWIND for efficient batch processing
- **Note**: Uses CREATE, so calling multiple times creates duplicates
- Use `/relationships/merge` for idempotent behavior

**POST /relationships/merge** - Batch merge relationships (idempotent)
- Idempotent alternative to `/relationships/create`
- Uses MERGE with uniqueness key: `(subject_id, predicate, object_id, source_pi)`
- First call creates relationship, subsequent calls update properties
- Prevents duplicate relationships
- Returns `relationshipsCreated` and `relationshipsUpdated` counts
- **Recommended for orchestrator use**

**GET /relationships/:canonical_id** - Get relationships for a specific entity
- Returns all incoming and outgoing RELATIONSHIP edges for an entity
- Each relationship includes: direction, predicate, target entity info, properties, source_pi
- Response:
  ```json
  {
    "found": true,
    "canonical_id": "...",
    "relationships": [
      {
        "direction": "outgoing",
        "predicate": "affiliated_with",
        "target_id": "...",
        "target_code": "...",
        "target_label": "...",
        "target_type": "...",
        "properties": {...},
        "source_pi": "...",
        "created_at": "..."
      }
    ],
    "total_count": 2
  }
  ```
- Returns `{ found: false }` if entity not found

### Admin Operations

**POST /query** - Execute custom Cypher query
- Allows arbitrary Cypher queries for debugging/testing
- Accepts `query` (required) and `params` (optional)
- Returns results with Neo4j type conversions
- **Safeguard**: Mass delete patterns blocked (`MATCH (n) DETACH DELETE n`)
- Filtered deletes are allowed (`MATCH (n:Entity {id: 'foo'}) DELETE n`)

**POST /admin/clear-test-data** - Clear test data only
- Only deletes nodes where `id` or `canonical_id` contains "test"
- **Safe for production** - will not affect real data
- Tests should use `test-` prefix in all IDs
- Returns count of deleted test nodes and relationships

## Reconciliation Workflow

The reconciliation phase handles merging duplicate entities discovered via Pinecone similarity search.

**Operation Sequence**:
```
1. Check target exists
   GET /entity/exists/{target_id}
   └─ If false: return, try next candidate

2. Decide whether to merge (similarity check / AI review)
   └─ If no: return, try next candidate

3. Execute merge
   POST /entity/merge
   {
     "source_id": "my-uuid",
     "target_id": "their-uuid"
   }
   └─ If 404 (target_not_found): retry from step 1
   └─ If success: proceed to step 4

4. Delete from Pinecone
   DELETE /pinecone/vectors
   {
     "ids": ["my-uuid"]
   }

Done: Entity merged successfully
```

**Race Condition Handling**:
- Neo4j uses pessimistic locking on nodes during writes
- If merge returns 404, target was deleted by concurrent operation
- Retry with backoff → Pinecone search returns new candidate
- Eventually one entity survives

**Consistency Guarantees**:
| Operation | Consistency Level |
|-----------|-------------------|
| Neo4j merge | Strong (ACID transaction) |
| Neo4j exists check | Strong (read committed) |
| Pinecone search | Eventual (may return stale data) |
| Pinecone delete | Eventual (deleted vectors may still appear briefly) |

**Key Insight**: Neo4j is the source of truth. Pinecone inconsistency is handled by always verifying existence in Neo4j before merge.

## Performance Optimizations

**Database Indexes** (added via `npm run add-indexes`):
- `entity_code_idx`: Index on Entity.code for fast hierarchy lookups
- `entity_type_code_idx`: Composite index on (Entity.type, Entity.code) for filtered queries
- `entity_type_idx`: Index on Entity.type for fast PI entity lookups (`type: 'pi'`)

## Testing Strategy

**Test hierarchy**:
1. Neo4j connectivity (`npm test`)
2. Local endpoint tests (`npm run test:endpoints` - requires `npm run dev` in another terminal)
3. Production tests (`npm run test:production`)

**Sample data**:
- Use `npm run populate` to add test data
- Use `npm run explore` to view current data
- Use `npm run cleanup` to remove test data

## Debugging Tips

**Viewing logs**:
```bash
npm run logs          # Tail production logs
wrangler tail --format pretty
```

**Common issues**:
- **Driver not closed**: Always use try/finally in executeQuery
- **Properties not JSON**: All properties fields must be JSON.stringify'd
- **CORS errors**: Ensure all responses include CORS_HEADERS
- **Cypher syntax**: Test queries in Neo4j Browser first

## Deployment

**Prerequisites**:
- Cloudflare account with Wrangler CLI configured
- Neo4j AuraDB instance running
- Secrets configured via `wrangler secret put`

**Deployment process**:
```bash
# Build TypeScript
npx tsc

# Deploy to Cloudflare
npm run deploy
```

**Custom domain**: Configured in wrangler.jsonc routes section (graphdb-gateway.arke.institute)

## Performance Characteristics

- Cold start: ~26ms
- Bundle size: 1.4 MB (186 KB gzipped)
- Max timeout: 30 seconds (configurable in wrangler.jsonc)
- Connection pool: 50 concurrent connections
- Edge locations: Cloudflare global network (300+ cities)

## Security Notes

- TLS/HTTPS encryption on all connections
- Secrets stored in Cloudflare (never in code)
- Neo4j connection uses neo4j+s:// (TLS)
- CORS currently set to `*` - should be restricted for production
- No authentication layer - should be added for production use
