/**
 * Test Core Endpoints
 *
 * Quick smoke test of all major endpoints
 */

const BASE_URL = process.env.TEST_URL || 'http://localhost:8789';

async function request(method, endpoint, body) {
  const options = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) options.body = JSON.stringify(body);
  const response = await fetch(`${BASE_URL}${endpoint}`, options);
  return { status: response.status, data: await response.json() };
}

const post = (e, b) => request('POST', e, b);
const get = (e) => request('GET', e);
const del = (e) => request('DELETE', e);

const id = `test-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
let passed = 0, failed = 0;

function assert(cond, msg) {
  if (cond) { console.log(`  \x1b[32m✓\x1b[0m ${msg}`); passed++; }
  else { console.log(`  \x1b[31m✗\x1b[0m ${msg}`); failed++; }
}

async function run() {
  console.log('\n\x1b[34m🧪 Testing Core Endpoints\x1b[0m\n');

  const piId = `test-pi-${id}`;
  const entity1Id = `test-entity1-${id}`;
  const entity2Id = `test-entity2-${id}`;

  // 1. POST /pi/create
  console.log('\x1b[36m[1]\x1b[0m POST /pi/create');
  const r1 = await post('/pi/create', { pi: piId });
  assert(r1.status === 200, `Creates PI entity`);

  // 2. POST /entity/create
  console.log('\n\x1b[36m[2]\x1b[0m POST /entity/create');
  const r2 = await post('/entity/create', {
    canonical_id: entity1Id,
    code: `code-${id}`,
    label: 'Test Entity 1',
    type: 'person',
    properties: { role: 'tester' },
    source_pi: piId,
  });
  assert(r2.status === 200, `Creates entity`);

  // 3. GET /entity/:id
  console.log('\n\x1b[36m[3]\x1b[0m GET /entity/:id');
  const r3 = await get(`/entity/${entity1Id}`);
  assert(r3.status === 200 && r3.data.found, `Gets entity by ID`);

  // 4. GET /entity/exists/:id
  console.log('\n\x1b[36m[4]\x1b[0m GET /entity/exists/:id');
  const r4 = await get(`/entity/exists/${entity1Id}`);
  assert(r4.status === 200 && r4.data.exists === true, `Checks entity exists`);

  // 5. POST /entity/query
  console.log('\n\x1b[36m[5]\x1b[0m POST /entity/query');
  const r5 = await post('/entity/query', { code: `code-${id}` });
  assert(r5.status === 200 && r5.data.found, `Queries entity by code`);

  // 6. POST /entities/list
  console.log('\n\x1b[36m[6]\x1b[0m POST /entities/list');
  const r6 = await post('/entities/list', { pi: piId });
  assert(r6.status === 200 && r6.data.total_count === 1, `Lists entities from PI`);

  // 7. POST /entities/lookup-by-code
  console.log('\n\x1b[36m[7]\x1b[0m POST /entities/lookup-by-code');
  const r7 = await post('/entities/lookup-by-code', { code: `code-${id}` });
  assert(r7.status === 200 && r7.data.count === 1, `Looks up by code`);

  // 8. Create second entity for relationship test
  await post('/entity/create', {
    canonical_id: entity2Id,
    code: `code2-${id}`,
    label: 'Test Entity 2',
    type: 'organization',
    properties: {},
    source_pi: piId,
  });

  // 9. POST /relationships/create
  console.log('\n\x1b[36m[8]\x1b[0m POST /relationships/create');
  const r8 = await post('/relationships/create', {
    relationships: [{
      subject_id: entity1Id,
      predicate: 'works_at',
      object_id: entity2Id,
      properties: { since: '2024' },
      source_pi: piId,
    }],
  });
  assert(r8.status === 200, `Creates relationship`);

  // 10. GET /relationships/:id
  console.log('\n\x1b[36m[9]\x1b[0m GET /relationships/:id');
  const r9 = await get(`/relationships/${entity1Id}`);
  assert(r9.status === 200 && r9.data.total_count === 1, `Gets relationships`);

  // 11. POST /relationships/merge
  console.log('\n\x1b[36m[10]\x1b[0m POST /relationships/merge');
  const r10 = await post('/relationships/merge', {
    relationships: [{
      subject_id: entity1Id,
      predicate: 'works_at',
      object_id: entity2Id,
      properties: { since: '2024', updated: true },
      source_pi: piId,
    }],
  });
  assert(r10.status === 200, `Merges relationship (idempotent)`);

  // 12. POST /pi/lineage
  console.log('\n\x1b[36m[11]\x1b[0m POST /pi/lineage');
  const childPi = `child-pi-${id}`;
  await post('/pi/create', { pi: childPi, parent: piId });
  const r11 = await post('/pi/lineage', { sourcePi: childPi, direction: 'ancestors', maxHops: 10 });
  assert(r11.status === 200 && r11.data.ancestors.count === 1, `Gets PI lineage`);

  // 13. POST /entities/find-in-lineage
  console.log('\n\x1b[36m[12]\x1b[0m POST /entities/find-in-lineage');
  const r12 = await post('/entities/find-in-lineage', {
    sourcePi: childPi,
    candidateIds: [entity1Id],
    maxHops: 10,
  });
  assert(r12.status === 200 && r12.data.found, `Finds entity in lineage`);

  // Cleanup
  console.log('\n\x1b[33m🧹 Cleanup\x1b[0m');
  await del(`/entity/${entity1Id}`);
  await del(`/entity/${entity2Id}`);
  await del(`/entity/${piId}`);
  await del(`/entity/${childPi}`);

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  if (failed === 0) {
    console.log(`\x1b[32m✅ ALL TESTS PASSED\x1b[0m (${passed}/${passed})`);
  } else {
    console.log(`\x1b[31m❌ ${failed} TESTS FAILED\x1b[0m (${passed} passed)`);
    process.exit(1);
  }
}

run().catch(e => { console.error('Error:', e); process.exit(1); });
