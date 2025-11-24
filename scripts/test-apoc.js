const neo4j = require('neo4j-driver');
require('dotenv').config({ path: '.dev.vars' });

async function testAPOC() {
  const driver = neo4j.driver(
    process.env.NEO4J_URI,
    neo4j.auth.basic(process.env.NEO4J_USERNAME, process.env.NEO4J_PASSWORD)
  );

  try {
    console.log('Testing APOC availability...');
    const result = await driver.executeQuery(
      'CALL apoc.help("refactor.mergeNodes") YIELD name, text RETURN name, text',
      {},
      { database: process.env.NEO4J_DATABASE }
    );
    
    if (result.records.length > 0) {
      console.log('✅ APOC is available!');
      console.log('Function:', result.records[0].get('name'));
    } else {
      console.log('❌ APOC refactor.mergeNodes not found');
    }
  } catch (error) {
    console.log('❌ APOC not available:', error.message);
  } finally {
    await driver.close();
  }
}

testAPOC();
