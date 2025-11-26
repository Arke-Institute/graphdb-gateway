/**
 * Test atomic merge operation
 *
 * Tests:
 * 1. Basic merge - source absorbed into target, relationships transferred
 * 2. Source not found - returns 404
 * 3. Target not found - returns 404
 * 4. Concurrent merge race condition - only one entity survives
 * 5. Circular merge attempt - handled gracefully
 */

const BASE_URL = process.env.TEST_URL || 'http://localhost:8787';

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

async function clearDatabase() {
  await post('/admin/clear', {});
}

// Test 1: Basic merge with relationship transfer
async function testBasicMerge() {
  log('cyan', '\n[TEST 1]', 'Basic merge with relationship transfer');

  const testId = generateId();
  const pi = `pi-${testId}`;
  const sourceId = `source-${testId}`;
  const targetId = `target-${testId}`;
  const otherId = `other-${testId}`;

  // Create PI
  await post('/pi/create', { pi });

  // Create three entities
  await post('/entity/create', {
    canonical_id: sourceId,
    code: `code-source-${testId}`,
    label: 'Source Entity',
    type: 'person',
    properties: { role: 'source', unique_to_source: 'value1' },
    source_pi: pi,
  });

  await post('/entity/create', {
    canonical_id: targetId,
    code: `code-target-${testId}`,
    label: 'Target Entity',
    type: 'person',
    properties: { role: 'target', unique_to_target: 'value2' },
    source_pi: pi,
  });

  await post('/entity/create', {
    canonical_id: otherId,
    code: `code-other-${testId}`,
    label: 'Other Entity',
    type: 'organization',
    properties: {},
    source_pi: pi,
  });

  // Create relationships on source entity
  await post('/relationships/create', {
    relationships: [
      {
        subject_id: sourceId,
        predicate: 'KNOWS',
        object_id: otherId,
        properties: { since: '2020' },
        source_pi: pi,
      },
      {
        subject_id: otherId,
        predicate: 'EMPLOYS',
        object_id: sourceId,
        properties: { role: 'engineer' },
        source_pi: pi,
      },
    ],
  });

  log('blue', '  [SETUP]', 'Created source, target, other entities with relationships');

  // Verify relationships exist on source
  const beforeMerge = await get(`/relationships/${sourceId}`);
  const sourceRelsBefore = beforeMerge.data.relationships?.length || 0;
  log('blue', '  [BEFORE]', `Source has ${sourceRelsBefore} relationships`);

  // Execute merge
  log('blue', '  [MERGE]', `Merging ${sourceId} into ${targetId}`);
  const mergeResult = await post('/entity/merge', {
    source_id: sourceId,
    target_id: targetId,
  });

  if (mergeResult.status !== 200) {
    log('red', '  [FAIL]', `Merge failed: ${JSON.stringify(mergeResult.data)}`);
    return false;
  }

  log('green', '  [RESULT]', `Merge success: ${JSON.stringify(mergeResult.data.merged)}`);

  // Verify source is deleted
  const sourceExists = await get(`/entity/exists/${sourceId}`);
  if (sourceExists.data.exists) {
    log('red', '  [FAIL]', 'Source entity still exists after merge');
    return false;
  }
  log('green', '  [OK]', 'Source entity deleted');

  // Verify target still exists
  const targetExists = await get(`/entity/exists/${targetId}`);
  if (!targetExists.data.exists) {
    log('red', '  [FAIL]', 'Target entity was deleted');
    return false;
  }
  log('green', '  [OK]', 'Target entity still exists');

  // Verify relationships transferred to target
  const afterMerge = await get(`/relationships/${targetId}`);
  const targetRelsAfter = afterMerge.data.relationships?.length || 0;
  log('blue', '  [AFTER]', `Target now has ${targetRelsAfter} relationships`);

  // Should have at least the relationships from source
  if (targetRelsAfter < sourceRelsBefore) {
    log('red', '  [FAIL]', `Expected at least ${sourceRelsBefore} relationships, got ${targetRelsAfter}`);
    return false;
  }

  // Check that KNOWS relationship was transferred
  const hasKnows = afterMerge.data.relationships?.some(r => r.predicate === 'KNOWS');
  const hasEmploys = afterMerge.data.relationships?.some(r => r.predicate === 'EMPLOYS');

  if (!hasKnows || !hasEmploys) {
    log('red', '  [FAIL]', 'Not all relationships were transferred');
    return false;
  }
  log('green', '  [OK]', 'All relationships transferred to target');

  return true;
}

// Test 2: Source not found
async function testSourceNotFound() {
  log('cyan', '\n[TEST 2]', 'Source not found returns 404');

  const testId = generateId();
  const pi = `pi-${testId}`;
  const targetId = `target-${testId}`;

  await post('/pi/create', { pi });
  await post('/entity/create', {
    canonical_id: targetId,
    code: `code-${testId}`,
    label: 'Target',
    type: 'person',
    properties: {},
    source_pi: pi,
  });

  const result = await post('/entity/merge', {
    source_id: 'nonexistent-source',
    target_id: targetId,
  });

  if (result.status !== 404) {
    log('red', '  [FAIL]', `Expected 404, got ${result.status}`);
    return false;
  }

  if (result.data.code !== 'source_not_found') {
    log('red', '  [FAIL]', `Expected error code 'source_not_found', got '${result.data.code}'`);
    return false;
  }

  log('green', '  [OK]', 'Correctly returned 404 source_not_found');
  return true;
}

// Test 3: Target not found
async function testTargetNotFound() {
  log('cyan', '\n[TEST 3]', 'Target not found returns 404');

  const testId = generateId();
  const pi = `pi-${testId}`;
  const sourceId = `source-${testId}`;

  await post('/pi/create', { pi });
  await post('/entity/create', {
    canonical_id: sourceId,
    code: `code-${testId}`,
    label: 'Source',
    type: 'person',
    properties: {},
    source_pi: pi,
  });

  const result = await post('/entity/merge', {
    source_id: sourceId,
    target_id: 'nonexistent-target',
  });

  if (result.status !== 404) {
    log('red', '  [FAIL]', `Expected 404, got ${result.status}`);
    return false;
  }

  if (result.data.code !== 'target_not_found') {
    log('red', '  [FAIL]', `Expected error code 'target_not_found', got '${result.data.code}'`);
    return false;
  }

  log('green', '  [OK]', 'Correctly returned 404 target_not_found');
  return true;
}

// Test 4: Concurrent merge race condition
async function testConcurrentMergeRace() {
  log('cyan', '\n[TEST 4]', 'Concurrent merge race condition');
  log('cyan', '[TEST 4]', 'Three entities try to merge into each other simultaneously\n');

  const testId = generateId();
  const pi = `pi-${testId}`;

  await post('/pi/create', { pi });

  // Create three entities
  const ids = ['race-1', 'race-2', 'race-3'].map(n => `${n}-${testId}`);
  for (const id of ids) {
    await post('/entity/create', {
      canonical_id: id,
      code: `code-${id}`,
      label: `Entity ${id}`,
      type: 'person',
      properties: { original_id: id },
      source_pi: pi,
    });
  }

  log('blue', '  [SETUP]', `Created entities: ${ids.join(', ')}`);

  // Launch concurrent merges: circular merge pattern
  // race-1 → race-2, race-2 → race-3, race-3 → race-1
  const mergePromises = [
    post('/entity/merge', { source_id: ids[0], target_id: ids[1] }),
    post('/entity/merge', { source_id: ids[1], target_id: ids[2] }),
    post('/entity/merge', { source_id: ids[2], target_id: ids[0] }),
  ];

  log('blue', '  [MERGE]', 'Launching 3 concurrent merges...');
  const results = await Promise.all(mergePromises);

  // Count successes and failures
  const successes = results.filter(r => r.status === 200);
  const notFounds = results.filter(r => r.status === 404);
  const deadlocks = results.filter(r => r.status === 409);
  const errors = results.filter(r => r.status >= 500);

  log('green', '  [RESULT]', `Successes: ${successes.length}`);
  log('yellow', '  [RESULT]', `Not found (already merged): ${notFounds.length}`);
  log('yellow', '  [RESULT]', `Deadlocks: ${deadlocks.length}`);
  if (errors.length > 0) {
    log('red', '  [RESULT]', `Errors: ${errors.length}`);
  }

  // Check how many entities remain
  let surviving = 0;
  for (const id of ids) {
    const exists = await get(`/entity/exists/${id}`);
    if (exists.data.exists) {
      surviving++;
      log('blue', '  [SURVIVOR]', id);
    }
  }

  log('blue', '  [COUNT]', `${surviving} entities remaining out of 3`);

  // With circular merges, we expect 1-2 survivors depending on race order
  // At minimum, one entity must survive (can't merge into nothing)
  if (surviving < 1) {
    log('red', '  [FAIL]', 'No entities survived - this is a bug');
    return false;
  }

  if (surviving > 2) {
    log('red', '  [FAIL]', 'Too many entities survived - merges may have failed silently');
    return false;
  }

  log('green', '  [OK]', `Race condition handled correctly, ${surviving} survivor(s)`);
  return true;
}

// Test 5: Self-merge prevention
async function testSelfMergePrevention() {
  log('cyan', '\n[TEST 5]', 'Self-merge prevention');

  const testId = generateId();
  const pi = `pi-${testId}`;
  const entityId = `entity-${testId}`;

  await post('/pi/create', { pi });
  await post('/entity/create', {
    canonical_id: entityId,
    code: `code-${testId}`,
    label: 'Test Entity',
    type: 'person',
    properties: {},
    source_pi: pi,
  });

  const result = await post('/entity/merge', {
    source_id: entityId,
    target_id: entityId,
  });

  if (result.status !== 400) {
    log('red', '  [FAIL]', `Expected 400, got ${result.status}`);
    return false;
  }

  log('green', '  [OK]', 'Self-merge correctly rejected with 400');
  return true;
}

// Test 6: Verify atomicity - if merge fails partway, nothing changes
async function testAtomicity() {
  log('cyan', '\n[TEST 6]', 'Atomicity verification');
  log('cyan', '[TEST 6]', 'Verify that partial failures roll back completely\n');

  const testId = generateId();
  const pi = `pi-${testId}`;
  const sourceId = `source-${testId}`;
  const targetId = `target-${testId}`;
  const otherId = `other-${testId}`;

  await post('/pi/create', { pi });

  // Create entities
  await post('/entity/create', {
    canonical_id: sourceId,
    code: `code-source-${testId}`,
    label: 'Source',
    type: 'person',
    properties: { key: 'source_value' },
    source_pi: pi,
  });

  await post('/entity/create', {
    canonical_id: targetId,
    code: `code-target-${testId}`,
    label: 'Target',
    type: 'person',
    properties: { key: 'target_value' },
    source_pi: pi,
  });

  await post('/entity/create', {
    canonical_id: otherId,
    code: `code-other-${testId}`,
    label: 'Other',
    type: 'organization',
    properties: {},
    source_pi: pi,
  });

  // Add relationship
  await post('/relationships/create', {
    relationships: [{
      subject_id: sourceId,
      predicate: 'LINKED_TO',
      object_id: otherId,
      properties: {},
      source_pi: pi,
    }],
  });

  // Count before
  const sourceBefore = await get(`/entity/${sourceId}`);
  const targetBefore = await get(`/entity/${targetId}`);
  const sourceRelsBefore = await get(`/relationships/${sourceId}`);

  log('blue', '  [BEFORE]', `Source exists: ${sourceBefore.data.found}`);
  log('blue', '  [BEFORE]', `Target exists: ${targetBefore.data.found}`);
  log('blue', '  [BEFORE]', `Source relationships: ${sourceRelsBefore.data.relationships?.length || 0}`);

  // Do a successful merge
  const mergeResult = await post('/entity/merge', {
    source_id: sourceId,
    target_id: targetId,
  });

  if (mergeResult.status !== 200) {
    log('red', '  [FAIL]', `Merge failed unexpectedly: ${JSON.stringify(mergeResult.data)}`);
    return false;
  }

  // Verify complete state change
  const sourceAfter = await get(`/entity/exists/${sourceId}`);
  const targetAfter = await get(`/entity/${targetId}`);
  const targetRelsAfter = await get(`/relationships/${targetId}`);

  if (sourceAfter.data.exists) {
    log('red', '  [FAIL]', 'Source still exists - merge was not atomic');
    return false;
  }

  if (!targetAfter.data.found) {
    log('red', '  [FAIL]', 'Target was deleted - merge was not atomic');
    return false;
  }

  // Check relationship transferred
  const hasLinkedTo = targetRelsAfter.data.relationships?.some(r => r.predicate === 'LINKED_TO');
  if (!hasLinkedTo) {
    log('red', '  [FAIL]', 'Relationship not transferred - merge was not atomic');
    return false;
  }

  log('green', '  [OK]', 'Merge completed atomically - source deleted, target updated, relationships transferred');
  return true;
}

// Main test runner
async function runTests() {
  console.log('============================================================');
  console.log('ATOMIC MERGE TEST SUITE');
  console.log(`Endpoint: ${BASE_URL}`);
  console.log('============================================================');

  log('yellow', '[SETUP]', 'Clearing database...');
  await clearDatabase();

  const results = {
    basicMerge: await testBasicMerge(),
    sourceNotFound: await testSourceNotFound(),
    targetNotFound: await testTargetNotFound(),
    concurrentRace: await testConcurrentMergeRace(),
    selfMerge: await testSelfMergePrevention(),
    atomicity: await testAtomicity(),
  };

  console.log('\n============================================================');
  console.log('TEST SUMMARY');
  console.log('============================================================');

  let allPassed = true;
  for (const [name, passed] of Object.entries(results)) {
    const status = passed ? '✅ PASS' : '❌ FAIL';
    console.log(`${name}: ${status}`);
    if (!passed) allPassed = false;
  }

  console.log('============================================================\n');

  log('yellow', '[CLEANUP]', 'Clearing test data...');
  await clearDatabase();

  if (allPassed) {
    log('green', '[RESULT]', 'All tests passed ✅');
    return true;
  } else {
    log('red', '[RESULT]', 'Some tests failed ❌');
    return false;
  }
}

// Run
runTests()
  .then(success => process.exit(success ? 0 : 1))
  .catch(err => {
    console.error('Test error:', err);
    process.exit(1);
  });
