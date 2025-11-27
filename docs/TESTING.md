# Testing Guide

Guidelines for creating, using, and cleaning up test data in the GraphDB Gateway.

## Core Principle

**All test data must contain "test" in its identifiers.** This allows safe cleanup via `/admin/clear-test-data` without affecting production data.

## Naming Conventions

### Required Patterns

```javascript
// PIs - use "test-" prefix
const piId = `test-pi-${Date.now()}`;
const parentPi = `parent-pi-test-${uniqueId}`;

// Entities - use "test-" prefix in canonical_id
const entityId = `test-entity-${Date.now()}`;
const entityId = `entity-test-${uniqueId}`;  // also valid

// Any format works as long as "test" appears somewhere
const valid1 = `test-abc123`;           // ✓
const valid2 = `my-test-entity`;        // ✓
const valid3 = `abc-test-123`;          // ✓
const invalid = `abc123`;               // ✗ won't be cleaned up
```

### Unique IDs

Always include a unique component to avoid collisions between test runs:

```javascript
// Option 1: Timestamp
const uniqueId = Date.now();

// Option 2: Timestamp + random string
const uniqueId = `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

// Option 3: UUID (if available)
const uniqueId = crypto.randomUUID();
```

## Test Data Lifecycle

### 1. Setup: Create Test Data

```javascript
const BASE_URL = 'https://graphdb-gateway.arke.institute';
const testId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

// Create PI hierarchy
await fetch(`${BASE_URL}/pi/create`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    pi: `test-pi-${testId}`,
    parent: `test-parent-pi-${testId}`,
    children: [`test-child-pi-${testId}`]
  })
});

// Create entities
await fetch(`${BASE_URL}/entity/create`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    canonical_id: `test-entity-${testId}`,
    code: `test_code_${testId}`,
    label: 'Test Entity',
    type: 'person',
    properties: { test: true },
    source_pi: `test-pi-${testId}`
  })
});

// Create relationships
await fetch(`${BASE_URL}/relationships/merge`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    relationships: [{
      subject_id: `test-entity-1-${testId}`,
      predicate: 'affiliated_with',
      object_id: `test-entity-2-${testId}`,
      properties: {},
      source_pi: `test-pi-${testId}`
    }]
  })
});
```

### 2. Test: Run Your Tests

```javascript
// Query test data
const response = await fetch(`${BASE_URL}/entity/test-entity-${testId}`);
const data = await response.json();

// Assertions
console.assert(data.found === true, 'Entity should exist');
console.assert(data.entity.type === 'person', 'Type should be person');
```

### 3. Teardown: Clean Up

**Option A: Global cleanup (recommended for CI/test suites)**

```bash
curl -X POST https://graphdb-gateway.arke.institute/admin/clear-test-data \
  -H "Content-Type: application/json" \
  -d '{}'
```

```javascript
// In code
await fetch(`${BASE_URL}/admin/clear-test-data`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: '{}'
});
```

**Option B: Targeted cleanup (for specific test runs)**

```javascript
// Delete specific entities
await fetch(`${BASE_URL}/entity/test-entity-${testId}`, {
  method: 'DELETE'
});

// Or use custom query for more control
await fetch(`${BASE_URL}/query`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    query: `
      MATCH (n)
      WHERE toString(n.id) CONTAINS $testId
         OR toString(n.canonical_id) CONTAINS $testId
      DETACH DELETE n
      RETURN count(n) as deleted
    `,
    params: { testId: testId }
  })
});
```

## Test File Template

```javascript
/**
 * Test file template
 * Run: node tests/my-test.js
 */

const BASE_URL = process.env.BASE_URL || 'https://graphdb-gateway.arke.institute';
const TEST_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

// Test data with unique IDs
const TEST_PI = `test-pi-${TEST_ID}`;
const TEST_ENTITY = `test-entity-${TEST_ID}`;

async function setup() {
  console.log('Setting up test data...');

  // Create PI
  await fetch(`${BASE_URL}/pi/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pi: TEST_PI })
  });

  // Create entity
  await fetch(`${BASE_URL}/entity/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      canonical_id: TEST_ENTITY,
      code: `code_${TEST_ID}`,
      label: 'Test Entity',
      type: 'person',
      properties: {},
      source_pi: TEST_PI
    })
  });
}

async function runTests() {
  let passed = 0;
  let failed = 0;

  // Test 1: Entity exists
  const res = await fetch(`${BASE_URL}/entity/exists/${TEST_ENTITY}`);
  const data = await res.json();
  if (data.exists === true) {
    console.log('✓ Test 1 passed');
    passed++;
  } else {
    console.log('✗ Test 1 failed');
    failed++;
  }

  // Add more tests...

  return { passed, failed };
}

async function teardown() {
  console.log('Cleaning up test data...');

  await fetch(`${BASE_URL}/admin/clear-test-data`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}'
  });
}

async function main() {
  try {
    await setup();
    const results = await runTests();
    console.log(`\nResults: ${results.passed} passed, ${results.failed} failed`);
    process.exitCode = results.failed > 0 ? 1 : 0;
  } finally {
    await teardown();
  }
}

main();
```

## Quick Reference

### Commands

```bash
# Run tests against production
node tests/my-test.js

# Run tests against local dev server
BASE_URL=http://localhost:8787 node tests/my-test.js

# Clean up all test data manually
curl -X POST https://graphdb-gateway.arke.institute/admin/clear-test-data \
  -H "Content-Type: application/json" -d '{}'

# Check what test data exists
curl -X POST https://graphdb-gateway.arke.institute/query \
  -H "Content-Type: application/json" \
  -d '{"query": "MATCH (n) WHERE toString(n.id) CONTAINS \"test\" OR toString(n.canonical_id) CONTAINS \"test\" RETURN labels(n) as type, n.id as id, n.canonical_id as cid LIMIT 20"}'
```

### Safety Rules

1. **Always use "test" in IDs** - No exceptions
2. **Use unique IDs per test run** - Prevents collisions
3. **Clean up after tests** - Call `/admin/clear-test-data` in finally block
4. **Never use production-looking IDs** - Avoid UUIDs without "test" prefix

### What Gets Cleaned

`/admin/clear-test-data` deletes any node where:
- `id` contains "test" (PI nodes)
- `canonical_id` contains "test" (Entity nodes)

This includes all relationships connected to those nodes (via `DETACH DELETE`).

### What's Protected

- Real PI nodes (ULIDs like `01KA1H53CP8Y9V2XQN5Z3R7M4E`)
- Real entities (UUIDs like `550e8400-e29b-41d4-a716-446655440000`)
- Any node without "test" in its identifiers
