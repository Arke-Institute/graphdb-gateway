/**
 * Test placeholder resolution endpoints
 *
 * Tests:
 * 1. POST /entities/lookup-by-code - Find entities by code with type filtering
 * 2. POST /entities/find-in-lineage - Find entities in direct lineage
 */

const BASE_URL = process.env.TEST_URL || 'https://graphdb-gateway.arke.institute';

async function post(endpoint, body) {
  const response = await fetch(`${BASE_URL}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, data: await response.json() };
}

async function get(endpoint) {
  const response = await fetch(`${BASE_URL}${endpoint}`, {
    method: 'GET',
  });
  return { status: response.status, data: await response.json() };
}

async function del(endpoint) {
  const response = await fetch(`${BASE_URL}${endpoint}`, {
    method: 'DELETE',
  });
  return { status: response.status, data: await response.json() };
}

function generateId() {
  return `test-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

function log(color, prefix, message) {
  const colors = {
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m',
    reset: '\x1b[0m',
  };
  console.log(`${colors[color] || ''}${prefix}${colors.reset} ${message}`);
}

let testsPassed = 0;
let testsFailed = 0;

function assert(condition, message) {
  if (condition) {
    log('green', '  ✓', message);
    testsPassed++;
  } else {
    log('red', '  ✗', message);
    testsFailed++;
  }
}

// Test 1: Lookup by code - basic
async function testLookupByCodeBasic() {
  log('cyan', '\n[TEST 1]', 'Lookup by code - basic');

  const testId = generateId();
  const pi = `pi-${testId}`;
  const entityId = `entity-${testId}`;
  const code = `concert-${testId}`;

  // Create PI and entity
  await post('/pi/create', { pi });
  await post('/entity/create', {
    canonical_id: entityId,
    code: code,
    label: 'Test Concert',
    type: 'event',
    properties: { venue: 'Test Venue' },
    source_pi: pi,
  });

  // Lookup by code
  const result = await post('/entities/lookup-by-code', { code });

  assert(result.status === 200, `Status 200 (got ${result.status})`);
  assert(result.data.count === 1, `Found 1 entity (got ${result.data.count})`);
  assert(result.data.entities[0].code === code, `Code matches`);
  assert(result.data.entities[0].type === 'event', `Type is event`);

  // Cleanup
  await del(`/entity/${entityId}`);
}

// Test 2: Lookup by code with type filter
async function testLookupByCodeWithTypeFilter() {
  log('cyan', '\n[TEST 2]', 'Lookup by code - with type filter');

  const testId = generateId();
  const pi = `pi-${testId}`;
  const code = `shared-code-${testId}`;
  const realEntityId = `real-${testId}`;
  const placeholderId = `placeholder-${testId}`;

  // Create PI
  await post('/pi/create', { pi });

  // Create real entity with the code
  await post('/entity/create', {
    canonical_id: realEntityId,
    code: code,
    label: 'Real Entity',
    type: 'event',
    properties: { real: true },
    source_pi: pi,
  });

  // Create placeholder with same code
  await post('/entity/create', {
    canonical_id: placeholderId,
    code: code,
    label: 'Placeholder Entity',
    type: 'unknown',
    properties: {},
    source_pi: pi,
  });

  // Lookup all with this code
  const allResult = await post('/entities/lookup-by-code', { code });
  assert(allResult.data.count === 2, `Found 2 entities with same code (got ${allResult.data.count})`);

  // Lookup only placeholders
  const placeholderResult = await post('/entities/lookup-by-code', {
    code,
    type: 'unknown'
  });
  assert(placeholderResult.data.count === 1, `Found 1 placeholder (got ${placeholderResult.data.count})`);
  assert(placeholderResult.data.entities[0].type === 'unknown', `Type is unknown`);

  // Lookup excluding placeholders
  const realResult = await post('/entities/lookup-by-code', {
    code,
    excludeType: 'unknown'
  });
  assert(realResult.data.count === 1, `Found 1 real entity (got ${realResult.data.count})`);
  assert(realResult.data.entities[0].type === 'event', `Type is event`);

  // Cleanup
  await del(`/entity/${realEntityId}`);
  await del(`/entity/${placeholderId}`);
}

// Test 3: Lookup by code - not found
async function testLookupByCodeNotFound() {
  log('cyan', '\n[TEST 3]', 'Lookup by code - not found');

  const result = await post('/entities/lookup-by-code', {
    code: `nonexistent-${generateId()}`
  });

  assert(result.status === 200, `Status 200 (got ${result.status})`);
  assert(result.data.count === 0, `Found 0 entities (got ${result.data.count})`);
  assert(Array.isArray(result.data.entities), `Entities is array`);
}

// Test 4: Find in lineage - same PI (hops = 0)
async function testFindInLineageSamePi() {
  log('cyan', '\n[TEST 4]', 'Find in lineage - same PI (hops = 0)');

  const testId = generateId();
  const pi = `pi-${testId}`;
  const entityId = `entity-${testId}`;

  // Create PI and entity
  await post('/pi/create', { pi });
  await post('/entity/create', {
    canonical_id: entityId,
    code: `code-${testId}`,
    label: 'Test Entity',
    type: 'person',
    properties: {},
    source_pi: pi,
  });

  // Find in lineage - should find with hops = 0
  const result = await post('/entities/find-in-lineage', {
    sourcePi: pi,
    candidateIds: [entityId],
    maxHops: 10,
  });

  assert(result.status === 200, `Status 200 (got ${result.status})`);
  assert(result.data.found === true, `Found entity`);
  assert(result.data.hops === 0, `Hops is 0 (got ${result.data.hops})`);
  assert(result.data.direction === 'same', `Direction is 'same' (got ${result.data.direction})`);
  assert(result.data.entity.canonical_id === entityId, `Correct entity returned`);

  // Cleanup
  await del(`/entity/${entityId}`);
}

// Test 5: Find in lineage - ancestor
async function testFindInLineageAncestor() {
  log('cyan', '\n[TEST 5]', 'Find in lineage - ancestor');

  const testId = generateId();
  const parentPi = `parent-pi-${testId}`;
  const childPi = `child-pi-${testId}`;
  const entityId = `entity-${testId}`;

  // Create parent PI
  await post('/pi/create', { pi: parentPi });

  // Create child PI with parent
  await post('/pi/create', { pi: childPi, parent: parentPi });

  // Create entity in parent PI
  await post('/entity/create', {
    canonical_id: entityId,
    code: `code-${testId}`,
    label: 'Parent Entity',
    type: 'person',
    properties: {},
    source_pi: parentPi,
  });

  // Search from child PI - should find in ancestor
  const result = await post('/entities/find-in-lineage', {
    sourcePi: childPi,
    candidateIds: [entityId],
    maxHops: 10,
  });

  assert(result.status === 200, `Status 200 (got ${result.status})`);
  assert(result.data.found === true, `Found entity`);
  assert(result.data.hops === 1, `Hops is 1 (got ${result.data.hops})`);
  assert(result.data.direction === 'ancestor', `Direction is 'ancestor' (got ${result.data.direction})`);

  // Cleanup
  await del(`/entity/${entityId}`);
}

// Test 6: Find in lineage - descendant
async function testFindInLineageDescendant() {
  log('cyan', '\n[TEST 6]', 'Find in lineage - descendant');

  const testId = generateId();
  const parentPi = `parent-pi-${testId}`;
  const childPi = `child-pi-${testId}`;
  const entityId = `entity-${testId}`;

  // Create parent PI
  await post('/pi/create', { pi: parentPi });

  // Create child PI with parent
  await post('/pi/create', { pi: childPi, parent: parentPi });

  // Create entity in child PI
  await post('/entity/create', {
    canonical_id: entityId,
    code: `code-${testId}`,
    label: 'Child Entity',
    type: 'person',
    properties: {},
    source_pi: childPi,
  });

  // Search from parent PI - should find in descendant
  const result = await post('/entities/find-in-lineage', {
    sourcePi: parentPi,
    candidateIds: [entityId],
    maxHops: 10,
  });

  assert(result.status === 200, `Status 200 (got ${result.status})`);
  assert(result.data.found === true, `Found entity`);
  assert(result.data.hops === 1, `Hops is 1 (got ${result.data.hops})`);
  assert(result.data.direction === 'descendant', `Direction is 'descendant' (got ${result.data.direction})`);

  // Cleanup
  await del(`/entity/${entityId}`);
}

// Test 7: Find in lineage - not in lineage (sibling branch)
async function testFindInLineageNotInLineage() {
  log('cyan', '\n[TEST 7]', 'Find in lineage - not in lineage (sibling branch)');

  const testId = generateId();
  const parentPi = `parent-pi-${testId}`;
  const childPi1 = `child-pi-1-${testId}`;
  const childPi2 = `child-pi-2-${testId}`;
  const entityId = `entity-${testId}`;

  // Create parent PI
  await post('/pi/create', { pi: parentPi });

  // Create two child PIs (siblings)
  await post('/pi/create', { pi: childPi1, parent: parentPi });
  await post('/pi/create', { pi: childPi2, parent: parentPi });

  // Create entity in child PI 2
  await post('/entity/create', {
    canonical_id: entityId,
    code: `code-${testId}`,
    label: 'Sibling Entity',
    type: 'person',
    properties: {},
    source_pi: childPi2,
  });

  // Search from child PI 1 - should NOT find (different branch)
  const result = await post('/entities/find-in-lineage', {
    sourcePi: childPi1,
    candidateIds: [entityId],
    maxHops: 10,
  });

  assert(result.status === 200, `Status 200 (got ${result.status})`);
  assert(result.data.found === false, `Entity NOT found (sibling branch excluded)`);

  // Cleanup
  await del(`/entity/${entityId}`);
}

// Test 8: Find in lineage - maxHops limit
async function testFindInLineageMaxHops() {
  log('cyan', '\n[TEST 8]', 'Find in lineage - maxHops limit');

  const testId = generateId();
  const grandparentPi = `grandparent-pi-${testId}`;
  const parentPi = `parent-pi-${testId}`;
  const childPi = `child-pi-${testId}`;
  const entityId = `entity-${testId}`;

  // Create 3-level hierarchy
  await post('/pi/create', { pi: grandparentPi });
  await post('/pi/create', { pi: parentPi, parent: grandparentPi });
  await post('/pi/create', { pi: childPi, parent: parentPi });

  // Create entity in grandparent PI
  await post('/entity/create', {
    canonical_id: entityId,
    code: `code-${testId}`,
    label: 'Grandparent Entity',
    type: 'person',
    properties: {},
    source_pi: grandparentPi,
  });

  // Search from child PI with maxHops=1 - should NOT find (2 hops away)
  const limitedResult = await post('/entities/find-in-lineage', {
    sourcePi: childPi,
    candidateIds: [entityId],
    maxHops: 1,
  });
  assert(limitedResult.data.found === false, `Not found with maxHops=1 (entity is 2 hops away)`);

  // Search from child PI with maxHops=2 - SHOULD find
  const fullResult = await post('/entities/find-in-lineage', {
    sourcePi: childPi,
    candidateIds: [entityId],
    maxHops: 2,
  });
  assert(fullResult.data.found === true, `Found with maxHops=2`);
  assert(fullResult.data.hops === 2, `Hops is 2 (got ${fullResult.data.hops})`);

  // Cleanup
  await del(`/entity/${entityId}`);
}

// Test 9: Find in lineage - multiple candidates, nearest wins
async function testFindInLineageNearestWins() {
  log('cyan', '\n[TEST 9]', 'Find in lineage - multiple candidates, nearest wins');

  const testId = generateId();
  const grandparentPi = `grandparent-pi-${testId}`;
  const parentPi = `parent-pi-${testId}`;
  const childPi = `child-pi-${testId}`;
  const nearEntityId = `near-entity-${testId}`;
  const farEntityId = `far-entity-${testId}`;

  // Create 3-level hierarchy
  await post('/pi/create', { pi: grandparentPi });
  await post('/pi/create', { pi: parentPi, parent: grandparentPi });
  await post('/pi/create', { pi: childPi, parent: parentPi });

  // Create entity in parent PI (1 hop from child)
  await post('/entity/create', {
    canonical_id: nearEntityId,
    code: `near-code-${testId}`,
    label: 'Near Entity',
    type: 'person',
    properties: {},
    source_pi: parentPi,
  });

  // Create entity in grandparent PI (2 hops from child)
  await post('/entity/create', {
    canonical_id: farEntityId,
    code: `far-code-${testId}`,
    label: 'Far Entity',
    type: 'person',
    properties: {},
    source_pi: grandparentPi,
  });

  // Search from child PI with both candidates - nearest should win
  const result = await post('/entities/find-in-lineage', {
    sourcePi: childPi,
    candidateIds: [farEntityId, nearEntityId], // Far one listed first
    maxHops: 10,
  });

  assert(result.data.found === true, `Found entity`);
  assert(result.data.entity.canonical_id === nearEntityId, `Nearest entity returned (got ${result.data.entity.canonical_id})`);
  assert(result.data.hops === 1, `Hops is 1 (got ${result.data.hops})`);

  // Cleanup
  await del(`/entity/${nearEntityId}`);
  await del(`/entity/${farEntityId}`);
}

// Test 10: Find in lineage - validation errors
async function testFindInLineageValidation() {
  log('cyan', '\n[TEST 10]', 'Find in lineage - validation errors');

  // Missing sourcePi
  const result1 = await post('/entities/find-in-lineage', {
    candidateIds: ['some-id'],
    maxHops: 10,
  });
  assert(result1.status === 400, `400 when missing sourcePi (got ${result1.status})`);

  // Empty candidateIds
  const result2 = await post('/entities/find-in-lineage', {
    sourcePi: 'some-pi',
    candidateIds: [],
    maxHops: 10,
  });
  assert(result2.status === 400, `400 when candidateIds empty (got ${result2.status})`);

  // Invalid maxHops
  const result3 = await post('/entities/find-in-lineage', {
    sourcePi: 'some-pi',
    candidateIds: ['some-id'],
    maxHops: -1,
  });
  assert(result3.status === 400, `400 when maxHops negative (got ${result3.status})`);
}

// Run all tests
async function runTests() {
  console.log('');
  log('blue', '🧪', `Testing placeholder resolution endpoints`);
  log('blue', '🌐', `Base URL: ${BASE_URL}`);
  console.log('');

  try {
    // Lookup by code tests
    await testLookupByCodeBasic();
    await testLookupByCodeWithTypeFilter();
    await testLookupByCodeNotFound();

    // Find in lineage tests
    await testFindInLineageSamePi();
    await testFindInLineageAncestor();
    await testFindInLineageDescendant();
    await testFindInLineageNotInLineage();
    await testFindInLineageMaxHops();
    await testFindInLineageNearestWins();
    await testFindInLineageValidation();

    console.log('');
    log('blue', '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', '');

    if (testsFailed === 0) {
      log('green', '✅ ALL TESTS PASSED', `(${testsPassed}/${testsPassed + testsFailed})`);
    } else {
      log('red', '❌ SOME TESTS FAILED', `(${testsPassed} passed, ${testsFailed} failed)`);
      process.exit(1);
    }
  } catch (error) {
    log('red', '💥 ERROR:', error.message);
    console.error(error);
    process.exit(1);
  }
}

runTests();
