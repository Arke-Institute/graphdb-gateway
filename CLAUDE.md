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
npm run test:race           # Test concurrent operations for race conditions

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
│   ├── entity.ts        # Entity CRUD (create, merge, query, list, delete, get)
│   ├── hierarchy.ts     # Hierarchy lookups (find-in-hierarchy, entities/hierarchy)
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

**Benefits of this structure**:
- Separation of concerns (each file focuses on one domain)
- Easier testing (can test handlers independently)
- Better type organization (types grouped by feature)
- Reusable utilities (response helpers, validation)
- Scalability (easy to add new endpoints)

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

**PI Nodes** (Processed Items in the hierarchy):
```cypher
(:PI {
  id: string,          // ULID identifier
  created_at: datetime,
  indexed_at: datetime
})
```

**Entity Nodes**:
```cypher
(:Entity {
  canonical_id: string,         // UUID (primary identifier)
  code: string,                 // Human-readable code
  label: string,                // Display name
  type: string,                 // Entity type (person, event, date, file, etc.)
  properties: string,           // JSON-serialized map
  created_by_pi: string,        // PI that created this entity (immutable)
  first_seen: datetime,
  last_updated: datetime
})
```

**Entity Subtypes** (applied as additional labels):
- `(:Entity:Date)` - Date entities
- `(:Entity:File)` - File entities

### Relationship Types

**PI Hierarchy**:
```cypher
(:PI)-[:PARENT_OF]->(:PI)
(:PI)-[:CHILD_OF]->(:PI)
```

**Entity Extraction**:
```cypher
(:Entity)-[:EXTRACTED_FROM {
  original_code: string,
  extracted_at: datetime
}]->(:PI)
```

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

**Placeholder Entities**:
- `type: "unknown"` indicates an unresolved placeholder entity
- Empty `properties: "{}"` for placeholders without data
- Placeholders are created during entity linking when a referenced entity hasn't been fully resolved yet

**Properties Storage**:
- All `properties` fields are JSON strings, not native Neo4j maps
- Always use `JSON.stringify()` when writing, `JSON.parse()` when reading
- Example: `properties: JSON.stringify({ role: "researcher" })`

**Entity Creator Tracking (`created_by_pi`)**:
- `created_by_pi` tracks which PI first created the canonical entity record
- Set once during `/entity/create`, never modified by any merge operation
- **Immutable** across all merge strategies (enrich_placeholder, merge_peers, link_only, prefer_new)
- Different from `source_pis` (via EXTRACTED_FROM relationships), which tracks all PIs that mention this entity
- Provides O(1) lookup of entity creator (faster than relationship traversal)
- Use cases:
  - Auditing: "which pipeline run created this entity?"
  - Debugging: trace entity lifecycle back to origin
  - Future: permissions, quotas, conflict resolution based on creator

**Semantics**:
- Creator = "who created the canonical entity record" (even if it was a placeholder)
- When enriching a placeholder, `created_by_pi` remains the placeholder creator
- When merging peers, `created_by_pi` remains the first entity's creator
- EXTRACTED_FROM relationships track the full contribution history

**Concurrency Safety**:
- Entity creation uses `MERGE` on `canonical_id` (not `CREATE`) for atomic idempotency
- The unique constraint on `canonical_id` prevents duplicate entities under concurrent load
- Multiple concurrent requests with the same `canonical_id` will:
  - First request: creates the entity (ON CREATE)
  - Subsequent requests: match existing entity (ON MATCH)
  - All requests succeed with HTTP 200 (idempotent behavior)
- This pattern eliminates race conditions where multiple workers try to create the same entity
- See `tests/test-concurrent-race.js` for comprehensive concurrency tests

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
MERGE (p:PI {id: $pi})
ON CREATE SET p.created_at = datetime()
ON MATCH SET p.indexed_at = datetime()
```

**UNWIND for batch operations**:
```cypher
UNWIND $relationships AS rel
MATCH (subject:Entity {canonical_id: rel.subject_id})
MATCH (object:Entity {canonical_id: rel.object_id})
CREATE (subject)-[:RELATIONSHIP {...}]->(object)
```

**Deduplication with COLLECT**:
```cypher
MATCH (pi:PI)<-[:EXTRACTED_FROM]-(e:Entity)
WHERE pi.id IN $pis
WITH e, collect(DISTINCT pi.id) AS source_pis
RETURN DISTINCT e.canonical_id, ..., source_pis
```

## Entity Linking Architecture

### Division of Responsibilities

**Orchestrator** (external service calling this API):
- Decides whether to merge, create, or enrich entities
- Semantic similarity scoring (via Pinecone)
- Resolves ALL entity references from properties
- Generates canonical IDs (UUIDs)
- Workflow orchestration

**GraphDB Gateway** (this service):
- Simple storage and retrieval of entities
- Execute property merging with conflict resolution
- Track source PIs via EXTRACTED_FROM relationships
- Query parent/child entity hierarchies
- Database constraints and validation

**Key Principle**: The orchestrator handles all decision-making logic; the Graph API is a data layer.

### Entity Reference Resolution

Entity references can appear in properties:
```json
{
  "properties": {
    "when": {"type": "entity_ref", "code": "date_1864"}
  }
}
```

**Important**: The orchestrator resolves these references BEFORE calling `/entity/create`:
1. Orchestrator extracts entity refs from properties
2. Resolves each reference to a canonical_id
3. Removes entity refs from properties (creates "clean" properties)
4. Calls `/entity/create` with clean properties
5. Calls `/relationships/create` separately for the resolved references

**The Graph API does NOT auto-resolve entity references** - it only stores what it receives.

## API Endpoints

### PI Operations

**POST /pi/create** - Create PI node with parent-child relationships
- Creates or updates a PI node
- Optionally links to parent and/or children PIs
- Idempotent (uses MERGE)

### Entity Operations

**POST /entity/create** - Create new entity (idempotent via MERGE)
- Simple storage (does NOT resolve entity refs)
- Accepts clean properties only
- Creates EXTRACTED_FROM relationship to source PI
- **Idempotent**: Uses MERGE on canonical_id to handle concurrent requests safely
- If entity exists, updates `last_updated` timestamp and adds source PI relationship
- All concurrent requests with same canonical_id succeed (no 409 errors)
- First request creates (ON CREATE), subsequent requests match (ON MATCH)

**POST /entity/merge** - Merge entity with existing entity
- Supports 4 merge strategies:
  - `enrich_placeholder`: Upgrade placeholder (type="unknown") to rich entity
  - `merge_peers`: Merge two rich entities with conflict resolution (accumulates values into arrays)
  - `link_only`: Just add source PI relationship, no data changes
  - `prefer_new`: Overwrite existing data with new data
- **Optional**: `absorb_duplicate_id` parameter to absorb a duplicate entity using APOC
  - When provided, uses `apoc.refactor.mergeNodes` to atomically:
    - Transfer all relationships from duplicate to canonical entity
    - Delete the duplicate entity
    - Preserve all relationship properties
  - Properties are kept from canonical entity (not merged)
  - Used by orchestrator cleanup phase for entity deduplication
- Request body example (with absorption):
  ```json
  {
    "canonical_id": "canonical-entity-id",
    "enrichment_data": {
      "new_properties": {},
      "merge_strategy": "merge_peers"
    },
    "source_pi": "pi-id",
    "absorb_duplicate_id": "duplicate-entity-id"  // Optional
  }
  ```
- Response (with absorption):
  ```json
  {
    "canonical_id": "...",
    "updated": true,
    "absorbed_duplicate": "duplicate-entity-id"
  }
  ```
- Returns conflict information when merging peers (without absorption)

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
    "relationship_count": 5  // Number of relationships deleted
  }
  ```

**GET /entity/:canonical_id** - Get entity by canonical_id
- Fetches entity details by canonical_id
- Returns entity with properties and source_pis
- Used by orchestrator cleanup phase to fetch entity details for embedding generation
- Request: GET /entity/{canonical_id}
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

**POST /entity/lookup/code** - Lookup entity by code
- Fast lookup using indexed code field
- Request:
  ```json
  {
    "code": "nick_chimicles"
  }
  ```
- Response on success:
  ```json
  {
    "found": true,
    "entity": {
      "canonical_id": "...",
      "code": "nick_chimicles",
      "label": "Nick Chimicles",
      "type": "person",
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

**POST /entity/lookup/label** - Lookup entities by label and type
- Case-insensitive label matching
- Requires both label and type
- Can return multiple entities (if same label exists)
- Request:
  ```json
  {
    "label": "Nick Chimicles",
    "type": "person"
  }
  ```
- Response:
  ```json
  {
    "found": true,
    "entities": [
      {
        "canonical_id": "...",
        "code": "nick_chimicles",
        "label": "Nick Chimicles",
        "type": "person",
        "properties": {...},
        "created_by_pi": "...",
        "source_pis": ["pi1", "pi2", ...]
      }
    ]
  }
  ```
- Response when not found:
  ```json
  {
    "found": false,
    "entities": []
  }
  ```

**POST /entity/query** - Query entity by code
- Returns entity details and all relationships
- Includes both incoming and outgoing relationships

**POST /entities/list** - List entities from specific PI(s)
- Supports single PI or multiple PIs
- Optional type filtering
- Deduplicates entities by canonical_id

### Hierarchy Operations

**POST /entity/find-in-hierarchy** - Find entity in parent/child hierarchy
- Search in parents, children, or both
- Returns first match found
- Includes placeholder detection (`is_placeholder` flag)
- Used by orchestrator for entity resolution

**POST /entities/hierarchy** - Bulk fetch entities from hierarchy
- Get all entities from ancestors, descendants, or both
- Optional type exclusion (e.g., exclude "file" entities)
- Optional placeholder filtering
- Deduplicates by canonical_id
- Returns counts (from_parents, from_children)
- Used by orchestrator in SETUP phase for caching

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

**GET /relationships** - List all relationships
- Returns all RELATIONSHIP edges in the database
- Includes subject_id, predicate, object_id, properties, source_pi
- Ordered by created_at descending
- Used for debugging and testing

### Admin Operations

**POST /query** - Execute custom Cypher query
- Allows arbitrary Cypher queries for debugging/testing
- Accepts `query` (required) and `params` (optional)
- Returns results with Neo4j type conversions
- **Use with caution** - no query validation

**POST /admin/clear** - Clear all data from database
- Deletes all nodes and relationships
- **Destructive operation** - use only for testing
- Returns count of deleted nodes and relationships
- Used for cleanup between test runs

### Merge Strategies Explained

#### enrich_placeholder
**When to use**: Upgrading a placeholder to a rich entity

```typescript
// Before: { type: "unknown", properties: {} }
// After:  { type: "person", properties: { role: "researcher" } }
```

**Behavior**:
- Validates entity is a placeholder (type === "unknown")
- Updates type to new type
- Replaces empty properties with new properties
- Adds source PI relationship

#### merge_peers
**When to use**: Merging two entities that both have real data

```typescript
// Existing: { properties: { role: "president" } }
// New:      { properties: { role: "general", location: "Virginia" } }
// Result:   { properties: { role: ["president", "general"], location: "Virginia" } }
```

**Behavior**:
- For conflicting properties: accumulate into array
- For new properties: add them
- Returns conflict details in response
- Adds source PI relationship

**Concurrency Safety (Optimistic Locking)**:
- Uses `_version` field on entities to detect concurrent modifications
- Pattern: read version → compute merge → conditional write (only if version unchanged)
- If version mismatch detected, retries with exponential backoff (up to 20 attempts)
- Backoff: `100ms * 1.5^attempt` (capped at 2s) + random jitter
- Returns 409 if all retries exhausted (very rare under normal load)
- Why not single-query APOC? Neo4j's READ COMMITTED isolation allows concurrent transactions to read stale data, so optimistic locking is required regardless
- Test: `npm run test:race` and `tests/test-merge-peers-concurrent.js`

#### link_only
**When to use**: Just linking a PI to existing entity

**Behavior**:
- NO data changes (type, label, properties unchanged)
- Only adds EXTRACTED_FROM relationship
- Updates timestamp

#### prefer_new
**When to use**: Overwriting existing data (rarely used)

**Behavior**:
- Replaces properties with new ones
- Updates type/label if provided
- Adds source PI relationship

### Cleanup Phase Workflow

The cleanup phase handles merging duplicate entities discovered after Pinecone propagation. This is the **final** phase of entity linking.

**Workflow**:
1. Orchestrator identifies duplicate entities via Pinecone similarity search
2. For each duplicate pair:
   - Call `POST /entity/merge` with `absorb_duplicate_id` to atomically transfer relationships and delete duplicate
   - (Alternative) If the duplicate needs to be fully removed without merging, call `DELETE /entity/:canonical_id` directly

**Example (merge with absorption using APOC)**:
```typescript
// Single API call to merge entities (using APOC mergeNodes)
const mergeResult = await graphdb.mergeEntity({
  canonical_id: canonicalEntity.canonical_id,     // Entity being kept
  enrichment_data: {
    new_properties: {},
    merge_strategy: 'merge_peers'
  },
  source_pi: currentPI,
  absorb_duplicate_id: duplicateEntity.canonical_id  // Entity being absorbed
});

// Result: duplicate entity is gone, all relationships transferred
```

**Example (direct delete)**:
```typescript
// For entities that just need to be removed completely
await graphdb.deleteEntity(duplicateEntity.canonical_id);
// Deletes entity + all relationships (cascade delete)
```

**Key Features**:
- **Atomicity**: APOC mergeNodes operation is all-or-nothing (Neo4j transaction)
- **Simplicity**: Single API call instead of two-step redirect + delete
- **Battle-tested**: Uses Neo4j's official APOC library for node merging
- **Provenance preservation**: EXTRACTED_FROM edges automatically transferred to canonical entity
- **Relationship preservation**: All domain relationships transferred with properties intact
- **Cascade delete**: DELETE operation removes entity and all relationships in one step

**Error Handling**:
- If merge with absorption fails mid-operation, Neo4j rolls back (nothing changed)
- All operations return detailed error information for debugging

**Performance**:
- Simple merge (2-3 relationships): 50-100ms
- Complex merge (10+ relationships): 200-300ms
- Expected cleanup volume: 5-10 merges per orchestrator run

### Performance Optimizations

**Database Indexes** (added via `npm run add-indexes`):
- `entity_code_idx`: Index on Entity.code for fast hierarchy lookups
- `entity_type_code_idx`: Composite index on (Entity.type, Entity.code) for filtered queries

These indexes significantly improve performance for:
- `/entity/find-in-hierarchy` (code lookups)
- `/entities/hierarchy` (filtered queries)
- Entity resolution during orchestration

**Caching Strategy**:
- Orchestrator caches parent/child entity indexes in SETUP phase
- Uses `/entities/hierarchy` to bulk fetch entities once
- Avoids redundant API calls during RESOLVING phase

## Testing Strategy

**Test hierarchy**:
1. Neo4j connectivity (`npm test`)
2. Local endpoint tests (`npm run test:endpoints` - requires `npm run dev` in another terminal)
3. Concurrent race condition tests (`npm run test:race` - validates MERGE-based idempotency)
4. Production tests (`npm run test:production`)

**Concurrency Tests** (`npm run test:race`):
- Test 1: Concurrent entity creation with same canonical_id
- Test 2: Read-check-create pattern validation
- Test 3: Concurrent property merges on same entity
- Test 4: Mixed read/write operations
- Test 5: High-volume stress test (50 concurrent entities)
- All tests validate that MERGE on canonical_id prevents duplicates

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
