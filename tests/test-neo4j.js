// Test script for Neo4j connectivity
// Run with: node test-neo4j.js

const neo4j = require('neo4j-driver');
require('dotenv').config({ path: '.dev.vars' });

async function testNeo4j() {
  const URI = process.env.NEO4J_URI;
  const USER = process.env.NEO4J_USERNAME;
  const PASSWORD = process.env.NEO4J_PASSWORD;
  const DATABASE = process.env.NEO4J_DATABASE || 'neo4j';

  console.log('🔌 Connecting to Neo4j...');
  console.log(`URI: ${URI}`);
  console.log(`User: ${USER}`);
  console.log(`Database: ${DATABASE}\n`);

  const driver = neo4j.driver(URI, neo4j.auth.basic(USER, PASSWORD));

  try {
    // Test 1: Verify connectivity
    console.log('✅ Test 1: Verifying connectivity...');
    const serverInfo = await driver.getServerInfo();
    console.log('✓ Connection established');
    console.log(`  Server version: ${serverInfo.agent}`);
    console.log(`  Address: ${serverInfo.address}\n`);

    // Test 2: Create test PI nodes
    console.log('✅ Test 2: Creating test PI nodes...');
    const { summary: createSummary } = await driver.executeQuery(
      `
      CREATE (parent:PI {id: $parentId, created_at: datetime(), indexed_at: datetime()})
      CREATE (child1:PI {id: $child1Id, created_at: datetime(), indexed_at: datetime()})
      CREATE (child2:PI {id: $child2Id, created_at: datetime(), indexed_at: datetime()})
      CREATE (parent)-[:PARENT_OF]->(child1)
      CREATE (parent)-[:PARENT_OF]->(child2)
      CREATE (child1)-[:CHILD_OF]->(parent)
      CREATE (child2)-[:CHILD_OF]->(parent)
      RETURN parent, child1, child2
      `,
      {
        parentId: 'TEST_PARENT_01',
        child1Id: 'TEST_CHILD_01',
        child2Id: 'TEST_CHILD_02'
      },
      { database: DATABASE }
    );
    console.log(`✓ Created ${createSummary.counters.updates().nodesCreated} nodes`);
    console.log(`✓ Created ${createSummary.counters.updates().relationshipsCreated} relationships\n`);

    // Test 3: Create test entities with EXTRACTED_FROM relationships
    console.log('✅ Test 3: Creating test entities...');
    const { summary: entitySummary } = await driver.executeQuery(
      `
      MATCH (pi:PI {id: $piId})
      CREATE (e:Entity {
        canonical_id: $canonicalId,
        code: $code,
        label: $label,
        type: $type,
        properties: $properties,
        first_seen: datetime(),
        last_updated: datetime()
      })
      CREATE (e)-[:EXTRACTED_FROM {
        original_code: $code,
        extracted_at: datetime()
      }]->(pi)
      RETURN e
      `,
      {
        piId: 'TEST_CHILD_01',
        canonicalId: 'uuid_test_123',
        code: 'dr_test',
        label: 'Dr Test',
        type: 'person',
        properties: JSON.stringify({ role: 'researcher', department: 'AI' })
      },
      { database: DATABASE }
    );
    console.log(`✓ Created ${entitySummary.counters.updates().nodesCreated} entity`);
    console.log(`✓ Created ${entitySummary.counters.updates().relationshipsCreated} EXTRACTED_FROM relationship\n`);

    // Test 4: Query entities from child PIs
    console.log('✅ Test 4: Querying entities from child PIs...');
    const { records } = await driver.executeQuery(
      `
      MATCH (pi:PI {id: $piId})<-[:CHILD_OF]-(child:PI)<-[:EXTRACTED_FROM]-(e:Entity)
      WHERE e.label = $label AND e.type = $type
      RETURN e.canonical_id AS canonical_id,
             e.label AS label,
             e.type AS type,
             e.properties AS properties
      `,
      {
        piId: 'TEST_PARENT_01',
        label: 'Dr Test',
        type: 'person'
      },
      { database: DATABASE }
    );
    console.log(`✓ Found ${records.length} matching entities`);
    for (const record of records) {
      console.log(`  - ${record.get('label')} (${record.get('type')})`);
      console.log(`    ID: ${record.get('canonical_id')}`);
      console.log(`    Properties: ${record.get('properties')}`);
    }
    console.log();

    // Test 5: Create entity relationship
    console.log('✅ Test 5: Creating entity relationships...');
    const { summary: relSummary } = await driver.executeQuery(
      `
      MATCH (pi:PI {id: $piId})
      CREATE (e1:Entity {
        canonical_id: $e1Id,
        code: 'university_test',
        label: 'Test University',
        type: 'organization',
        first_seen: datetime(),
        last_updated: datetime()
      })
      CREATE (e1)-[:EXTRACTED_FROM {
        original_code: 'university_test',
        extracted_at: datetime()
      }]->(pi)
      WITH e1
      MATCH (e2:Entity {canonical_id: $e2Id})
      CREATE (e2)-[r:RELATIONSHIP {
        predicate: $predicate,
        properties: $properties,
        source_pi: $piId
      }]->(e1)
      RETURN e1, e2, r
      `,
      {
        piId: 'TEST_CHILD_01',
        e1Id: 'uuid_test_org_456',
        e2Id: 'uuid_test_123',
        predicate: 'affiliated_with',
        properties: JSON.stringify({ since: '2020', role: 'researcher' })
      },
      { database: DATABASE }
    );
    console.log(`✓ Created ${relSummary.counters.updates().nodesCreated} organization entity`);
    console.log(`✓ Created ${relSummary.counters.updates().relationshipsCreated} relationships\n`);

    // Test 6: Query the full graph
    console.log('✅ Test 6: Querying full test graph...');
    const { records: graphRecords } = await driver.executeQuery(
      `
      MATCH (pi:PI {id: $piId})
      OPTIONAL MATCH (pi)<-[:PARENT_OF|CHILD_OF]-(related:PI)
      OPTIONAL MATCH (pi)<-[:EXTRACTED_FROM]-(entity:Entity)
      RETURN pi,
             collect(DISTINCT related) AS relatedPIs,
             collect(DISTINCT entity) AS entities
      `,
      { piId: 'TEST_PARENT_01' },
      { database: DATABASE }
    );
    console.log('✓ Graph structure:');
    for (const record of graphRecords) {
      const pi = record.get('pi');
      const relatedPIs = record.get('relatedPIs');
      const entities = record.get('entities');
      console.log(`  PI: ${pi.properties.id}`);
      console.log(`  Related PIs: ${relatedPIs.length}`);
      console.log(`  Entities: ${entities.length}`);
    }
    console.log();

    // Cleanup
    console.log('🧹 Cleaning up test data...');
    const { summary: cleanupSummary } = await driver.executeQuery(
      `
      MATCH (n) WHERE n.id STARTS WITH 'TEST_' OR n.canonical_id STARTS WITH 'uuid_test'
      DETACH DELETE n
      `,
      {},
      { database: DATABASE }
    );
    console.log(`✓ Deleted ${cleanupSummary.counters.updates().nodesDeleted} nodes`);
    console.log(`✓ Deleted ${cleanupSummary.counters.updates().relationshipsDeleted} relationships\n`);

    console.log('✅ All tests passed!\n');

  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.code) {
      console.error('Error code:', error.code);
    }
    throw error;
  } finally {
    await driver.close();
    console.log('👋 Connection closed');
  }
}

testNeo4j().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
