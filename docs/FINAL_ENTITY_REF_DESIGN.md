# Final Entity Reference Resolution Design

## Requirements Summary

Based on discussion:

### 1. Date Entity Code Format
```
date_YYYY_MM_DD  →  "2025-11-10"     (full date)
date_YYYY_MM     →  "2025-11"        (year-month only, NO day)
date_YYYY        →  "2025"           (year only, NO month/day)
```

**Important:** Preserve date precision - don't add fake specificity!

### 2. Placeholder Type Assignment
**IMPORTANT: Type is NOT inferred from code (except dates)!**

- ✅ **Date entities:** Can infer `type: "date"` from `code: "date_*"` pattern
- ❌ **Everything else:** `type: "unknown"` for all placeholders
  - `marshall_street` → type: `"unknown"` (NOT `"location"`)
  - `john_doe` → type: `"unknown"` (NOT `"person"`)
  - Any missing entity → type: `"unknown"`

**Why?** Placeholders are edge cases. The actual entity should be extracted properly with its real type. Placeholders with `type: "unknown"` can be identified and processed later.

### 3. Resolution Timing
**Automatic during entity creation** - No separate endpoint needed.
- When creating entity, automatically resolve entity_refs
- Create relationships immediately
- Extract date value from date entities

### 3. Failed Resolution Handling
**Create placeholder entity** with:
- `code`: Original code (e.g., "marshall_street")
- `label`: Cleaned up name (e.g., "Marshall Street")
- `type`: Inferred from context or "unknown"
- `canonical_id`: Generated UUID
- `properties`: Empty or minimal

### 4. Multiple Date Fields Handling
**If entity has multiple date entity_refs:**
- All date relationships are created (e.g., `start_date`, `end_date`, `when`)
- The entity's top-level `date` field uses the **first date entity_ref found**
- All dates are preserved in relationships with their field names

**Example:**
```json
{
  "properties": {
    "start": {"type": "entity_ref", "code": "date_1864_04"},
    "end": {"type": "entity_ref", "code": "date_1864_12"}
  }
}
```
Results in:
- `entity.date = "1864-04"` (first date found)
- `(entity)-[:HAS_START_DATE]->(date_1864_04)`
- `(entity)-[:HAS_END_DATE]->(date_1864_12)`

All dates queryable via relationships!

---

## How Different Entity Types Are Handled

### How ANY Entity Ref is Handled

**Simple, uniform process for ALL entity_refs:**

```json
{"field_name": {"type": "entity_ref", "code": "some_code"}}
```

**Process (same for all):**
1. Look for entity with `code: "some_code"` in PI hierarchy
2. If found: Use it (with whatever type it has)
3. If not found: Create placeholder with:
   - `type: "date"` if code starts with `"date_"`
   - `type: "unknown"` for everything else
   - `label:` Cleaned-up code (e.g., `"some_code"` → `"Some Code"`)
   - `properties: { placeholder: true }`
4. **Create relationship:** `(entity)-[:HAS_{FIELD_NAME}]->(target)`
   - Examples:
     - `"when"` → `[:HAS_WHEN]`
     - `"where"` → `[:HAS_WHERE]`
     - `"reported_by"` → `[:HAS_REPORTED_BY]`
     - `"witness"` → `[:HAS_WITNESS]`
5. **Date extraction:** If target is date entity (type: "date"), extract to `entity.date`

**That's it! No special cases, no type-based logic.**

---

## Complete Example with Multiple Entity Types

### Input:
```json
{
  "canonical_id": "event_fire_001",
  "code": "fire_event",
  "label": "Fire at Marshall Street",
  "type": "event",
  "properties": {
    "when": {"type": "entity_ref", "code": "date_1864_04_04"},
    "where": {"type": "entity_ref", "code": "marshall_street"},
    "reported_by": {"type": "entity_ref", "code": "john_smith"},
    "witness": [
      {"type": "entity_ref", "code": "jane_doe"},
      {"type": "entity_ref", "code": "bob_jones"}
    ],
    "damage_estimate": "severe",
    "time": "2:15pm"
  },
  "source_pi": "01PAPER_XYZ"
}
```

### Processing:

**Entity Refs Found:**
- `when` → `date_1864_04_04`
- `where` → `marshall_street`
- `reported_by` → `john_smith`
- `witness` → `jane_doe` (array)
- `witness` → `bob_jones` (array)

**Resolution:**

1. **date_1864_04_04** (field: "when"):
   - Search PI hierarchy → ✅ Found (type: "date")
   - Relationship: `(event)-[:HAS_WHEN]->(date_entity)`
   - Extract: `event.date = "1864-04-04"` ← Date extraction!

2. **marshall_street** (field: "where"):
   - Search PI hierarchy → ❌ Not found
   - Create placeholder: type "unknown", label "Marshall Street"
   - Relationship: `(event)-[:HAS_WHERE]->(marshall_street_placeholder)`

3. **john_smith** (field: "reported_by"):
   - Search PI hierarchy → ✅ Found (type: "person")
   - Relationship: `(event)-[:HAS_REPORTED_BY]->(john_smith_entity)`

4. **jane_doe** (field: "witness"):
   - Search PI hierarchy → ❌ Not found
   - Create placeholder: type "unknown", label "Jane Doe"
   - Relationship: `(event)-[:HAS_WITNESS]->(jane_doe_placeholder)`

5. **bob_jones** (field: "witness"):
   - Search PI hierarchy → ✅ Found (type: "person")
   - Relationship: `(event)-[:HAS_WITNESS]->(bob_jones_entity)`

### Result Graph:
```cypher
(event:Entity {
  canonical_id: "event_fire_001",
  type: "event",
  date: "1864-04-04",  // ← Extracted from date entity
  properties: '{"when":{...},"where":{...},...}'
})
  -[:HAS_WHEN]-> (date_entity {type: "date"})
  -[:HAS_WHERE]-> (marshall_street_placeholder {type: "unknown"})
  -[:HAS_REPORTED_BY]-> (john_smith_entity {type: "person"})
  -[:HAS_WITNESS]-> (jane_doe_placeholder {type: "unknown"})
  -[:HAS_WITNESS]-> (bob_jones_entity {type: "person"})
```

### Response:
```json
{
  "success": true,
  "data": {
    "canonical_id": "event_fire_001",
    "nodesCreated": 3,  // event + 2 placeholders (marshall_street, jane_doe)
    "relationshipsCreated": 6,  // 1 EXTRACTED_FROM + 5 entity_refs
    "entity_refs_resolved": 5,
    "placeholders_created": 2,
    "resolved_refs": [
      {
        "field": "when",
        "code": "date_1864_04_04",
        "canonical_id": "uuid-date-123",
        "relationship_type": "HAS_WHEN",
        "was_placeholder": false
      },
      {
        "field": "where",
        "code": "marshall_street",
        "canonical_id": "uuid-loc-456",
        "relationship_type": "HAS_WHERE",
        "was_placeholder": true  // ← Created placeholder
      },
      {
        "field": "reported_by",
        "code": "john_smith",
        "canonical_id": "uuid-person-789",
        "relationship_type": "HAS_REPORTED_BY",
        "was_placeholder": false
      },
      {
        "field": "witness",
        "code": "jane_doe",
        "canonical_id": "uuid-person-abc",
        "relationship_type": "HAS_WITNESS",
        "was_placeholder": true  // ← Created placeholder
      },
      {
        "field": "witness",
        "code": "bob_jones",
        "canonical_id": "uuid-person-def",
        "relationship_type": "HAS_WITNESS",
        "was_placeholder": false
      }
    ]
  }
}
```

---

## Complete Implementation

### Helper Functions

```typescript
/**
 * Extract all entity_refs from properties object
 */
interface EntityRef {
  type: 'entity_ref';
  code: string;
}

interface ExtractedRef {
  field: string;
  code: string;
  isArray: boolean;  // true if field contains array of refs
}

function extractEntityRefs(properties: Record<string, any>): ExtractedRef[] {
  const refs: ExtractedRef[] = [];

  for (const [field, value] of Object.entries(properties)) {
    // Single entity_ref
    if (
      typeof value === 'object' &&
      value !== null &&
      value.type === 'entity_ref' &&
      typeof value.code === 'string'
    ) {
      refs.push({ field, code: value.code, isArray: false });
    }

    // Array of entity_refs
    if (Array.isArray(value)) {
      const refCodes = value
        .filter(
          (item) =>
            typeof item === 'object' &&
            item !== null &&
            item.type === 'entity_ref' &&
            typeof item.code === 'string'
        )
        .map((item) => item.code);

      if (refCodes.length > 0) {
        // Store each ref separately but mark as array
        for (const code of refCodes) {
          refs.push({ field, code, isArray: true });
        }
      }
    }
  }

  return refs;
}

/**
 * Parse date from date entity code
 * Formats: date_YYYY_MM_DD, date_YYYY_MM, date_YYYY
 * IMPORTANT: Preserve precision - don't add fake specificity!
 */
function parseDateFromCode(code: string): string | null {
  const match = code.match(/^date_(\d{4})(?:_(\d{2}))?(?:_(\d{2}))?$/);
  if (!match) return null;

  const [, year, month, day] = match;

  // Return date with appropriate precision
  if (day) {
    return `${year}-${month}-${day}`;  // Full date: "1864-04-04"
  } else if (month) {
    return `${year}-${month}`;          // Year-month: "1864-04"
  } else {
    return year;                         // Year only: "1864"
  }
}

/**
 * Clean up code to make a human-readable label
 * Examples:
 *   marshall_street → Marshall Street
 *   john_doe → John Doe
 *   date_1864_04_04 → Date 1864 04 04
 */
function codeToLabel(code: string): string {
  return code
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Infer entity type from code pattern
 * ONLY for date entities - everything else is "unknown"
 */
function inferTypeFromCode(code: string): string {
  // ONLY date can be inferred from code pattern
  if (code.startsWith('date_')) return 'date';

  // Everything else is unknown - will be filled in later when entity is properly extracted
  return 'unknown';
}

/**
 * Determine relationship type based on field name
 * SIMPLE: Just use HAS_{fieldname} for everything
 * Maximum flexibility - no hardcoded assumptions!
 */
function getRelationshipType(field: string): string {
  // Convert field name to uppercase and prefix with HAS_
  // Examples:
  //   "when" → "HAS_WHEN"
  //   "where" → "HAS_WHERE"
  //   "reported_by" → "HAS_REPORTED_BY"
  //   "witness" → "HAS_WITNESS"

  const sanitizedField = field.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
  return `HAS_${sanitizedField}`;
}
```

---

## Entity Resolution Logic

### Step 1: Try to Find Existing Entity

```cypher
// Find entity by code within PI hierarchy (same PI + children)
MATCH (source_pi:PI {id: $source_pi})
MATCH (search_pi:PI)
WHERE search_pi.id = source_pi.id
   OR (source_pi)-[:PARENT_OF*]->(search_pi)

MATCH (target:Entity {code: $target_code})
WHERE (target)-[:EXTRACTED_FROM]->(search_pi)

RETURN target.canonical_id AS canonical_id,
       target.type AS type,
       target.code AS code,
       target.label AS label,
       target.properties AS properties
LIMIT 1
```

### Step 2: Create Placeholder if Not Found

```typescript
async function findOrCreateEntity(
  env: Env,
  code: string,
  source_pi: string
): Promise<{ canonical_id: string; type: string; properties: Record<string, any> }> {
  // Try to find existing entity
  const findQuery = `
    MATCH (source_pi:PI {id: $source_pi})
    MATCH (search_pi:PI)
    WHERE search_pi.id = source_pi.id
       OR (source_pi)-[:PARENT_OF*]->(search_pi)

    MATCH (target:Entity {code: $code})
    WHERE (target)-[:EXTRACTED_FROM]->(search_pi)

    RETURN target.canonical_id AS canonical_id,
           target.type AS type,
           target.properties AS properties
    LIMIT 1
  `;

  const { records } = await executeQuery(env, findQuery, { code, source_pi });

  if (records.length > 0) {
    // Found existing entity
    const record = records[0];
    return {
      canonical_id: record.get('canonical_id'),
      type: record.get('type'),
      properties: JSON.parse(record.get('properties')),
    };
  }

  // Not found - create placeholder
  const canonical_id = crypto.randomUUID();
  const label = codeToLabel(code);
  const type = inferTypeFromCode(code);

  // If it's a date, extract date value from code
  const dateValue = type === 'date' ? parseDateFromCode(code) : null;

  const properties: Record<string, any> = {
    placeholder: true,
    created_reason: 'Referenced but not yet extracted',
  };

  if (dateValue && type === 'date') {
    properties.iso_date = dateValue;
  }

  let entityLabel = 'Entity';
  if (type === 'date') {
    entityLabel = 'Entity:Date';
  } else if (type === 'file') {
    entityLabel = 'Entity:File';
  }

  const createQuery = `
    MATCH (pi:PI {id: $source_pi})
    CREATE (e:${entityLabel} {
      canonical_id: $canonical_id,
      code: $code,
      label: $label,
      type: $type,
      date: $date,
      properties: $properties,
      first_seen: datetime(),
      last_updated: datetime()
    })
    CREATE (e)-[:EXTRACTED_FROM {
      original_code: $code,
      extracted_at: datetime()
    }]->(pi)
    RETURN e
  `;

  await executeQuery(env, createQuery, {
    canonical_id,
    code,
    label,
    type,
    date: dateValue,
    properties: JSON.stringify(properties),
    source_pi,
  });

  return { canonical_id, type, properties };
}
```

### Step 3: Create Relationship

```typescript
async function createEntityRefRelationship(
  env: Env,
  source_canonical_id: string,
  target_canonical_id: string,
  field: string,
  relationship_type: string,
  source_pi: string
): Promise<void> {
  const query = `
    MATCH (source:Entity {canonical_id: $source_canonical_id})
    MATCH (target:Entity {canonical_id: $target_canonical_id})

    // Check if relationship already exists
    OPTIONAL MATCH (source)-[existing:${relationship_type} {field: $field}]->(target)

    // Only create if doesn't exist
    WITH source, target, existing
    WHERE existing IS NULL
    CREATE (source)-[:${relationship_type} {
      field: $field,
      source_pi: $source_pi,
      created_at: datetime()
    }]->(target)

    RETURN count(*) as created
  `;

  await executeQuery(env, query, {
    source_canonical_id,
    target_canonical_id,
    field,
    source_pi,
  });
}
```

---

## Modified Entity Creation Handler

```typescript
async function handleCreateEntity(env: Env, body: CreateEntityRequest): Promise<Response> {
  try {
    const { canonical_id, code, label, type, properties, source_pi } = body;

    if (!canonical_id || !code || !label || !type || !source_pi) {
      return errorResponse(
        'Missing required fields: canonical_id, code, label, type, source_pi',
        'VALIDATION_ERROR',
        null,
        400
      );
    }

    // Determine if entity should have a subtype label
    let entityLabel = 'Entity';
    if (type === 'date') {
      entityLabel = 'Entity:Date';
    } else if (type === 'file') {
      entityLabel = 'Entity:File';
    }

    // Extract entity_refs from properties
    const entityRefs = extractEntityRefs(properties);

    // Extract date from entity_refs (look for any date entity, not specific field names!)
    let dateValue: string | null = null;

    // If this entity itself is a date type, parse from code
    if (type === 'date') {
      dateValue = parseDateFromCode(code);
    }

    // Look for date entity_refs to extract date value
    // ANY field with a date entity_ref will provide the date
    for (const ref of entityRefs) {
      if (ref.code.startsWith('date_')) {
        const parsedDate = parseDateFromCode(ref.code);
        if (parsedDate && !dateValue) {
          // We'll extract this after we resolve the entity
          // For now, just parse from the code
          dateValue = parsedDate;
          break; // Use first date entity_ref found
        }
      }
    }

    // Create the main entity
    const createQuery = `
      MATCH (pi:PI {id: $source_pi})
      CREATE (e:${entityLabel} {
        canonical_id: $canonical_id,
        code: $code,
        label: $label,
        type: $type,
        date: $date,
        properties: $properties,
        first_seen: datetime(),
        last_updated: datetime()
      })
      CREATE (e)-[:EXTRACTED_FROM {
        original_code: $code,
        extracted_at: datetime()
      }]->(pi)
      RETURN e
    `;

    const { summary } = await executeQuery(env, createQuery, {
      canonical_id,
      code,
      label,
      type,
      date: dateValue,
      properties: JSON.stringify(properties || {}),
      source_pi,
    });

    // Resolve entity_refs and create relationships
    const resolvedRefs: Array<{
      field: string;
      code: string;
      canonical_id: string;
      relationship_type: string;
      was_placeholder: boolean;
    }> = [];

    for (const ref of entityRefs) {
      try {
        // Find or create target entity
        const target = await findOrCreateEntity(env, ref.code, source_pi);

        // Determine relationship type (simple: HAS_{field_name})
        const relationshipType = getRelationshipType(ref.field);

        // Create relationship
        await createEntityRefRelationship(
          env,
          canonical_id,
          target.canonical_id,
          ref.field,
          relationshipType,
          source_pi
        );

        resolvedRefs.push({
          field: ref.field,
          code: ref.code,
          canonical_id: target.canonical_id,
          relationship_type: relationshipType,
          was_placeholder: target.properties.placeholder === true,
        });

        // If this is a date reference and we don't have a date yet, extract it
        if (!dateValue && target.type === 'date') {
          if (target.properties.iso_date) {
            dateValue = target.properties.iso_date;
          } else {
            dateValue = parseDateFromCode(ref.code);
          }

          // Update the entity's date field
          if (dateValue) {
            await executeQuery(
              env,
              `
              MATCH (e:Entity {canonical_id: $canonical_id})
              SET e.date = $date
              RETURN e
            `,
              { canonical_id, date: dateValue }
            );
          }
        }
      } catch (error: any) {
        console.error(`Failed to resolve entity_ref ${ref.code}:`, error);
        // Continue with other refs even if one fails
      }
    }

    const response: SuccessResponse = {
      success: true,
      message: 'Entity created successfully',
      data: {
        canonical_id,
        nodesCreated: summary.counters.updates().nodesCreated,
        relationshipsCreated: summary.counters.updates().relationshipsCreated,
        entity_refs_resolved: resolvedRefs.length,
        placeholders_created: resolvedRefs.filter((r) => r.was_placeholder).length,
        resolved_refs: resolvedRefs,
      },
    };

    return jsonResponse(response);
  } catch (error: any) {
    return errorResponse(
      error.message || 'Failed to create entity',
      error.code,
      { stack: error.stack }
    );
  }
}
```

---

## Example Flow

### Input (from client):
```json
POST /entity/create
{
  "canonical_id": "event_fire_001",
  "code": "fire_at_marshall",
  "label": "Fire at Marshall Street",
  "type": "event",
  "properties": {
    "when": {
      "type": "entity_ref",
      "code": "date_1864_04_04"
    },
    "where": {
      "type": "entity_ref",
      "code": "marshall_street"
    },
    "time": "2:15pm"
  },
  "source_pi": "01PAPER_XYZ"
}
```

### Processing:

1. **Extract entity_refs:**
   - `when` → `date_1864_04_04`
   - `where` → `marshall_street`

2. **Resolve `date_1864_04_04`:**
   - Search for existing entity with code `date_1864_04_04` ✅ Found
   - Parse date from code: `1864-04-04`
   - Create relationship: `(event)-[:HAS_DATE]->(date)`
   - Extract date to event: `event.date = "1864-04-04"`

3. **Resolve `marshall_street`:**
   - Search for existing entity with code `marshall_street` ❌ Not found
   - Create placeholder:
     ```json
     {
       "canonical_id": "uuid-generated",
       "code": "marshall_street",
       "label": "Marshall Street",
       "type": "location",
       "properties": {
         "placeholder": true,
         "created_reason": "Referenced but not yet extracted"
       }
     }
     ```
   - Create relationship: `(event)-[:HAS_LOCATION]->(location)`

### Response:
```json
{
  "success": true,
  "message": "Entity created successfully",
  "data": {
    "canonical_id": "event_fire_001",
    "nodesCreated": 2,  // event + marshall_street placeholder
    "relationshipsCreated": 3,  // 1 EXTRACTED_FROM + 2 entity_refs
    "entity_refs_resolved": 2,
    "placeholders_created": 1,
    "resolved_refs": [
      {
        "field": "when",
        "code": "date_1864_04_04",
        "canonical_id": "uuid-date-123",
        "relationship_type": "HAS_DATE",
        "was_placeholder": false
      },
      {
        "field": "where",
        "code": "marshall_street",
        "canonical_id": "uuid-location-456",
        "relationship_type": "HAS_LOCATION",
        "was_placeholder": true
      }
    ]
  }
}
```

### Result in Graph:
```
(event:Entity {
  canonical_id: "event_fire_001",
  code: "fire_at_marshall",
  label: "Fire at Marshall Street",
  type: "event",
  date: "1864-04-04",  ← Extracted from date entity
  properties: '{...}'
})
  -[:HAS_DATE {field: "when"}]-> (date:Entity:Date {code: "date_1864_04_04"})
  -[:HAS_LOCATION {field: "where"}]-> (location:Entity {
      code: "marshall_street",
      label: "Marshall Street",
      properties: '{"placeholder": true}'
    })
```

---

## Benefits

✅ **Automatic** - No separate endpoint needed
✅ **Transparent** - Client doesn't change
✅ **Robust** - Creates placeholders for missing entities
✅ **Traceable** - Response shows what was resolved
✅ **Graph-native** - Proper relationships created
✅ **Queryable** - Date field extracted for filtering/sorting

---

## Next Steps

Ready to implement this? This will require:
1. Adding helper functions to `src/index.ts`
2. Modifying `handleCreateEntity()` function
3. Testing with sample entity_ref data

Want me to proceed with the implementation?
