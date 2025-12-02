/**
 * Test Property Merging on /entity/create
 *
 * Verifies that:
 * 1. ON MATCH updates label and code
 * 2. ON MATCH merges properties (existing + new)
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

const id = `test-merge-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
let passed = 0, failed = 0;

function assert(cond, msg) {
  if (cond) { console.log(`  \x1b[32m✓\x1b[0m ${msg}`); passed++; }
  else { console.log(`  \x1b[31m✗\x1b[0m ${msg}`); failed++; }
}

async function run() {
  console.log('\n\x1b[34m🧪 Testing Property Merging on /entity/create\x1b[0m\n');

  const piId = `pi-${id}`;
  const entityId = `entity-${id}`;

  // 1. Create PI with initial label
  console.log('\x1b[36m[1]\x1b[0m Create PI entity with initial label');
  const createResult = await post('/entity/create', {
    canonical_id: piId,
    code: `pi_${piId}`,
    label: 'Initial Label',
    type: 'pi',
    properties: { initial: true },
    source_pi: piId,
  });

  if (createResult.status !== 200) {
    console.log('Create failed:', createResult.data);
  }

  let r1 = await get(`/entity/${piId}`);
  assert(r1.data.entity?.label === 'Initial Label', `Label is 'Initial Label' (got: ${r1.data.entity?.label})`);
  assert(r1.data.entity?.properties?.initial === true, `properties.initial = true`);

  // 2. Update PI with new label and additional properties
  console.log('\n\x1b[36m[2]\x1b[0m Update PI with new label and merge properties');
  const updateResult = await post('/entity/create', {
    canonical_id: piId,
    code: `pi_${piId}`,
    label: 'Updated Label',
    type: 'pi',
    properties: { updated: true, file_cid: 'QmTest123' },
    source_pi: piId,
  });

  if (updateResult.status !== 200) {
    console.log('Update failed:', updateResult.data);
  }

  let r2 = await get(`/entity/${piId}`);
  assert(r2.data.entity?.label === 'Updated Label', `Label updated to 'Updated Label' (got: ${r2.data.entity?.label})`);
  assert(r2.data.entity?.properties?.initial === true, `properties.initial still true (merged)`);
  assert(r2.data.entity?.properties?.updated === true, `properties.updated = true (added)`);
  assert(r2.data.entity?.properties?.file_cid === 'QmTest123', `properties.file_cid = 'QmTest123' (added)`);

  // 3. Test non-PI entity property merging
  console.log('\n\x1b[36m[3]\x1b[0m Test non-PI entity property merging');
  await post('/entity/create', {
    canonical_id: entityId,
    code: 'test_entity',
    label: 'Original Name',
    type: 'file',
    properties: { original: true },
    source_pi: piId,
  });

  let r3a = await get(`/entity/${entityId}`);
  assert(r3a.data.entity?.label === 'Original Name', `Label is 'Original Name'`);

  // Update the entity
  await post('/entity/create', {
    canonical_id: entityId,
    code: 'test_entity',
    label: 'New Name',
    type: 'file',
    properties: { file_cid: 'QmFile456', content_type: 'application/pdf' },
    source_pi: piId,
  });

  let r3b = await get(`/entity/${entityId}`);
  assert(r3b.data.entity?.label === 'New Name', `Label updated to 'New Name' (got: ${r3b.data.entity?.label})`);
  assert(r3b.data.entity?.properties?.original === true, `properties.original still true (merged)`);
  assert(r3b.data.entity?.properties?.file_cid === 'QmFile456', `properties.file_cid added`);
  assert(r3b.data.entity?.properties?.content_type === 'application/pdf', `properties.content_type added`);

  // Cleanup
  console.log('\n\x1b[33m🧹 Cleanup\x1b[0m');
  await del(`/entity/${entityId}`);
  await del(`/entity/${piId}`);

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  if (failed === 0) {
    console.log(`\x1b[32m✅ ALL TESTS PASSED\x1b[0m (${passed}/${passed})`);
  } else {
    console.log(`\x1b[31m❌ ${failed} TESTS FAILED\x1b[0m (${passed} passed)`);
    process.exit(1);
  }
}

run().catch(e => { console.error('Error:', e); process.exit(1); });
