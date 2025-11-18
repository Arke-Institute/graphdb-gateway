// Cleanup script for test data
// Run with: node cleanup-test-data.js

const neo4j = require('neo4j-driver');
require('dotenv').config({ path: '.dev.vars' });

async function cleanup() {
  const URI = process.env.NEO4J_URI;
  const USER = process.env.NEO4J_USERNAME;
  const PASSWORD = process.env.NEO4J_PASSWORD;
  const DATABASE = process.env.NEO4J_DATABASE || 'neo4j';

  console.log('🧹 Cleaning up test data from Neo4j...\n');

  const driver = neo4j.driver(URI, neo4j.auth.basic(USER, PASSWORD));

  try {
    // Delete all test nodes and relationships
    const { summary } = await driver.executeQuery(
      `
      MATCH (n)
      WHERE n.id STARTS WITH '01KA1H' OR
            n.canonical_id STARTS WITH 'uuid_' OR
            n.id STARTS WITH 'TEST_'
      DETACH DELETE n
      `,
      {},
      { database: DATABASE }
    );

    console.log(`✓ Deleted ${summary.counters.updates().nodesDeleted} nodes`);
    console.log(`✓ Deleted ${summary.counters.updates().relationshipsDeleted} relationships\n`);
    console.log('✅ Cleanup complete!\n');

  } catch (error) {
    console.error('❌ Error during cleanup:', error.message);
    throw error;
  } finally {
    await driver.close();
  }
}

cleanup().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
