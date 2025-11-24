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
  console.log(`Testing redirect-relationships endpoint at: ${ENDPOINT}\n`);

  // Setup
  console.log('==========================================');
  console.log('Setup: Creating test entities and relationships');
  console.log('==========================================');

  const PI_ID = `test_redirect_pi_${Date.now()}`;
  const ENTITY_A_ID = `redirect-test-entity-a-${Date.now()}`;
  const ENTITY_B_ID = `redirect-test-entity-b-${Date.now()}`;
  const ENTITY_C_ID = `redirect-test-entity-c-${Date.now()}`;
  const ENTITY_D_ID = `redirect-test-entity-d-${Date.now()}`;

  console.log('Creating test PI...');
  await post('/pi/create', { pi: PI_ID });

  console.log('Creating entity A (duplicate)...');
  await post('/entity/create', {
    canonical_id: ENTITY_A_ID,
    code: 'entity_a',
    label: 'Entity A',
    type: 'person',
    properties: { role: 'researcher' },
    source_pi: PI_ID
  });

  console.log('Creating entity B (canonical)...');
  await post('/entity/create', {
    canonical_id: ENTITY_B_ID,
    code: 'entity_b',
    label: 'Entity B',
    type: 'person',
    properties: { role: 'professor' },
    source_pi: PI_ID
  });

  console.log('Creating target entity C...');
  await post('/entity/create', {
    canonical_id: ENTITY_C_ID,
    code: 'entity_c',
    label: 'Entity C',
    type: 'organization',
    properties: { name: 'University' },
    source_pi: PI_ID
  });

  console.log('Creating source entity D...');
  await post('/entity/create', {
    canonical_id: ENTITY_D_ID,
    code: 'entity_d',
    label: 'Entity D',
    type: 'organization',
    properties: { name: 'Lab' },
    source_pi: PI_ID
  });

  console.log('Creating relationships...');
  await post('/relationships/create', {
    relationships: [
      {
        subject_id: ENTITY_A_ID,
        predicate: 'affiliated_with',
        object_id: ENTITY_C_ID,
        properties: { since: '2020' },
        source_pi: PI_ID
      },
      {
        subject_id: ENTITY_D_ID,
        predicate: 'employs',
        object_id: ENTITY_A_ID,
        properties: { position: 'researcher' },
        source_pi: PI_ID
      }
    ]
  });

  console.log('Setup complete!\n');

  // Test 1
  console.log('==========================================');
  console.log('Test 1: Basic redirect (2 relationships)');
  console.log('==========================================');

  const redirectResponse = await post('/entity/redirect-relationships', {
    from_id: ENTITY_A_ID,
    to_id: ENTITY_B_ID,
    preserve_provenance: true
  });

  await test('Redirect returns success', '"success":true', redirectResponse);
  await test('Relationships redirected count is 2', '"relationships_redirected":2', redirectResponse);
  await test('Provenance edges merged', '"provenance_edges_merged":1', redirectResponse);

  console.log('');

  // Test 2
  console.log('==========================================');
  console.log('Test 2: Verify relationships transferred');
  console.log('==========================================');

  const queryResponse = await post('/entity/query', { code: 'entity_b' });

  await test('Entity B has relationships', '"found":true', queryResponse);
  await test('Entity B has affiliated_with relationship', 'affiliated_with', queryResponse);
  await test('Entity B has employs relationship', 'employs', queryResponse);

  console.log('');

  // Test 3
  console.log('==========================================');
  console.log('Test 3: Delete entity with relationships (should fail)');
  console.log('==========================================');

  const deleteFailResponse = await del(`/entity/${ENTITY_B_ID}`);

  await test('Delete fails with relationships', 'ENTITY_HAS_RELATIONSHIPS', deleteFailResponse);
  await test('Returns success false', '"success":false', deleteFailResponse);

  console.log('');

  // Test 4
  console.log('==========================================');
  console.log('Test 4: Redirect without provenance, then delete');
  console.log('==========================================');

  // Create new entities for this test
  const ENTITY_E_ID = `redirect-test-entity-e-${Date.now()}`;
  const ENTITY_F_ID = `redirect-test-entity-f-${Date.now()}`;

  await post('/entity/create', {
    canonical_id: ENTITY_E_ID,
    code: 'entity_e',
    label: 'Entity E',
    type: 'person',
    properties: {},
    source_pi: PI_ID
  });

  await post('/entity/create', {
    canonical_id: ENTITY_F_ID,
    code: 'entity_f',
    label: 'Entity F',
    type: 'person',
    properties: {},
    source_pi: PI_ID
  });

  // Redirect WITHOUT preserving provenance
  await post('/entity/redirect-relationships', {
    from_id: ENTITY_E_ID,
    to_id: ENTITY_F_ID,
    preserve_provenance: false
  });

  // Now Entity E should have no relationships and can be deleted
  const deleteSuccessResponse = await del(`/entity/${ENTITY_E_ID}`);

  await test('Delete succeeds without relationships', '"success":true', deleteSuccessResponse);
  await test('Deleted flag is true', '"deleted":true', deleteSuccessResponse);

  // Verify entity is gone
  const verifyDeletedResponse = await post('/entity/query', { code: 'entity_e' });
  await test('Entity E no longer exists', '"found":false', verifyDeletedResponse);

  console.log('');

  // Test 5
  console.log('==========================================');
  console.log('Test 5: Validation errors');
  console.log('==========================================');

  // Missing from_id
  const validationError1 = await post('/entity/redirect-relationships', {
    to_id: ENTITY_B_ID
  });
  await test('Missing from_id returns validation error', 'VALIDATION_ERROR', validationError1);

  // Same from_id and to_id
  const validationError2 = await post('/entity/redirect-relationships', {
    from_id: ENTITY_B_ID,
    to_id: ENTITY_B_ID
  });
  await test('Same from_id and to_id returns validation error', 'VALIDATION_ERROR', validationError2);

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
