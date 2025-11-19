#!/usr/bin/env node

/**
 * Add database indexes for performance optimization
 *
 * This script adds the following indexes to Neo4j:
 * - Index on Entity.code for fast hierarchy lookups
 * - Composite index on Entity.type and Entity.code for filtered queries
 *
 * Usage: node scripts/add-indexes.js
 */

require('dotenv').config({ path: '.dev.vars' });
const neo4j = require('neo4j-driver');

// Read Neo4j credentials from environment
const NEO4J_URI = process.env.NEO4J_URI;
const NEO4J_USERNAME = process.env.NEO4J_USERNAME;
const NEO4J_PASSWORD = process.env.NEO4J_PASSWORD;
const NEO4J_DATABASE = process.env.NEO4J_DATABASE || 'neo4j';

if (!NEO4J_URI || !NEO4J_USERNAME || !NEO4J_PASSWORD) {
  console.error('Error: Missing Neo4j environment variables');
  console.error('Please ensure NEO4J_URI, NEO4J_USERNAME, and NEO4J_PASSWORD are set in .dev.vars');
  process.exit(1);
}

async function addIndexes() {
  const driver = neo4j.driver(
    NEO4J_URI,
    neo4j.auth.basic(NEO4J_USERNAME, NEO4J_PASSWORD)
  );

  try {
    console.log('🔌 Connecting to Neo4j...');
    console.log(`   URI: ${NEO4J_URI}`);
    console.log(`   Database: ${NEO4J_DATABASE}\n`);

    // Check existing indexes
    console.log('📋 Checking existing indexes...');
    const showIndexesQuery = 'SHOW INDEXES';
    const { records: indexRecords } = await driver.executeQuery(showIndexesQuery, {}, {
      database: NEO4J_DATABASE,
    });

    const existingIndexes = indexRecords.map(record => ({
      name: record.get('name'),
      labelsOrTypes: record.get('labelsOrTypes'),
      properties: record.get('properties'),
    }));

    console.log(`   Found ${existingIndexes.length} existing index(es)\n`);

    // Index 1: Entity.code
    const codeIndexName = 'entity_code_idx';
    const existsCodeIndex = existingIndexes.some(
      idx => idx.name === codeIndexName
    );

    if (existsCodeIndex) {
      console.log(`✅ Index "${codeIndexName}" already exists`);
    } else {
      console.log(`📝 Creating index "${codeIndexName}" on Entity.code...`);
      await driver.executeQuery(
        'CREATE INDEX entity_code_idx IF NOT EXISTS FOR (e:Entity) ON (e.code)',
        {},
        { database: NEO4J_DATABASE }
      );
      console.log('   ✅ Index created successfully');
    }

    // Index 2: Entity.type + Entity.code (composite)
    const typeCodeIndexName = 'entity_type_code_idx';
    const existsTypeCodeIndex = existingIndexes.some(
      idx => idx.name === typeCodeIndexName
    );

    if (existsTypeCodeIndex) {
      console.log(`✅ Index "${typeCodeIndexName}" already exists`);
    } else {
      console.log(`\n📝 Creating composite index "${typeCodeIndexName}" on (Entity.type, Entity.code)...`);
      await driver.executeQuery(
        'CREATE INDEX entity_type_code_idx IF NOT EXISTS FOR (e:Entity) ON (e.type, e.code)',
        {},
        { database: NEO4J_DATABASE }
      );
      console.log('   ✅ Index created successfully');
    }

    // Show all indexes after creation
    console.log('\n📊 Current indexes:');
    const { records: finalIndexRecords } = await driver.executeQuery(showIndexesQuery, {}, {
      database: NEO4J_DATABASE,
    });

    for (const record of finalIndexRecords) {
      const name = record.get('name');
      const labelsOrTypes = record.get('labelsOrTypes');
      const properties = record.get('properties');
      const state = record.get('state');

      if (labelsOrTypes && labelsOrTypes.includes('Entity')) {
        console.log(`   - ${name}: ${labelsOrTypes} on ${JSON.stringify(properties)} [${state}]`);
      }
    }

    console.log('\n✅ Database indexes configured successfully!');
  } catch (error) {
    console.error('❌ Error adding indexes:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  } finally {
    await driver.close();
  }
}

// Run the script
addIndexes();
