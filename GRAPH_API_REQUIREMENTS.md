# Graph API Requirements: Placeholder Entity Resolution

## Overview

This document specifies the new and enhanced endpoints required from the Graph DB API to support placeholder entity resolution and parent/child entity hierarchy checking in the orchestrator.

---

## Division of Responsibilities

### Orchestrator (Decision Layer)
**What the orchestrator does**:
- ✅ Decide whether to merge, create, or enrich entities
- ✅ Semantic similarity scoring (via Pinecone)
- ✅ AI review invocation for borderline cases
- ✅ Generate canonical IDs for new entities (UUIDs)
- ✅ **Resolve ALL entity references** (properties + relationships)
- ✅ **Extract entity refs from properties and create relationships**
- ✅ **Use cached parent/child entity indexes** (no redundant lookups)
- ✅ Workflow orchestration (phases)
- ✅ Retry logic and error handling
- ✅ Batch processing coordination

**What the orchestrator does NOT do**:
- ❌ Query Neo4j directly
- ❌ Execute property merging logic
- ❌ Track source PIs in database
- ❌ Implement conflict resolution strategies in database

### Graph API (Data Layer)
**What the Graph API does**:
- ✅ Store and retrieve entities from Neo4j
- ✅ Execute property merging with conflict resolution
- ✅ Track source PIs via EXTRACTED_FROM relationships
- ✅ Query parent/child entity hierarchies
- ✅ Detect placeholder entities (type="unknown")
- ✅ Batch operations for performance
- ✅ Database constraints and validation

**What the Graph API does NOT do**:
- ❌ Make merge vs create decisions
- ❌ Perform semantic similarity comparisons
- ❌ Call AI review services
- ❌ Generate canonical IDs for new entities
- ❌ **Resolve entity references** (orchestrator handles this)
- ❌ **Auto-extract entity refs from properties** (orchestrator does this)
- ❌ Workflow orchestration

---

## Entity Reference Resolution Strategy

### Overview

Entity references (`@entity_code` or `{"type": "entity_ref", "code": "..."}`) appear in two contexts:

1. **In entity properties**: `{"when": {"type": "entity_ref", "code": "date_1864"}}`
2. **In relationships**: `{subject: "fire_event", object: "marshall_street"}`

### Architecture Decision

**Orchestrator resolves ALL entity references** using a unified resolution strategy:

```
1. Check resolved entities map (already resolved in RESOLVING phase)
2. Check cached child_entities_index (from SETUP phase)
3. Check cached parent_entities_index (from SETUP phase)
4. Semantic search globally (Pinecone)
5. Create placeholder entity (type: "unknown")
```

**Benefits**:
- ✅ Single resolution logic for all entity refs
- ✅ Consistent hierarchy-first strategy
- ✅ Uses cached indexes (no redundant API calls)
- ✅ Clean separation: orchestrator = logic, Graph API = storage

### Data Flow

**SETUP Phase**:
```
Orchestrator:
  ├─ Fetch parent entities → cache in parent_entities_index
  └─ Fetch child entities → cache in child_entities_index
```

**RESOLVING Phase**:
```
For each entity:
  ├─ Resolve entity itself (hierarchy → semantic → create)
  ├─ Extract entity_refs from properties
  ├─ For each ref:
  │   ├─ Resolve using cached indexes (no API calls!)
  │   └─ Store canonical_id
  ├─ Create entity with CLEAN properties (refs removed)
  └─ Create relationships for resolved refs

Graph API:
  └─ Simple storage (no entity ref handling)
```

**LINKING Phase**:
```
For each relationship:
  ├─ Resolve subject/object using SAME logic
  │   └─ Uses cached indexes!
  └─ Create relationship

Graph API:
  └─ Create relationship between canonical IDs
```

### Example

**Input entity**:
```json
{
  "code": "fire_event",
  "properties": {
    "when": {"type": "entity_ref", "code": "date_1864_04"},
    "where": {"type": "entity_ref", "code": "marshall_street"},
    "damage": "severe"
  }
}
```

**Orchestrator processing**:
1. Resolve `date_1864_04` → check child index → found: `uuid-date-123`
2. Resolve `marshall_street` → check child index → not found → check parent index → found: `uuid-loc-456`
3. Create entity with clean properties:
   ```json
   {
     "canonical_id": "uuid-event-789",
     "code": "fire_event",
     "properties": {
       "damage": "severe"
     }
   }
   ```
4. Create relationships:
   ```
   (uuid-event-789)-[:HAS_WHEN]->(uuid-date-123)
   (uuid-event-789)-[:HAS_WHERE]->(uuid-loc-456)
   ```

**Graph API receives**:
- Entity create request with clean properties
- Relationships create request with resolved canonical IDs

---

## New Endpoints Required

### 1. Find Entity in Hierarchy

**Purpose**: Find an entity by code/label in parent or child PIs

**Endpoint**: `POST /entity/find-in-hierarchy`

**Request**:
```typescript
interface FindInHierarchyRequest {
  pi: string;                         // Current PI ID
  code: string;                       // Entity code to find
  search_scope: 'parents' | 'children' | 'both';
  include_placeholder?: boolean;      // Include type="unknown" entities (default: true)
}
```

**Response**:
```typescript
interface FindInHierarchyResponse {
  found: boolean;
  entity?: {
    canonical_id: string;
    code: string;
    label: string;
    type: string;                     // "unknown" if placeholder
    properties: Record<string, any>;
    source_pis: string[];             // All PIs that extracted this entity
    is_placeholder: boolean;          // Computed: type === "unknown" && properties empty
  };
  found_in?: 'parent' | 'child';     // Where was it found?
}
```

**Behavior**:
- If `search_scope` is `"parents"`: Traverse UP the PI hierarchy (parent, grandparent, etc.)
- If `search_scope` is `"children"`: Traverse DOWN to all child PIs
- If `search_scope` is `"both"`: Check both directions
- Return FIRST match found (prioritize children over parents if both specified)
- Match by exact `code` field
- Include entities with `type="unknown"` (placeholders) unless explicitly excluded

**Neo4j Query Pattern**:
```cypher
// For parent search
MATCH (current:PI {id: $pi})
MATCH (current)-[:HAS_PARENT*]->(ancestor:PI)
MATCH (ancestor)<-[:EXTRACTED_FROM]-(entity:Entity {code: $code})
RETURN entity
LIMIT 1

// For children search
MATCH (current:PI {id: $pi})
MATCH (current)<-[:HAS_PARENT*]-(descendant:PI)
MATCH (descendant)<-[:EXTRACTED_FROM]-(entity:Entity {code: $code})
RETURN entity
LIMIT 1
```

**Example Request**:
```json
{
  "pi": "01KA1H53CP8Y9V2XQN5Z3R7M4E",
  "code": "george_washington",
  "search_scope": "both"
}
```

**Example Response (placeholder found)**:
```json
{
  "found": true,
  "entity": {
    "canonical_id": "uuid-placeholder-001",
    "code": "george_washington",
    "label": "George Washington",
    "type": "unknown",
    "properties": {},
    "source_pis": ["01KA1H51YC...", "01KA1H5VGR..."],
    "is_placeholder": true
  },
  "found_in": "parent"
}
```

**Example Response (rich entity found)**:
```json
{
  "found": true,
  "entity": {
    "canonical_id": "uuid-123",
    "code": "george_washington",
    "label": "George Washington",
    "type": "person",
    "properties": {
      "role": "first president",
      "birth_date": "1732-02-22"
    },
    "source_pis": ["01KA1H63MP..."],
    "is_placeholder": false
  },
  "found_in": "child"
}
```

**Example Response (not found)**:
```json
{
  "found": false
}
```

---

### 2. Get Entities from Hierarchy

**Purpose**: Bulk fetch all entities from parent/child PIs (for indexing in SETUP phase)

**Endpoint**: `POST /entities/hierarchy`

**Request**:
```typescript
interface GetEntitiesFromHierarchyRequest {
  pi: string;                         // Current PI ID
  direction: 'ancestors' | 'descendants' | 'both';
  exclude_type?: string[];            // Types to exclude (e.g., ["file"])
  include_placeholders?: boolean;     // Include type="unknown" (default: true)
}
```

**Response**:
```typescript
interface GetEntitiesFromHierarchyResponse {
  entities: Array<{
    canonical_id: string;
    code: string;
    label: string;
    type: string;
    properties: Record<string, any>;
    source_pi: string;                // PRIMARY source PI (first to extract)
    all_source_pis: string[];         // All PIs that extracted this
    is_placeholder: boolean;
  }>;
  total_count: number;
  from_parents: number;               // How many came from parents
  from_children: number;              // How many came from children
}
```

**Behavior**:
- `direction: "ancestors"`: Get entities from parent chain (parent, grandparent, etc.)
- `direction: "descendants"`: Get entities from all child/grandchild PIs
- `direction: "both"`: Get from entire hierarchy
- Deduplicate entities (same canonical_id may appear in multiple PIs)
- Exclude specified types (e.g., "file" entities)
- Return up to 10,000 entities (pagination if needed)

**Neo4j Query Pattern**:
```cypher
// For ancestors
MATCH (current:PI {id: $pi})
MATCH (current)-[:HAS_PARENT*]->(ancestor:PI)
MATCH (ancestor)<-[:EXTRACTED_FROM]-(entity:Entity)
WHERE NOT entity.type IN $exclude_types
RETURN DISTINCT entity, ancestor.id as source_pi

// For descendants
MATCH (current:PI {id: $pi})
MATCH (current)<-[:HAS_PARENT*]-(descendant:PI)
MATCH (descendant)<-[:EXTRACTED_FROM]-(entity:Entity)
WHERE NOT entity.type IN $exclude_types
RETURN DISTINCT entity, descendant.id as source_pi
```

**Example Request**:
```json
{
  "pi": "01KA1H53CP8Y9V2XQN5Z3R7M4E",
  "direction": "both",
  "exclude_type": ["file"],
  "include_placeholders": true
}
```

**Example Response**:
```json
{
  "entities": [
    {
      "canonical_id": "uuid-123",
      "code": "george_washington",
      "label": "George Washington",
      "type": "person",
      "properties": {"role": "first president"},
      "source_pi": "01KA1H63MP...",
      "all_source_pis": ["01KA1H63MP...", "01KA1H5VGR..."],
      "is_placeholder": false
    },
    {
      "canonical_id": "uuid-placeholder-001",
      "code": "albany",
      "label": "Albany",
      "type": "unknown",
      "properties": {},
      "source_pi": "01KA1H51YC...",
      "all_source_pis": ["01KA1H51YC..."],
      "is_placeholder": true
    }
  ],
  "total_count": 2,
  "from_parents": 1,
  "from_children": 1
}
```

---

### 3. Enhanced Entity Merge with Enrichment

**Purpose**: Support different merge strategies (enrich placeholder, merge peers, link only)

**Endpoint**: `POST /entity/merge` (ENHANCED)

**Request**:
```typescript
interface MergeEntityRequest {
  canonical_id: string;               // Existing entity ID
  enrichment_data: {
    type?: string;                    // NEW: Upgrade type (for placeholders)
    label?: string;                   // NEW: Refine label
    new_properties: Record<string, any>;
    merge_strategy: MergeStrategy;    // NEW: How to merge
  };
  source_pi: string;                  // PI adding this merge
}

type MergeStrategy =
  | 'enrich_placeholder'              // Upgrade unknown→typed, empty→propertied
  | 'merge_peers'                     // Merge two rich entities with conflict resolution
  | 'link_only'                       // Just add PI to EXTRACTED_FROM (no data changes)
  | 'prefer_new';                     // Overwrite with incoming data
```

**Response**:
```typescript
interface MergeEntityResponse {
  canonical_id: string;
  updated: boolean;
  conflicts?: Array<{                 // If conflicts occurred during merge
    property: string;
    existing_value: any;
    new_value: any;
    resolution: 'accumulated' | 'kept_existing' | 'preferred_new';
  }>;
}
```

**Behavior by Strategy**:

#### `enrich_placeholder`
- **When to use**: Upgrading a placeholder to a rich entity
- **Logic**:
  1. Check if `existing.type === "unknown"` (validate it's actually a placeholder)
  2. Update `type` field to provided type
  3. Update `label` if provided
  4. **Replace** empty properties with new properties (don't merge, just set)
  5. Add source PI to EXTRACTED_FROM

**Neo4j**:
```cypher
MATCH (entity:Entity {canonical_id: $canonical_id})
WHERE entity.type = 'unknown'
SET entity.type = $new_type,
    entity.label = COALESCE($new_label, entity.label),
    entity.properties = $new_properties,
    entity.updated_at = timestamp()
MERGE (pi:PI {id: $source_pi})
MERGE (pi)<-[:EXTRACTED_FROM]-(entity)
RETURN entity
```

#### `merge_peers`
- **When to use**: Merging two entities that both have real data
- **Logic**:
  1. For each property in `new_properties`:
     - If key doesn't exist in existing: **Add it**
     - If key exists with same value: **Keep it**
     - If key exists with different value: **Apply conflict resolution**
  2. Add source PI to EXTRACTED_FROM

**Conflict Resolution Strategies**:
```typescript
// Strategy 1: Accumulate into array (for multi-valued fields)
// Before: { roles: "president" }
// After:  { roles: ["president", "general"] }

// Strategy 2: Track provenance (keep both with sources)
// Before: { birth_year: 1732 }
// After:  { birth_year: { values: [
//           { value: 1732, sources: ["PI_001"] },
//           { value: 1731, sources: ["PI_002"] }
//         ]}}

// Strategy 3: Prefer most specific (longest string)
// Before: { description: "US President" }
// After:  { description: "First US President, military general" }

// Strategy 4: Keep existing (default for conflicts)
```

**Neo4j** (using APOC):
```cypher
MATCH (entity:Entity {canonical_id: $canonical_id})
SET entity.properties = apoc.map.mergeList([
  entity.properties,
  $new_properties
])  // Custom merge logic with conflict tracking
SET entity.updated_at = timestamp()
MERGE (pi:PI {id: $source_pi})
MERGE (pi)<-[:EXTRACTED_FROM]-(entity)
RETURN entity
```

#### `link_only`
- **When to use**: Just linking a PI to existing entity (no data changes)
- **Logic**:
  1. Add source PI to EXTRACTED_FROM
  2. Do NOT modify type, label, or properties
  3. Update timestamp

**Neo4j**:
```cypher
MATCH (entity:Entity {canonical_id: $canonical_id})
MERGE (pi:PI {id: $source_pi})
MERGE (pi)<-[:EXTRACTED_FROM]-(entity)
SET entity.updated_at = timestamp()
RETURN entity
```

#### `prefer_new`
- **When to use**: Overwrite existing data with new data (rarely used)
- **Logic**:
  1. Replace properties with new_properties
  2. Update type/label if provided
  3. Add source PI

**Example Request (enrich placeholder)**:
```json
{
  "canonical_id": "uuid-placeholder-001",
  "enrichment_data": {
    "type": "person",
    "label": "George Washington",
    "new_properties": {
      "role": "first president",
      "birth_date": "1732-02-22"
    },
    "merge_strategy": "enrich_placeholder"
  },
  "source_pi": "01KA1H63MP..."
}
```

**Example Response**:
```json
{
  "canonical_id": "uuid-placeholder-001",
  "updated": true
}
```

**Example Request (merge peers with conflict)**:
```json
{
  "canonical_id": "uuid-123",
  "enrichment_data": {
    "new_properties": {
      "role": "military general",      // Conflict: already has "first president"
      "birth_place": "Virginia"        // New: doesn't exist yet
    },
    "merge_strategy": "merge_peers"
  },
  "source_pi": "01KA1H5VGR..."
}
```

**Example Response**:
```json
{
  "canonical_id": "uuid-123",
  "updated": true,
  "conflicts": [
    {
      "property": "role",
      "existing_value": "first president",
      "new_value": "military general",
      "resolution": "accumulated"     // Now: ["first president", "military general"]
    }
  ]
}
```

---

### 4. Entity Create (Simple Storage)

**Endpoint**: `POST /entity/create`

**Purpose**: Store an entity node in Neo4j with EXTRACTED_FROM relationship to PI

**Behavior**:
- Creates entity node with provided data
- Creates `EXTRACTED_FROM` relationship to source PI
- **Does NOT** resolve entity references (orchestrator does this)
- **Does NOT** auto-extract entity refs from properties
- **Does NOT** create entity ref relationships
- Simple storage only - orchestrator handles all resolution logic

**Request**:
```typescript
interface CreateEntityRequest {
  canonical_id: string;               // UUID generated by orchestrator
  code: string;
  label: string;
  type: string;                       // Use "unknown" for placeholders
  properties: Record<string, any>;    // Clean properties (no entity_refs)
  source_pi: string;
}
```

**Important**:
- Properties should NOT contain entity_refs - orchestrator resolves these BEFORE calling this endpoint
- Entity refs are resolved separately by orchestrator and relationships created via `/relationships/create`

**Placeholder Convention**:
- `type: "unknown"` indicates this is a placeholder
- `properties: {}` (empty) for placeholders
- Label inferred from code (e.g., "george_washington" → "George Washington")

**Example (entity creation)**:
```json
{
  "canonical_id": "uuid-123",
  "code": "fire_event",
  "label": "Fire at Marshall Street",
  "type": "event",
  "properties": {
    "time": "2:15pm",
    "damage": "severe"
  },
  "source_pi": "01KA1H53CP..."
}
```

**Example (placeholder creation)**:
```json
{
  "canonical_id": "uuid-placeholder-456",
  "code": "thomas_jefferson",
  "label": "Thomas Jefferson",
  "type": "unknown",
  "properties": {},
  "source_pi": "01KA1H53CP..."
}
```

**Note**: If the original entity had entity_refs like `{"when": {"type": "entity_ref", "code": "date_1864"}}`, the orchestrator:
1. Resolves "date_1864" to canonical_id
2. Removes entity_ref from properties
3. Creates entity with clean properties
4. Creates relationship `(entity)-[:HAS_WHEN]->(date_entity)` separately

---

## Existing Endpoints (No Changes)

These endpoints remain unchanged:

### `POST /pi/create`
- Create PI node with parent-child relationships
- No changes needed

### `POST /entities/list`
- List entities from specific PIs
- No changes needed
- **Note**: This is used in current SETUP phase, will be REPLACED by `/entities/hierarchy` for better performance

### `POST /relationships/create`
- Batch create relationships
- No changes needed

---

## Database Schema Changes

### Entity Node

**Current**:
```cypher
(:Entity {
  canonical_id: string,
  code: string,
  label: string,
  type: string,
  properties: map
})
```

**No changes to schema**, but add convention:
- `type: "unknown"` = placeholder entity
- Empty `properties: {}` = placeholder without data

### Indexes Needed

**Add index on `code` field** for fast hierarchy lookups:
```cypher
CREATE INDEX entity_code_idx FOR (e:Entity) ON (e.code);
```

**Add composite index for type queries**:
```cypher
CREATE INDEX entity_type_code_idx FOR (e:Entity) ON (e.type, e.code);
```

### EXTRACTED_FROM Relationship

**No changes needed** - already tracks which PIs extracted each entity

---

## Performance Considerations

### 1. Hierarchy Traversal
- **Concern**: Traversing parent/child chains could be slow for deep hierarchies
- **Solution**:
  - Use `[:HAS_PARENT*1..5]` to limit depth (max 5 levels)
  - Cache parent/child relationships in orchestrator
  - Index on PI relationships

### 2. Bulk Entity Fetching
- **Concern**: `/entities/hierarchy` could return thousands of entities
- **Solution**:
  - Implement pagination (e.g., 1000 entities per page)
  - Add filters (by type, exclude placeholders, etc.)
  - Return lightweight response (only essential fields)
  - **Note**: Orchestrator caches these entities locally, so only called once in SETUP phase

### 3. Property Merging
- **Concern**: Conflict resolution could be complex/slow
- **Solution**:
  - Implement simple strategies first (accumulate, keep existing)
  - Add complexity later based on needs
  - Log conflicts for analysis

---

## Error Handling

### Error Codes

| Code | Description | When to Return |
|------|-------------|----------------|
| `ENTITY_NOT_FOUND` | Entity with canonical_id doesn't exist | Merge/update non-existent entity |
| `NOT_A_PLACEHOLDER` | Tried to enrich entity that isn't a placeholder | `enrich_placeholder` on rich entity |
| `PI_NOT_FOUND` | PI doesn't exist in database | Invalid PI ID in request |
| `INVALID_MERGE_STRATEGY` | Unknown merge strategy | Invalid strategy string |
| `HIERARCHY_NOT_FOUND` | No parent/child PIs exist | Search hierarchy when none exists |
| `BATCH_TOO_LARGE` | Too many items in batch request | >1000 refs in resolve call |

**Example Error Response**:
```json
{
  "error": "NOT_A_PLACEHOLDER",
  "message": "Entity uuid-123 has type 'person', cannot use enrich_placeholder strategy",
  "canonical_id": "uuid-123",
  "actual_type": "person"
}
```

---

## Testing Requirements

### Test Scenarios

**Scenario 1: Find placeholder in parent**
- Parent creates placeholder for `george_washington`
- Child calls `/entity/find-in-hierarchy` with `search_scope: "parents"`
- Should return placeholder with `is_placeholder: true`

**Scenario 2: Find rich entity in child**
- Child creates rich entity for `george_washington`
- Parent calls `/entity/find-in-hierarchy` with `search_scope: "children"`
- Should return rich entity with `is_placeholder: false`

**Scenario 3: Enrich placeholder**
- Placeholder exists with `type: "unknown"`, `properties: {}`
- Call `/entity/merge` with `merge_strategy: "enrich_placeholder"`
- Should update type, label, and properties

**Scenario 4: Merge peers with conflicts**
- Entity exists with `properties: { role: "president" }`
- Call `/entity/merge` with `merge_strategy: "merge_peers"`, `new_properties: { role: "general" }`
- Should accumulate: `{ role: ["president", "general"] }`

**Scenario 5: Link only**
- Entity exists from PI_001
- Call `/entity/merge` with `merge_strategy: "link_only"` from PI_002
- Should add EXTRACTED_FROM edge but not modify properties

**Scenario 6: Bulk entity fetch**
- Parent has 50 entities, child has 30 entities
- Call `/entities/hierarchy` with `direction: "both"`
- Should return 80 deduplicated entities

---

## API Documentation Format

Please provide OpenAPI (Swagger) documentation for all endpoints with:
- Request/response schemas
- Example requests and responses
- Error codes and messages
- Authentication requirements
- Rate limits (if any)

---

## Migration Plan

### Phase 1: Add New Endpoints (Non-Breaking)
1. Implement `/entity/find-in-hierarchy`
2. Implement `/entities/hierarchy`
3. Implement `/entity-ref/resolve`
4. Deploy to staging

### Phase 2: Enhance Existing Endpoint
1. Add `enrichment_data` parameter to `/entity/merge`
2. Implement merge strategies
3. Maintain backward compatibility (if `enrichment_data` not provided, use old behavior)
4. Deploy to staging

### Phase 3: Testing
1. Integration tests with orchestrator
2. Performance testing with large hierarchies
3. Validate conflict resolution strategies

### Phase 4: Production Deployment
1. Deploy to production
2. Monitor performance and errors
3. Gradual rollout with feature flags

---

## Questions for Graph API Team

1. **Performance**: What's the expected response time for hierarchy traversals with 5+ levels?
2. **Pagination**: Do we need pagination for `/entities/hierarchy`? What's a reasonable page size?
3. **Conflict Resolution**: Which merge strategies should we implement first? (Start simple?)
4. **Caching**: Should Graph API cache parent/child entity lists, or rely on orchestrator caching?
5. **Rate Limiting**: Any rate limits we should be aware of?
6. **Monitoring**: What metrics should we track (query time, cache hit rate, etc.)?
7. **Versioning**: Should we version these endpoints (e.g., `/v2/entity/merge`)?

---

## Summary

This requirements document specifies **2 new endpoints**, **1 enhanced endpoint**, and **1 simplified endpoint**:

### New Endpoints
1. ✅ `POST /entity/find-in-hierarchy` - Find entity in parent/child PIs
2. ✅ `POST /entities/hierarchy` - Bulk fetch entities from hierarchy
3. ✅ Database indexes on `code` field

### Enhanced Endpoints
1. ✅ `POST /entity/merge` - Add enrichment_data with merge strategies

### Simplified Endpoints
1. ✅ `POST /entity/create` - Simple storage (NO auto entity ref resolution)

### Key Features
- ✅ Placeholder detection (`type: "unknown"`)
- ✅ Enrichment strategies (upgrade placeholder → rich entity)
- ✅ Conflict resolution (merge two rich entities)
- ✅ Hierarchy traversal (parents AND children)
- ✅ **Entity ref resolution handled by orchestrator** (not Graph API)
- ✅ **Cached hierarchy lookups** (no redundant API calls)
- ✅ Clean separation: orchestrator decides, Graph API executes

### Architectural Principles

**Orchestrator Responsibilities**:
- Resolve ALL entity references (properties + relationships)
- Use cached parent/child entity indexes
- Extract entity refs from properties
- Create relationships for resolved refs
- Single, unified resolution logic

**Graph API Responsibilities**:
- Simple storage and retrieval
- Execute merge strategies
- Track source PIs
- Provide hierarchy data (fetched once, cached by orchestrator)

**Once implemented, these endpoints will enable the orchestrator to properly handle placeholder entity resolution across parent/child PI hierarchies with efficient caching and clean separation of concerns.**
