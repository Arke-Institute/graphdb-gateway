/**
 * Test PI Entity Changes
 *
 * Tests the new unified PI/Entity model where PIs are stored as Entity {type: 'pi'}
 */

const BASE_URL = process.env.TEST_URL || 'http://localhost:8789';

async function post(endpoint, body) {
  const response = await fetch(`${BASE_URL}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, data: await response.json() };
}

async function get(endpoint) {
  const response = await fetch(`${BASE_URL}${endpoint}`);
  return { status: response.status, data: await response.json() };
}

async function del(endpoint) {
  const response = await fetch(`${BASE_URL}${endpoint}`, { method: 'DELETE' });
  return { status: response.status, data: await response.json() };
}

const id = `test-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) {
    console.log(`  \x1b[32m✓\x1b[0m ${msg}`);
    passed++;
  } else {
    console.log(`  \x1b[31m✗\x1b[0m ${msg}`);
    failed++;
  }
}

async function run() {
  console.log('\n\x1b[34m🧪 Testing PI Entity Changes\x1b[0m\n');
  console.log(`Base URL: ${BASE_URL}\n`);

  // Test 1: Create PI entity via /entity/create
  console.log('\x1b[36m[TEST 1]\x1b[0m Create PI entity via /entity/create');
  const piId = `pi-entity-${id}`;
  const r1 = await post('/entity/create', {
    canonical_id: piId,
    code: `pi_${piId}`,
    label: piId,
    type: 'pi',
    properties: {},
    source_pi: piId,  // Must equal canonical_id
  });
  assert(r1.status === 200, `Status 200 (got ${r1.status})`);
  assert(r1.data.success === true, 'Success true');
  assert(r1.data.message === 'PI entity created successfully', `Correct message`);

  // Test 2: Verify PI entity exists and has correct structure
  console.log('\n\x1b[36m[TEST 2]\x1b[0m Verify PI entity structure');
  const r2 = await get(`/entity/${piId}`);
  assert(r2.status === 200, `Status 200 (got ${r2.status})`);
  assert(r2.data.found === true, 'Entity found');
  assert(r2.data.entity.type === 'pi', `Type is 'pi'`);
  assert(r2.data.entity.created_by_pi === null, `created_by_pi is null`);
  assert(r2.data.entity.source_pis.length === 0, `No EXTRACTED_FROM relationships`);

  // Test 3: PI entity with mismatched source_pi should fail
  console.log('\n\x1b[36m[TEST 3]\x1b[0m PI entity with mismatched source_pi should fail');
  const r3 = await post('/entity/create', {
    canonical_id: `pi-mismatch-${id}`,
    code: 'test',
    label: 'test',
    type: 'pi',
    properties: {},
    source_pi: 'different-pi',
  });
  assert(r3.status === 400, `Status 400 (got ${r3.status})`);
  assert(r3.data.error && r3.data.error.includes('source_pi must equal canonical_id'), 'Correct error message');

  // Test 4: Create entity with non-existent PI should fail
  console.log('\n\x1b[36m[TEST 4]\x1b[0m Create entity with non-existent PI should fail');
  const r4 = await post('/entity/create', {
    canonical_id: `entity-no-pi-${id}`,
    code: 'test',
    label: 'test',
    type: 'person',
    properties: {},
    source_pi: `nonexistent-pi-${id}`,
  });
  assert(r4.status === 404, `Status 404 (got ${r4.status})`);
  assert(r4.data.code === 'PI_NOT_FOUND', `Error code is PI_NOT_FOUND`);

  // Test 5: Create entity with existing PI entity should work
  console.log('\n\x1b[36m[TEST 5]\x1b[0m Create entity with existing PI entity works');
  const entityId = `entity-${id}`;
  const r5 = await post('/entity/create', {
    canonical_id: entityId,
    code: 'test_person',
    label: 'Test Person',
    type: 'person',
    properties: { name: 'Test' },
    source_pi: piId,
  });
  assert(r5.status === 200, `Status 200 (got ${r5.status})`);
  assert(r5.data.success === true, 'Success true');

  // Test 6: Verify entity has EXTRACTED_FROM to PI entity
  console.log('\n\x1b[36m[TEST 6]\x1b[0m Verify EXTRACTED_FROM relationship');
  const r6 = await get(`/entity/${entityId}`);
  assert(r6.data.entity.source_pis.includes(piId), `source_pis includes PI entity ID`);
  assert(r6.data.entity.created_by_pi === piId, `created_by_pi is PI entity ID`);

  // Test 7: /pi/create endpoint still works
  console.log('\n\x1b[36m[TEST 7]\x1b[0m /pi/create endpoint creates Entity {type: pi}');
  const piId2 = `pi-via-create-${id}`;
  const r7 = await post('/pi/create', { pi: piId2 });
  assert(r7.status === 200, `Status 200 (got ${r7.status})`);
  const r7b = await get(`/entity/${piId2}`);
  assert(r7b.data.found === true, 'PI entity exists');
  assert(r7b.data.entity.type === 'pi', `Type is 'pi'`);

  // Test 8: /pi/create with parent creates hierarchy
  console.log('\n\x1b[36m[TEST 8]\x1b[0m /pi/create with parent creates hierarchy');
  const parentPi = `parent-pi-${id}`;
  const childPi = `child-pi-${id}`;
  await post('/pi/create', { pi: parentPi });
  const r8 = await post('/pi/create', { pi: childPi, parent: parentPi });
  assert(r8.status === 200, `Status 200`);

  // Verify via lineage endpoint
  const r8b = await post('/pi/lineage', { sourcePi: childPi, direction: 'ancestors', maxHops: 10 });
  assert(r8b.data.ancestors.count === 1, `Found 1 ancestor`);
  assert(r8b.data.ancestors.pis[0].id === parentPi, `Ancestor is parent PI`);

  // Test 9: /entities/list excludes PI entities
  console.log('\n\x1b[36m[TEST 9]\x1b[0m /entities/list excludes PI entities');
  const r9 = await post('/entities/list', { pi: piId });
  assert(r9.status === 200, `Status 200`);
  const hasPiEntity = r9.data.entities.some(e => e.type === 'pi');
  assert(!hasPiEntity, 'No PI entities in list results');
  assert(r9.data.entities.length === 1, `Found 1 non-PI entity (got ${r9.data.entities.length})`);

  // Cleanup
  console.log('\n\x1b[33m🧹 Cleanup\x1b[0m');
  await del(`/entity/${entityId}`);
  await del(`/entity/${piId}`);
  await del(`/entity/${piId2}`);
  await del(`/entity/${parentPi}`);
  await del(`/entity/${childPi}`);

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  if (failed === 0) {
    console.log(`\x1b[32m✅ ALL TESTS PASSED\x1b[0m (${passed}/${passed})`);
  } else {
    console.log(`\x1b[31m❌ ${failed} TESTS FAILED\x1b[0m (${passed} passed)`);
    process.exit(1);
  }
}

run().catch(e => {
  console.error('Error:', e);
  process.exit(1);
});
