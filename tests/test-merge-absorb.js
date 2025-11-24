const ENDPOINT = process.env.ENDPOINT || 'http://localhost:8787';

let testsPassedCount = 0;
let testsFailedCount = 0;

async function test(name, expectedValue, actualResponse) {
  const responseText = typeof actualResponse === 'string'
    ? actualResponse
    : JSON.stringify(actualResponse);

  const passed = responseText.includes(expectedValue);

  if (passed) {
    console.log(`  ✓ ${name} ... PASSED`);
    testsPassedCount++;
  } else {
    console.log(`  ✗ ${name} ... FAILED`);
    console.log(`    Expected: ${expectedValue}`);
    console.log(`    Response: ${responseText.substring(0, 200)}`);
    testsFailedCount++;
  }
}

async function post(path, body) {
  const response = await fetch(`${ENDPOINT}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return response.json();
}

async function del(path) {
  const response = await fetch(`${ENDPOINT}${path}`, {
    method: 'DELETE'
  });
  return response.json();
}

async function main() {
  console.log(`Testing merge with absorption at: ${ENDPOINT}\n`);

  // Setup
  console.log('==========================================');
  console.log('Setup: Creating test entities and relationships');
  console.log('==========================================');

  const PI_ID = `test_merge_absorb_pi_${Date.now()}`;
  const DUPLICATE_ID = `duplicate-${Date.now()}`;
  const CANONICAL_ID = `canonical-${Date.now()}`;
  const TARGET_ID = `target-${Date.now()}`;
  const SOURCE_ID = `source-${Date.now()}`;

  console.log('Creating test PI...');
  await post('/pi/create', { pi: PI_ID });

  console.log('Creating duplicate entity (will be absorbed)...');
  await post('/entity/create', {
    canonical_id: DUPLICATE_ID,
    code: 'duplicate',
    label: 'Duplicate Entity',
    type: 'person',
    properties: { role: 'researcher', location: 'Lab A' },
    source_pi: PI_ID
  });

  console.log('Creating canonical entity (will absorb duplicate)...');
  await post('/entity/create', {
    canonical_id: CANONICAL_ID,
    code: 'canonical',
    label: 'Canonical Entity',
    type: 'person',
    properties: { role: 'professor' },
    source_pi: PI_ID
  });

  console.log('Creating target entity for relationships...');
  await post('/entity/create', {
    canonical_id: TARGET_ID,
    code: 'target',
    label: 'Target Entity',
    type: 'organization',
    properties: { name: 'University' },
    source_pi: PI_ID
  });

  console.log('Creating source entity for incoming relationships...');
  await post('/entity/create', {
    canonical_id: SOURCE_ID,
    code: 'source',
    label: 'Source Entity',
    type: 'organization',
    properties: { name: 'Lab' },
    source_pi: PI_ID
  });

  console.log('Creating relationships from duplicate...');
  await post('/relationships/create', {
    relationships: [
      {
        subject_id: DUPLICATE_ID,
        predicate: 'affiliated_with',
        object_id: TARGET_ID,
        properties: { since: '2020' },
        source_pi: PI_ID
      },
      {
        subject_id: SOURCE_ID,
        predicate: 'employs',
        object_id: DUPLICATE_ID,
        properties: { position: 'researcher' },
        source_pi: PI_ID
      }
    ]
  });

  console.log('Setup complete!\n');

  // Test 1: Merge with absorption using merge_peers strategy
  console.log('==========================================');
  console.log('Test 1: Merge with absorption (merge_peers)');
  console.log('==========================================');

  const mergeResponse = await post('/entity/merge', {
    canonical_id: CANONICAL_ID,
    enrichment_data: {
      new_properties: {},
      merge_strategy: 'merge_peers'
    },
    source_pi: PI_ID,
    absorb_duplicate_id: DUPLICATE_ID  // NEW: absorb relationships
  });

  await test('Merge returns success', '"updated":true', mergeResponse);
  await test('Absorbed duplicate ID returned', `"absorbed_duplicate":"${DUPLICATE_ID}"`, mergeResponse);

  console.log('');

  // Test 2: Verify canonical has absorbed relationships
  console.log('==========================================');
  console.log('Test 2: Verify relationships transferred');
  console.log('==========================================');

  const canonicalQuery = await post('/entity/query', { code: 'canonical' });

  await test('Canonical entity exists', '"found":true', canonicalQuery);
  await test('Canonical has affiliated_with relationship', 'affiliated_with', canonicalQuery);
  await test('Canonical has employs relationship', 'employs', canonicalQuery);

  console.log('');

  // Test 3: Verify duplicate was deleted by APOC
  console.log('==========================================');
  console.log('Test 3: Verify duplicate was deleted');
  console.log('==========================================');

  const duplicateQuery = await post('/entity/query', { code: 'duplicate' });

  await test('Duplicate entity no longer exists', '"found":false', duplicateQuery);

  console.log('');

  // Test 4: Verify relationships have correct properties
  console.log('==========================================');
  console.log('Test 4: Verify relationship properties preserved');
  console.log('==========================================');

  await test('Relationship property "since" preserved', 'since', canonicalQuery);
  await test('Relationship property "position" preserved', 'position', canonicalQuery);

  console.log('');

  // Test 5: Test absorption with entities that have no relationships
  console.log('==========================================');
  console.log('Test 5: Absorption with no relationships');
  console.log('==========================================');

  const EMPTY_DUP = `empty-dup-${Date.now()}`;
  const EMPTY_CAN = `empty-can-${Date.now()}`;

  await post('/entity/create', {
    canonical_id: EMPTY_DUP,
    code: 'empty_dup',
    label: 'Empty Dup',
    type: 'person',
    properties: {},
    source_pi: PI_ID
  });

  await post('/entity/create', {
    canonical_id: EMPTY_CAN,
    code: 'empty_can',
    label: 'Empty Can',
    type: 'person',
    properties: {},
    source_pi: PI_ID
  });

  const emptyMerge = await post('/entity/merge', {
    canonical_id: EMPTY_CAN,
    enrichment_data: {
      new_properties: {},
      merge_strategy: 'link_only'
    },
    source_pi: PI_ID,
    absorb_duplicate_id: EMPTY_DUP
  });

  await test('Empty merge succeeds', '"updated":true', emptyMerge);

  const emptyDupCheck = await post('/entity/query', { code: 'empty_dup' });
  await test('Empty duplicate deleted', '"found":false', emptyDupCheck);

  console.log('');

  // Cleanup
  console.log('==========================================');
  console.log('Cleanup: Removing test data');
  console.log('==========================================');

  await post('/admin/clear', {});
  console.log('Cleanup complete!\n');

  // Summary
  console.log('==========================================');
  console.log('Test Summary');
  console.log('==========================================');
  console.log(`Tests passed: ${testsPassedCount}`);
  console.log(`Tests failed: ${testsFailedCount}\n`);

  if (testsFailedCount === 0) {
    console.log('✓ All tests passed!');
    process.exit(0);
  } else {
    console.log('✗ Some tests failed!');
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Error running tests:', err);
  process.exit(1);
});
