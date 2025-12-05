/**
 * Comprehensive tests for the /pi/:pi/purge endpoint
 *
 * Run with: node scripts/test-purge-endpoint.js
 *
 * Requires:
 * - Neo4j running with .dev.vars configured
 * - GraphDB Gateway running locally (npm run dev)
 *
 * Test scenarios:
 * 1. Purge with orphaned entities (entities only sourced from this PI)
 * 2. Purge with merged entities (entities with multiple PI sources)
 * 3. Purge of non-existent PI
 * 4. Purge preserves PI entity itself
 * 5. Purge correctly handles relationships
 * 6. Idempotency (purging twice)
 */

const neo4j = require('neo4j-driver');
require('dotenv').config({ path: '.dev.vars' });

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:8787';

// Test PI identifiers
const TEST_PI_A = 'test-purge-pi-A';
const TEST_PI_B = 'test-purge-pi-B';
const TEST_PI_C = 'test-purge-pi-C'; // Non-existent PI for testing

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(color, ...args) {
  console.log(color, ...args, colors.reset);
}

async function createDriver() {
  const driver = neo4j.driver(
    process.env.NEO4J_URI,
    neo4j.auth.basic(process.env.NEO4J_USERNAME, process.env.NEO4J_PASSWORD)
  );
  return driver;
}

async function cleanupTestData(driver) {
  log(colors.yellow, '\n🧹 Cleaning up any existing test data...');

  const database = process.env.NEO4J_DATABASE || 'neo4j';

  await driver.executeQuery(
    `
    MATCH (n:Entity)
    WHERE n.canonical_id STARTS WITH 'test-purge-'
    DETACH DELETE n
    `,
    {},
    { database }
  );

  log(colors.green, '✓ Test data cleaned up');
}

async function setupTestData(driver) {
  log(colors.blue, '\n📦 Setting up test data...');

  const database = process.env.NEO4J_DATABASE || 'neo4j';

  // Create PI entities
  log(colors.cyan, '  Creating PI entities...');
  await driver.executeQuery(
    `
    // Create PI A
    CREATE (piA:Entity {
      canonical_id: $piA,
      code: 'pi_' + $piA,
      label: $piA,
      type: 'pi',
      properties: '{}',
      created_by_pi: null,
      first_seen: datetime(),
      last_updated: datetime()
    })

    // Create PI B
    CREATE (piB:Entity {
      canonical_id: $piB,
      code: 'pi_' + $piB,
      label: $piB,
      type: 'pi',
      properties: '{}',
      created_by_pi: null,
      first_seen: datetime(),
      last_updated: datetime()
    })

    // PI hierarchy
    CREATE (piA)-[:PARENT_OF]->(piB)
    CREATE (piB)-[:CHILD_OF]->(piA)

    RETURN piA, piB
    `,
    { piA: TEST_PI_A, piB: TEST_PI_B },
    { database }
  );

  // Create orphaned entities (only belong to PI A)
  log(colors.cyan, '  Creating orphaned entities (only sourced from PI A)...');
  await driver.executeQuery(
    `
    MATCH (piA:Entity {canonical_id: $piA, type: 'pi'})

    // Entity 1: Only in PI A (will be deleted)
    CREATE (e1:Entity {
      canonical_id: 'test-purge-entity-orphan-1',
      code: 'orphan_entity_1',
      label: 'Orphan Entity 1',
      type: 'person',
      properties: '{"name": "John Doe"}',
      created_by_pi: $piA,
      first_seen: datetime(),
      last_updated: datetime()
    })
    CREATE (e1)-[:EXTRACTED_FROM {original_code: 'orphan_entity_1', extracted_at: datetime()}]->(piA)

    // Entity 2: Only in PI A (will be deleted)
    CREATE (e2:Entity {
      canonical_id: 'test-purge-entity-orphan-2',
      code: 'orphan_entity_2',
      label: 'Orphan Entity 2',
      type: 'organization',
      properties: '{"type": "university"}',
      created_by_pi: $piA,
      first_seen: datetime(),
      last_updated: datetime()
    })
    CREATE (e2)-[:EXTRACTED_FROM {original_code: 'orphan_entity_2', extracted_at: datetime()}]->(piA)

    RETURN e1, e2
    `,
    { piA: TEST_PI_A },
    { database }
  );

  // Create merged entity (belongs to both PI A and PI B)
  log(colors.cyan, '  Creating merged entity (sourced from both PI A and PI B)...');
  await driver.executeQuery(
    `
    MATCH (piA:Entity {canonical_id: $piA, type: 'pi'})
    MATCH (piB:Entity {canonical_id: $piB, type: 'pi'})

    // Merged entity: In both PI A and PI B (should be detached, not deleted)
    CREATE (merged:Entity {
      canonical_id: 'test-purge-entity-merged',
      code: 'merged_entity',
      label: 'Merged Entity',
      type: 'event',
      properties: '{"description": "A shared event"}',
      created_by_pi: $piA,
      first_seen: datetime(),
      last_updated: datetime()
    })
    CREATE (merged)-[:EXTRACTED_FROM {original_code: 'merged_entity', extracted_at: datetime()}]->(piA)
    CREATE (merged)-[:EXTRACTED_FROM {original_code: 'merged_entity_from_b', extracted_at: datetime()}]->(piB)

    RETURN merged
    `,
    { piA: TEST_PI_A, piB: TEST_PI_B },
    { database }
  );

  // Create entity only in PI B (should not be affected by purging PI A)
  log(colors.cyan, '  Creating entity only in PI B (should not be affected)...');
  await driver.executeQuery(
    `
    MATCH (piB:Entity {canonical_id: $piB, type: 'pi'})

    CREATE (eB:Entity {
      canonical_id: 'test-purge-entity-only-b',
      code: 'entity_only_b',
      label: 'Entity Only in B',
      type: 'place',
      properties: '{"location": "New York"}',
      created_by_pi: $piB,
      first_seen: datetime(),
      last_updated: datetime()
    })
    CREATE (eB)-[:EXTRACTED_FROM {original_code: 'entity_only_b', extracted_at: datetime()}]->(piB)

    RETURN eB
    `,
    { piB: TEST_PI_B },
    { database }
  );

  // Create RELATIONSHIP edges
  log(colors.cyan, '  Creating RELATIONSHIP edges...');
  await driver.executeQuery(
    `
    // Relationships from PI A
    MATCH (e1:Entity {canonical_id: 'test-purge-entity-orphan-1'})
    MATCH (e2:Entity {canonical_id: 'test-purge-entity-orphan-2'})
    MATCH (merged:Entity {canonical_id: 'test-purge-entity-merged'})

    // Relationship between orphan entities (source_pi = PI A)
    CREATE (e1)-[:RELATIONSHIP {
      predicate: 'affiliated_with',
      properties: '{"role": "member"}',
      source_pi: $piA,
      created_at: datetime()
    }]->(e2)

    // Relationship from orphan to merged (source_pi = PI A)
    CREATE (e1)-[:RELATIONSHIP {
      predicate: 'attended',
      properties: '{}',
      source_pi: $piA,
      created_at: datetime()
    }]->(merged)

    // Relationship from merged to orphan (source_pi = PI A)
    CREATE (merged)-[:RELATIONSHIP {
      predicate: 'organized_by',
      properties: '{}',
      source_pi: $piA,
      created_at: datetime()
    }]->(e2)
    `,
    { piA: TEST_PI_A },
    { database }
  );

  // Create relationship from PI B (should survive purge of PI A)
  await driver.executeQuery(
    `
    MATCH (merged:Entity {canonical_id: 'test-purge-entity-merged'})
    MATCH (eB:Entity {canonical_id: 'test-purge-entity-only-b'})

    // Relationship from PI B (should NOT be deleted when purging PI A)
    CREATE (merged)-[:RELATIONSHIP {
      predicate: 'located_in',
      properties: '{}',
      source_pi: $piB,
      created_at: datetime()
    }]->(eB)
    `,
    { piB: TEST_PI_B },
    { database }
  );

  log(colors.green, '✓ Test data setup complete');

  // Print summary
  const summary = await driver.executeQuery(
    `
    MATCH (pi:Entity {type: 'pi'})
    WHERE pi.canonical_id STARTS WITH 'test-purge-'
    WITH count(pi) as piCount

    MATCH (e:Entity)
    WHERE e.canonical_id STARTS WITH 'test-purge-' AND e.type <> 'pi'
    WITH piCount, count(e) as entityCount

    MATCH ()-[r:RELATIONSHIP]->()
    WHERE r.source_pi STARTS WITH 'test-purge-'
    WITH piCount, entityCount, count(r) as relCount

    MATCH (e:Entity)-[ef:EXTRACTED_FROM]->(pi:Entity {type: 'pi'})
    WHERE e.canonical_id STARTS WITH 'test-purge-'
    RETURN piCount, entityCount, relCount, count(ef) as efCount
    `,
    {},
    { database }
  );

  const record = summary.records[0];
  log(colors.cyan, `\n  Summary:`);
  log(colors.cyan, `  - PI entities: ${record.get('piCount')}`);
  log(colors.cyan, `  - Other entities: ${record.get('entityCount')}`);
  log(colors.cyan, `  - RELATIONSHIP edges: ${record.get('relCount')}`);
  log(colors.cyan, `  - EXTRACTED_FROM edges: ${record.get('efCount')}`);
}

async function callPurgeEndpoint(pi) {
  const url = `${GATEWAY_URL}/pi/${encodeURIComponent(pi)}/purge`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });

  const body = await response.json();
  return { status: response.status, body };
}

async function verifyDatabaseState(driver, description) {
  const database = process.env.NEO4J_DATABASE || 'neo4j';

  log(colors.cyan, `\n  📊 Database state: ${description}`);

  // Count entities
  const entityResult = await driver.executeQuery(
    `
    MATCH (e:Entity)
    WHERE e.canonical_id STARTS WITH 'test-purge-'
    RETURN e.canonical_id as id, e.type as type
    `,
    {},
    { database }
  );

  log(colors.cyan, `  Entities (${entityResult.records.length}):`);
  for (const record of entityResult.records) {
    log(colors.cyan, `    - ${record.get('id')} (${record.get('type')})`);
  }

  // Count relationships
  const relResult = await driver.executeQuery(
    `
    MATCH (s:Entity)-[r:RELATIONSHIP]->(o:Entity)
    WHERE s.canonical_id STARTS WITH 'test-purge-' OR o.canonical_id STARTS WITH 'test-purge-'
    RETURN s.canonical_id as subject, r.predicate as predicate, o.canonical_id as object, r.source_pi as source_pi
    `,
    {},
    { database }
  );

  log(colors.cyan, `  RELATIONSHIP edges (${relResult.records.length}):`);
  for (const record of relResult.records) {
    log(colors.cyan, `    - ${record.get('subject')} -[${record.get('predicate')}]-> ${record.get('object')} (from ${record.get('source_pi')})`);
  }

  // Count EXTRACTED_FROM
  const efResult = await driver.executeQuery(
    `
    MATCH (e:Entity)-[ef:EXTRACTED_FROM]->(pi:Entity {type: 'pi'})
    WHERE e.canonical_id STARTS WITH 'test-purge-'
    RETURN e.canonical_id as entity, pi.canonical_id as pi
    `,
    {},
    { database }
  );

  log(colors.cyan, `  EXTRACTED_FROM edges (${efResult.records.length}):`);
  for (const record of efResult.records) {
    log(colors.cyan, `    - ${record.get('entity')} -> ${record.get('pi')}`);
  }

  return {
    entities: entityResult.records.map(r => r.get('id')),
    relationships: relResult.records.length,
    extractedFrom: efResult.records.length,
  };
}

async function runTests() {
  log(colors.blue, '═══════════════════════════════════════════════════════════');
  log(colors.blue, '       Purge Endpoint Comprehensive Test Suite');
  log(colors.blue, '═══════════════════════════════════════════════════════════');

  const driver = await createDriver();
  let testsPassed = 0;
  let testsFailed = 0;

  try {
    // Setup
    await cleanupTestData(driver);
    await setupTestData(driver);

    // Verify initial state
    const initialState = await verifyDatabaseState(driver, 'BEFORE PURGE');

    // ═══════════════════════════════════════════════════════════════════════
    // TEST 1: Purge non-existent PI
    // ═══════════════════════════════════════════════════════════════════════
    log(colors.yellow, '\n\n═══ TEST 1: Purge non-existent PI ═══');

    const result1 = await callPurgeEndpoint(TEST_PI_C);
    log(colors.cyan, `  Response: ${JSON.stringify(result1.body, null, 2)}`);

    if (result1.status === 200 &&
        result1.body.success === true &&
        result1.body.purged.entities_deleted.length === 0 &&
        result1.body.purged.entities_detached.length === 0) {
      log(colors.green, '  ✓ TEST 1 PASSED: Non-existent PI returns success with empty purge');
      testsPassed++;
    } else {
      log(colors.red, '  ✗ TEST 1 FAILED: Unexpected response for non-existent PI');
      testsFailed++;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // TEST 2: Purge PI A (with orphaned and merged entities)
    // ═══════════════════════════════════════════════════════════════════════
    log(colors.yellow, '\n\n═══ TEST 2: Purge PI A (main test) ═══');

    const result2 = await callPurgeEndpoint(TEST_PI_A);
    log(colors.cyan, `  Response: ${JSON.stringify(result2.body, null, 2)}`);

    const purged = result2.body.purged;

    // Check response structure
    let test2Passed = true;

    // Should delete orphan entities
    if (!purged.entities_deleted.includes('test-purge-entity-orphan-1') ||
        !purged.entities_deleted.includes('test-purge-entity-orphan-2')) {
      log(colors.red, '  ✗ Missing orphan entities in entities_deleted');
      test2Passed = false;
    } else {
      log(colors.green, '  ✓ Orphan entities correctly marked for deletion');
    }

    // Should NOT delete merged entity (only detach)
    if (purged.entities_deleted.includes('test-purge-entity-merged')) {
      log(colors.red, '  ✗ Merged entity should NOT be in entities_deleted');
      test2Passed = false;
    } else {
      log(colors.green, '  ✓ Merged entity not in entities_deleted');
    }

    // Should detach merged entity
    if (!purged.entities_detached.includes('test-purge-entity-merged')) {
      log(colors.red, '  ✗ Merged entity should be in entities_detached');
      test2Passed = false;
    } else {
      log(colors.green, '  ✓ Merged entity correctly marked as detached');
    }

    // Should delete 3 relationships (all from PI A)
    if (purged.relationships_deleted !== 3) {
      log(colors.red, `  ✗ Expected 3 relationships deleted, got ${purged.relationships_deleted}`);
      test2Passed = false;
    } else {
      log(colors.green, '  ✓ Correct number of relationships deleted');
    }

    // Should delete 3 EXTRACTED_FROM (2 orphans + 1 from merged)
    if (purged.extracted_from_deleted !== 3) {
      log(colors.red, `  ✗ Expected 3 EXTRACTED_FROM deleted, got ${purged.extracted_from_deleted}`);
      test2Passed = false;
    } else {
      log(colors.green, '  ✓ Correct number of EXTRACTED_FROM deleted');
    }

    if (test2Passed) {
      log(colors.green, '  ✓ TEST 2 PASSED');
      testsPassed++;
    } else {
      log(colors.red, '  ✗ TEST 2 FAILED');
      testsFailed++;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // TEST 3: Verify database state after purge
    // ═══════════════════════════════════════════════════════════════════════
    log(colors.yellow, '\n\n═══ TEST 3: Verify database state after purge ═══');

    const afterState = await verifyDatabaseState(driver, 'AFTER PURGE');

    let test3Passed = true;

    // PI A should still exist
    if (!afterState.entities.includes(TEST_PI_A)) {
      log(colors.red, '  ✗ PI A was deleted (should have been preserved)');
      test3Passed = false;
    } else {
      log(colors.green, '  ✓ PI A still exists');
    }

    // PI B should still exist
    if (!afterState.entities.includes(TEST_PI_B)) {
      log(colors.red, '  ✗ PI B was deleted');
      test3Passed = false;
    } else {
      log(colors.green, '  ✓ PI B still exists');
    }

    // Orphan entities should be deleted
    if (afterState.entities.includes('test-purge-entity-orphan-1') ||
        afterState.entities.includes('test-purge-entity-orphan-2')) {
      log(colors.red, '  ✗ Orphan entities still exist');
      test3Passed = false;
    } else {
      log(colors.green, '  ✓ Orphan entities deleted');
    }

    // Merged entity should still exist
    if (!afterState.entities.includes('test-purge-entity-merged')) {
      log(colors.red, '  ✗ Merged entity was deleted (should have been preserved)');
      test3Passed = false;
    } else {
      log(colors.green, '  ✓ Merged entity still exists');
    }

    // Entity only in PI B should still exist
    if (!afterState.entities.includes('test-purge-entity-only-b')) {
      log(colors.red, '  ✗ Entity only in PI B was deleted');
      test3Passed = false;
    } else {
      log(colors.green, '  ✓ Entity only in PI B still exists');
    }

    // Should have 1 relationship remaining (from PI B)
    if (afterState.relationships !== 1) {
      log(colors.red, `  ✗ Expected 1 relationship remaining, got ${afterState.relationships}`);
      test3Passed = false;
    } else {
      log(colors.green, '  ✓ Only PI B relationship remains');
    }

    // Merged entity should still have EXTRACTED_FROM to PI B
    const mergedEfResult = await driver.executeQuery(
      `
      MATCH (e:Entity {canonical_id: 'test-purge-entity-merged'})-[ef:EXTRACTED_FROM]->(pi:Entity {type: 'pi'})
      RETURN pi.canonical_id as pi
      `,
      {},
      { database: process.env.NEO4J_DATABASE || 'neo4j' }
    );

    if (mergedEfResult.records.length !== 1 || mergedEfResult.records[0].get('pi') !== TEST_PI_B) {
      log(colors.red, '  ✗ Merged entity EXTRACTED_FROM is incorrect');
      test3Passed = false;
    } else {
      log(colors.green, '  ✓ Merged entity only has EXTRACTED_FROM to PI B');
    }

    if (test3Passed) {
      log(colors.green, '  ✓ TEST 3 PASSED');
      testsPassed++;
    } else {
      log(colors.red, '  ✗ TEST 3 FAILED');
      testsFailed++;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // TEST 4: Idempotency - purge again should be a no-op
    // ═══════════════════════════════════════════════════════════════════════
    log(colors.yellow, '\n\n═══ TEST 4: Idempotency (purge again) ═══');

    const result4 = await callPurgeEndpoint(TEST_PI_A);
    log(colors.cyan, `  Response: ${JSON.stringify(result4.body, null, 2)}`);

    if (result4.status === 200 &&
        result4.body.success === true &&
        result4.body.purged.entities_deleted.length === 0 &&
        result4.body.purged.entities_detached.length === 0 &&
        result4.body.purged.relationships_deleted === 0 &&
        result4.body.purged.extracted_from_deleted === 0) {
      log(colors.green, '  ✓ TEST 4 PASSED: Second purge is idempotent (no-op)');
      testsPassed++;
    } else {
      log(colors.red, '  ✗ TEST 4 FAILED: Second purge should be a no-op');
      testsFailed++;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // TEST 5: Purge PI B
    // ═══════════════════════════════════════════════════════════════════════
    log(colors.yellow, '\n\n═══ TEST 5: Purge PI B ═══');

    const result5 = await callPurgeEndpoint(TEST_PI_B);
    log(colors.cyan, `  Response: ${JSON.stringify(result5.body, null, 2)}`);

    let test5Passed = true;

    // Merged entity should now be deleted (orphaned after PI A purge)
    if (!result5.body.purged.entities_deleted.includes('test-purge-entity-merged')) {
      log(colors.red, '  ✗ Merged entity should be deleted after PI B purge');
      test5Passed = false;
    } else {
      log(colors.green, '  ✓ Merged entity now deleted (was orphaned)');
    }

    // Entity only in B should be deleted
    if (!result5.body.purged.entities_deleted.includes('test-purge-entity-only-b')) {
      log(colors.red, '  ✗ Entity only in B should be deleted');
      test5Passed = false;
    } else {
      log(colors.green, '  ✓ Entity only in B deleted');
    }

    // Should delete 1 relationship
    if (result5.body.purged.relationships_deleted !== 1) {
      log(colors.red, `  ✗ Expected 1 relationship deleted, got ${result5.body.purged.relationships_deleted}`);
      test5Passed = false;
    } else {
      log(colors.green, '  ✓ Correct number of relationships deleted');
    }

    if (test5Passed) {
      log(colors.green, '  ✓ TEST 5 PASSED');
      testsPassed++;
    } else {
      log(colors.red, '  ✗ TEST 5 FAILED');
      testsFailed++;
    }

    // Final state verification
    await verifyDatabaseState(driver, 'FINAL STATE');

    // ═══════════════════════════════════════════════════════════════════════
    // Summary
    // ═══════════════════════════════════════════════════════════════════════
    log(colors.blue, '\n═══════════════════════════════════════════════════════════');
    log(colors.blue, '                     TEST SUMMARY');
    log(colors.blue, '═══════════════════════════════════════════════════════════');
    log(colors.green, `  ✓ Passed: ${testsPassed}`);
    log(colors.red, `  ✗ Failed: ${testsFailed}`);
    log(colors.blue, '═══════════════════════════════════════════════════════════\n');

    if (testsFailed > 0) {
      process.exit(1);
    }

  } catch (error) {
    log(colors.red, '\n❌ Test error:', error.message);
    console.error(error);
    process.exit(1);
  } finally {
    await cleanupTestData(driver);
    await driver.close();
  }
}

// Run tests
runTests();
