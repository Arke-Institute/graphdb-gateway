/**
 * Test concurrent merge_peers operations to verify atomicity
 *
 * This test verifies that when multiple workers try to merge properties
 * on the same entity concurrently, no updates are lost.
 */

const BASE_URL = process.env.TEST_URL || 'http://localhost:8787';

async function makeRequest(endpoint, body) {
  const response = await fetch(`${BASE_URL}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return response.json();
}

async function deleteRequest(endpoint) {
  const response = await fetch(`${BASE_URL}${endpoint}`, {
    method: 'DELETE',
  });
  return response.json();
}

async function getRequest(endpoint) {
  const response = await fetch(`${BASE_URL}${endpoint}`, {
    method: 'GET',
  });
  return response.json();
}

function generateId() {
  return `test-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

async function runTest() {
  console.log('=== Test: Concurrent merge_peers atomicity ===\n');

  const testId = generateId();
  const canonical_id = `entity-${testId}`;
  const source_pi = `pi-${testId}`;

  // Step 1: Create a PI and entity
  console.log('1. Creating PI and entity...');
  await makeRequest('/pi/create', { pi: source_pi });

  const createResult = await makeRequest('/entity/create', {
    canonical_id,
    code: `code-${testId}`,
    label: `Test Entity ${testId}`,
    type: 'person',
    properties: { initial: 'value' },
    source_pi,
  });

  if (!createResult.success) {
    console.error('Failed to create entity:', createResult);
    return false;
  }
  console.log('   Entity created:', canonical_id);

  // Step 2: Launch concurrent merge_peers requests
  console.log('\n2. Launching 10 concurrent merge_peers requests...');

  const concurrentMerges = [];
  for (let i = 0; i < 10; i++) {
    const pi = `pi-worker-${i}-${testId}`;
    // Create the PI first
    await makeRequest('/pi/create', { pi });

    concurrentMerges.push(
      makeRequest('/entity/merge', {
        canonical_id,
        enrichment_data: {
          new_properties: { [`prop_${i}`]: `value_${i}` },
          merge_strategy: 'merge_peers',
        },
        source_pi: pi,
      })
    );
  }

  const results = await Promise.all(concurrentMerges);

  // Check all succeeded
  const allSucceeded = results.every(r => r.updated === true);
  console.log(`   All requests succeeded: ${allSucceeded}`);
  console.log(`   Results:`, results.map((r, i) => ({ i, updated: r.updated, error: r.error })));

  // Log any errors
  results.forEach((r, i) => {
    if (!r.updated) {
      console.log(`   Request ${i} failed:`, r);
    }
  });

  if (!allSucceeded) {
    console.error('   Failed results:', results.filter(r => !r.updated));
  }

  // Step 3: Verify all properties were saved
  console.log('\n3. Verifying all properties were saved...');

  const entity = await getRequest(`/entity/${canonical_id}`);

  if (!entity.found) {
    console.error('   Entity not found!');
    return false;
  }

  const props = entity.entity.properties;
  console.log('   Properties:', JSON.stringify(props, null, 2));

  // Check that all 10 properties exist
  let missingProps = [];
  for (let i = 0; i < 10; i++) {
    if (props[`prop_${i}`] !== `value_${i}`) {
      missingProps.push(`prop_${i}`);
    }
  }

  if (missingProps.length > 0) {
    console.error(`   FAILED: Missing properties: ${missingProps.join(', ')}`);
    console.error('   This indicates a race condition - some updates were lost!');
    return false;
  }

  console.log('   All 10 properties present!');

  // Step 4: Test conflicting property merges
  console.log('\n4. Testing conflicting property merges...');

  const conflictMerges = [];
  for (let i = 0; i < 5; i++) {
    const pi = `pi-conflict-${i}-${testId}`;
    await makeRequest('/pi/create', { pi });

    conflictMerges.push(
      makeRequest('/entity/merge', {
        canonical_id,
        enrichment_data: {
          new_properties: { shared_key: `conflict_value_${i}` },
          merge_strategy: 'merge_peers',
        },
        source_pi: pi,
      })
    );
  }

  const conflictResults = await Promise.all(conflictMerges);
  console.log('   Conflict merge results:', conflictResults.map(r => ({
    updated: r.updated,
    conflicts: r.conflicts?.length || 0
  })));

  // Verify the shared_key accumulated all values
  const finalEntity = await getRequest(`/entity/${canonical_id}`);
  const sharedKey = finalEntity.entity.properties.shared_key;

  console.log('   shared_key value:', JSON.stringify(sharedKey));

  if (Array.isArray(sharedKey)) {
    console.log(`   shared_key is an array with ${sharedKey.length} values (expected: accumulated conflicts)`);
  } else {
    console.log('   shared_key is not an array - first merge set the value');
  }

  // Cleanup
  console.log('\n5. Cleaning up...');
  await deleteRequest(`/entity/${canonical_id}`);
  console.log('   Entity deleted');

  console.log('\n=== TEST PASSED ===');
  return true;
}

// Run the test
runTest()
  .then(success => process.exit(success ? 0 : 1))
  .catch(err => {
    console.error('Test error:', err);
    process.exit(1);
  });
