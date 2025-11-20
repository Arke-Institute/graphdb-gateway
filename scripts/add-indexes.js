#!/usr/bin/env node

/**
 * Add database indexes and constraints for performance optimization and data integrity
 *
 * This script adds the following to Neo4j:
 * - UNIQUE constraint on Entity.canonical_id (prevents duplicate entities)
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

    // Check existing indexes and constraints
    console.log('📋 Checking existing indexes and constraints...');
    const showIndexesQuery = 'SHOW INDEXES';
    const showConstraintsQuery = 'SHOW CONSTRAINTS';

    const { records: indexRecords } = await driver.executeQuery(showIndexesQuery, {}, {
      database: NEO4J_DATABASE,
    });

    const { records: constraintRecords } = await driver.executeQuery(showConstraintsQuery, {}, {
      database: NEO4J_DATABASE,
    });

    const existingIndexes = indexRecords.map(record => ({
      name: record.get('name'),
      labelsOrTypes: record.get('labelsOrTypes'),
      properties: record.get('properties'),
    }));

    const existingConstraints = constraintRecords.map(record => ({
      name: record.get('name'),
      labelsOrTypes: record.get('labelsOrTypes'),
      properties: record.get('properties'),
    }));

    console.log(`   Found ${existingIndexes.length} existing index(es)`);
    console.log(`   Found ${existingConstraints.length} existing constraint(s)\n`);

    // Constraint 1: UNIQUE on Entity.canonical_id (CRITICAL: prevents duplicate entities)
    const canonicalIdConstraintName = 'entity_canonical_id_unique';
    const existsCanonicalIdConstraint = existingConstraints.some(
      constraint => constraint.name === canonicalIdConstraintName
    );

    if (existsCanonicalIdConstraint) {
      console.log(`✅ Constraint "${canonicalIdConstraintName}" already exists`);
    } else {
      console.log(`📝 Creating UNIQUE constraint "${canonicalIdConstraintName}" on Entity.canonical_id...`);
      console.log('   ⚠️  This prevents duplicate entities (e.g., duplicate date entities)');
      try {
        await driver.executeQuery(
          'CREATE CONSTRAINT entity_canonical_id_unique IF NOT EXISTS FOR (e:Entity) REQUIRE e.canonical_id IS UNIQUE',
          {},
          { database: NEO4J_DATABASE }
        );
        console.log('   ✅ Constraint created successfully');
      } catch (error) {
        if (error.message.includes('already exists')) {
          console.log('   ✅ Constraint already exists (detected via error)');
        } else {
          console.error('   ❌ Failed to create constraint:', error.message);
          console.error('   ⚠️  You may have duplicate entities that need cleanup first');
          console.error('   See: tests/scripts/cleanup-duplicates.cypher');
          throw error;
        }
      }
    }

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

    // Show all constraints and indexes after creation
    console.log('\n📊 Current Entity constraints:');
    const { records: finalConstraintRecords } = await driver.executeQuery(showConstraintsQuery, {}, {
      database: NEO4J_DATABASE,
    });

    for (const record of finalConstraintRecords) {
      const name = record.get('name');
      const labelsOrTypes = record.get('labelsOrTypes');
      const properties = record.get('properties');
      const type = record.get('type');

      if (labelsOrTypes && labelsOrTypes.includes('Entity')) {
        console.log(`   - ${name}: ${type} on ${JSON.stringify(properties)}`);
      }
    }

    console.log('\n📊 Current Entity indexes:');
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

    console.log('\n✅ Database indexes and constraints configured successfully!');
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
