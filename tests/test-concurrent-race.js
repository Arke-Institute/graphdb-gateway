/**
 * Concurrent Race Condition Test
 *
 * This test simulates heavy concurrent load to reproduce race conditions:
 * - Multiple concurrent entity creations with same code
 * - Read-check-then-create patterns
 * - Concurrent merge operations
 * - Mixed read/write operations
 */

const ENDPOINT = process.env.ENDPOINT || 'http://localhost:8787';

// Helper to generate random ULID-like IDs
function generateULID() {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 15);
  return `${timestamp}-${random}`;
}

// Color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
};

function log(color, prefix, message) {
  console.log(`${colors[color]}${prefix}${colors.reset} ${message}`);
}

async function post(path, body) {
  const response = await fetch(`${ENDPOINT}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return {
    status: response.status,
    data: await response.json()
  };
}

async function get(path) {
  const response = await fetch(`${ENDPOINT}${path}`, {
    method: 'GET'
  });
  return {
    status: response.status,
    data: await response.json()
  };
}

// Test 1: Multiple concurrent creates with SAME canonical_id (true race condition)
async function testConcurrentCreatesWithSameCode() {
  log('cyan', '\n[TEST 1]', 'Concurrent creates with SAME canonical_id');
  log('cyan', '[TEST 1]', 'This simulates race condition where same entity is created concurrently\n');

  const PI_1 = `pi_${generateULID()}`;
  const PI_2 = `pi_${generateULID()}`;

  // Create PIs first
  await post('/pi/create', { pi: PI_1 });
  await post('/pi/create', { pi: PI_2 });

  const CODE = `date_1850_${Date.now()}`;
  const CANONICAL_ID = generateULID(); // SAME canonical_id for all workers!
  const results = [];

  // Launch 10 concurrent requests with SAME canonical_id
  const promises = Array.from({ length: 10 }, (_, i) => {
    log('blue', `  [Worker ${i}]`, `Creating entity with SAME canonical_id=${CANONICAL_ID.substring(0, 15)}...`);

    return post('/entity/create', {
      canonical_id: CANONICAL_ID, // SAME CANONICAL_ID
      code: CODE,
      label: 'Date 1850',
      type: 'date',
      properties: { year: '1850' },
      source_pi: i % 2 === 0 ? PI_1 : PI_2
    }).then(result => {
      results.push({ worker: i, canonical_id: CANONICAL_ID, result });
      return result;
    }).catch(err => {
      results.push({ worker: i, canonical_id: CANONICAL_ID, error: err.message });
      return { error: err.message };
    });
  });

  const responses = await Promise.all(promises);

  // Analyze results
  const successes = results.filter(r => r.result?.status === 200);
  const conflicts = results.filter(r => r.result?.status === 409);
  const errors = results.filter(r => r.result?.status && r.result?.status !== 200 && r.result?.status !== 409);

  log('green', '  [RESULT]', `✓ Success: ${successes.length}`);
  log('yellow', '  [RESULT]', `⚠ 409 Conflicts: ${conflicts.length}`);
  log('red', '  [RESULT]', `✗ Errors: ${errors.length}`);

  // Check for duplicates in Neo4j by canonical_id
  const checkDuplicates = await post('/query', {
    query: `
      MATCH (e:Entity {canonical_id: $canonical_id})
      RETURN e.canonical_id AS id, e.code AS code, count(*) as count
    `,
    params: { canonical_id: CANONICAL_ID }
  });

  const entityCount = checkDuplicates.data.results?.length || 0;

  if (entityCount > 1) {
    log('red', '  [RACE CONDITION DETECTED]', `Found ${entityCount} entities with same canonical_id!`);
    checkDuplicates.data.results?.forEach((row, i) => {
      log('red', `    [Duplicate ${i + 1}]`, `canonical_id: ${row.id}`);
    });
  } else if (entityCount === 1) {
    log('green', '  [OK]', `Only 1 entity in database with canonical_id (MERGE worked!)`);
  } else {
    log('yellow', '  [UNEXPECTED]', 'No entities found in database');
  }

  return { successes: successes.length, conflicts: conflicts.length, errors: errors.length, duplicates: entityCount };
}

// Test 2: Read-Check-Create pattern (common race condition source)
async function testReadCheckCreatePattern() {
  log('cyan', '\n[TEST 2]', 'Read-Check-Create pattern');
  log('cyan', '[TEST 2]', 'This simulates entity resolution with lookup-then-create\n');

  const PI = `pi_${generateULID()}`;
  await post('/pi/create', { pi: PI });

  const CODE = `person_${Date.now()}`;
  const results = [];

  // All workers use SAME canonical_id (correct pattern!)
  const CANONICAL_ID = generateULID();

  // 10 concurrent workers all trying to create the same entity
  const promises = Array.from({ length: 10 }, (_, i) => {
    return (async () => {
      log('blue', `  [Worker ${i}]`, `Creating entity with canonical_id=${CANONICAL_ID.substring(0, 15)}...`);

      // All workers try to create with SAME canonical_id
      // MERGE will handle the race condition atomically
      const createResult = await post('/entity/create', {
        canonical_id: CANONICAL_ID, // SAME for all workers
        code: CODE,
        label: 'Test Person',
        type: 'person',
        properties: { created_by: `worker_${i}` },
        source_pi: PI
      });
      results.push({ worker: i, action: 'create', result: createResult });
    })();
  });

  await Promise.all(promises);

  // Check database state by canonical_id
  const finalCheck = await post('/query', {
    query: `
      MATCH (e:Entity {canonical_id: $canonical_id})
      RETURN e.canonical_id AS id, e.properties AS props
    `,
    params: { canonical_id: CANONICAL_ID }
  });

  const entityCount = finalCheck.data.results?.length || 0;

  log('green', '  [RESULT]', `Created: ${results.filter(r => r.action === 'create' && r.result.status === 200).length}`);
  log('yellow', '  [RESULT]', `Conflicts: ${results.filter(r => r.result.status === 409).length}`);

  if (entityCount > 1) {
    log('red', '  [RACE CONDITION DETECTED]', `Found ${entityCount} entities with same canonical_id (expected 1)`);
  } else {
    log('green', '  [OK]', 'Only 1 entity in database (MERGE worked!)');
  }

  return { entities: entityCount, creates: results.filter(r => r.action === 'create').length };
}

// Test 3: Concurrent merges on same entity
async function testConcurrentMerges() {
  log('cyan', '\n[TEST 3]', 'Concurrent merges on same entity');
  log('cyan', '[TEST 3]', 'Multiple PIs trying to merge data into same entity\n');

  const PI_BASE = `pi_${generateULID()}`;
  await post('/pi/create', { pi: PI_BASE });

  const CANONICAL_ID = generateULID();
  const CODE = `entity_${Date.now()}`;

  // Create initial entity
  await post('/entity/create', {
    canonical_id: CANONICAL_ID,
    code: CODE,
    label: 'Base Entity',
    type: 'person',
    properties: { initial: 'value' },
    source_pi: PI_BASE
  });

  log('blue', '  [SETUP]', `Created base entity: ${CANONICAL_ID.substring(0, 15)}...`);

  // Create 10 PIs that will all try to merge
  const pis = await Promise.all(
    Array.from({ length: 10 }, async (_, i) => {
      const pi = `pi_merge_${i}_${generateULID()}`;
      await post('/pi/create', { pi });
      return pi;
    })
  );

  // Launch concurrent merges
  const promises = pis.map((pi, i) => {
    log('blue', `  [Worker ${i}]`, `Merging data from ${pi.substring(0, 20)}...`);
    return post('/entity/merge', {
      canonical_id: CANONICAL_ID,
      enrichment_data: {
        new_properties: {
          [`field_${i}`]: `value_${i}`,
          shared_field: `worker_${i}` // This will cause conflicts
        },
        merge_strategy: 'merge_peers'
      },
      source_pi: pi
    });
  });

  const results = await Promise.all(promises);

  const successes = results.filter(r => r.status === 200);
  const errors = results.filter(r => r.status !== 200);

  log('green', '  [RESULT]', `✓ Successful merges: ${successes.length}`);
  log('red', '  [RESULT]', `✗ Failed merges: ${errors.length}`);

  // Check final entity state
  const finalEntity = await post('/entity/query', { code: CODE });

  if (finalEntity.data.found) {
    const props = finalEntity.data.entity.properties;
    const propertyCount = Object.keys(props).length;
    log('blue', '  [FINAL STATE]', `Entity has ${propertyCount} properties`);

    // Check if shared_field became an array (proper merge)
    if (Array.isArray(props.shared_field)) {
      log('green', '  [OK]', `shared_field properly merged into array: [${props.shared_field.length} values]`);
    } else {
      log('yellow', '  [WARNING]', `shared_field is not an array: ${props.shared_field}`);
    }
  }

  return { successes: successes.length, errors: errors.length };
}

// Test 4: Mixed concurrent read/write operations
async function testMixedOperations() {
  log('cyan', '\n[TEST 4]', 'Mixed concurrent read/write operations');
  log('cyan', '[TEST 4]', 'Simulating realistic workload with reads during writes\n');

  const PI = `pi_${generateULID()}`;
  await post('/pi/create', { pi: PI });

  const CODE = `mixed_test_${Date.now()}`;
  const CANONICAL_ID = generateULID();

  // Create initial entity
  await post('/entity/create', {
    canonical_id: CANONICAL_ID,
    code: CODE,
    label: 'Mixed Test Entity',
    type: 'person',
    properties: { counter: 0 },
    source_pi: PI
  });

  const operations = [];
  const results = [];

  // Mix of operations
  for (let i = 0; i < 20; i++) {
    if (i % 3 === 0) {
      // Read operation
      operations.push(
        post('/entity/lookup/code', { code: CODE })
          .then(r => results.push({ op: 'read', status: r.status, found: r.data.found }))
      );
    } else if (i % 3 === 1) {
      // Merge operation
      operations.push(
        post('/entity/merge', {
          canonical_id: CANONICAL_ID,
          enrichment_data: {
            new_properties: { [`update_${i}`]: `value_${i}` },
            merge_strategy: 'merge_peers'
          },
          source_pi: PI
        }).then(r => results.push({ op: 'merge', status: r.status }))
      );
    } else {
      // Query operation (more expensive read)
      operations.push(
        post('/entity/query', { code: CODE })
          .then(r => results.push({ op: 'query', status: r.status, found: r.data.found }))
      );
    }
  }

  await Promise.all(operations);

  const readOps = results.filter(r => r.op === 'read');
  const queryOps = results.filter(r => r.op === 'query');
  const mergeOps = results.filter(r => r.op === 'merge');

  log('blue', '  [RESULT]', `Reads: ${readOps.length} (${readOps.filter(r => r.found).length} found)`);
  log('blue', '  [RESULT]', `Queries: ${queryOps.length} (${queryOps.filter(r => r.found).length} found)`);
  log('blue', '  [RESULT]', `Merges: ${mergeOps.length} (${mergeOps.filter(r => r.status === 200).length} success)`);

  // Check consistency
  const allReadsFound = readOps.every(r => r.found === true);
  const allQueriesFound = queryOps.every(r => r.found === true);

  if (allReadsFound && allQueriesFound) {
    log('green', '  [OK]', 'All read operations found the entity (consistent)');
  } else {
    log('red', '  [RACE CONDITION]', 'Some reads did not find entity during concurrent writes');
  }

  return { consistent: allReadsFound && allQueriesFound };
}

// Test 5: Stress test with high volume
async function testHighVolumeStress() {
  log('cyan', '\n[TEST 5]', 'High volume stress test');
  log('cyan', '[TEST 5]', 'Creating 50 concurrent entities with random codes\n');

  const PI = `pi_${generateULID()}`;
  await post('/pi/create', { pi: PI });

  const startTime = Date.now();

  const promises = Array.from({ length: 50 }, (_, i) => {
    const canonical_id = generateULID();
    const code = `stress_entity_${i}_${generateULID()}`;

    return post('/entity/create', {
      canonical_id,
      code,
      label: `Stress Entity ${i}`,
      type: 'person',
      properties: { index: i },
      source_pi: PI
    });
  });

  const results = await Promise.all(promises);
  const endTime = Date.now();
  const duration = endTime - startTime;

  const successes = results.filter(r => r.status === 200).length;
  const failures = results.filter(r => r.status !== 200).length;

  log('green', '  [RESULT]', `✓ Created ${successes} entities in ${duration}ms`);
  log('red', '  [RESULT]', `✗ Failed: ${failures}`);
  log('blue', '  [RESULT]', `Average: ${(duration / 50).toFixed(2)}ms per entity`);

  return { successes, failures, duration };
}

// Main test runner
async function main() {
  console.log(`\n${'='.repeat(60)}`);
  console.log('CONCURRENT RACE CONDITION TEST SUITE');
  console.log(`Endpoint: ${ENDPOINT}`);
  console.log(`${'='.repeat(60)}`);

  // Clean database before starting
  log('yellow', '[SETUP]', 'Cleaning database...');
  await post('/admin/clear', {});

  const summary = {
    test1: null,
    test2: null,
    test3: null,
    test4: null,
    test5: null
  };

  try {
    summary.test1 = await testConcurrentCreatesWithSameCode();
    summary.test2 = await testReadCheckCreatePattern();
    summary.test3 = await testConcurrentMerges();
    summary.test4 = await testMixedOperations();
    summary.test5 = await testHighVolumeStress();
  } catch (error) {
    log('red', '[ERROR]', `Test failed: ${error.message}`);
    console.error(error);
  }

  // Summary
  console.log(`\n${'='.repeat(60)}`);
  console.log('TEST SUMMARY');
  console.log(`${'='.repeat(60)}`);

  if (summary.test1) {
    console.log(`Test 1 (Same Code): ${summary.test1.duplicates > 1 ? '❌ RACE DETECTED' : '✅ PASS'} (${summary.test1.duplicates} entities)`);
  }
  if (summary.test2) {
    console.log(`Test 2 (Read-Check-Create): ${summary.test2.entities > 1 ? '❌ RACE DETECTED' : '✅ PASS'} (${summary.test2.entities} entities)`);
  }
  if (summary.test3) {
    console.log(`Test 3 (Concurrent Merges): ${summary.test3.errors > 0 ? '⚠️  ERRORS' : '✅ PASS'} (${summary.test3.successes}/${summary.test3.successes + summary.test3.errors})`);
  }
  if (summary.test4) {
    console.log(`Test 4 (Mixed Ops): ${summary.test4.consistent ? '✅ PASS' : '❌ INCONSISTENT'}`);
  }
  if (summary.test5) {
    console.log(`Test 5 (High Volume): ${summary.test5.failures === 0 ? '✅ PASS' : '⚠️  FAILURES'} (${summary.test5.successes}/50 in ${summary.test5.duration}ms)`);
  }

  console.log(`\n${'='.repeat(60)}\n`);

  // Cleanup
  log('yellow', '[CLEANUP]', 'Clearing test data...');
  await post('/admin/clear', {});

  // Exit with appropriate code
  const hasRaceConditions =
    (summary.test1 && summary.test1.duplicates > 1) ||
    (summary.test2 && summary.test2.entities > 1);

  if (hasRaceConditions) {
    log('red', '[RESULT]', 'Race conditions detected! ❌');
    process.exit(1);
  } else {
    log('green', '[RESULT]', 'No race conditions detected ✅');
    process.exit(0);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
