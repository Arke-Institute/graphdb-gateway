// Populate Neo4j with realistic sample data for exploration
// Run with: node populate-sample-data.js

const neo4j = require('neo4j-driver');
require('dotenv').config({ path: '.dev.vars' });

async function populateData() {
  const URI = process.env.NEO4J_URI;
  const USER = process.env.NEO4J_USERNAME;
  const PASSWORD = process.env.NEO4J_PASSWORD;
  const DATABASE = process.env.NEO4J_DATABASE || 'neo4j';

  console.log('📊 Populating Neo4j with sample data...\n');

  const driver = neo4j.driver(URI, neo4j.auth.basic(USER, PASSWORD));

  try {
    // Step 1: Create PI hierarchy
    console.log('1️⃣ Creating PI hierarchy...');
    await driver.executeQuery(
      `
      // Create parent PI (research project)
      CREATE (parent:PI {
        id: '01PROJECT_AI_RESEARCH_2024',
        created_at: datetime(),
        indexed_at: datetime()
      })

      // Create child PIs (papers in the project)
      CREATE (paper1:PI {
        id: '01PAPER_NEURAL_NETWORKS_2024',
        created_at: datetime(),
        indexed_at: datetime()
      })
      CREATE (paper2:PI {
        id: '01PAPER_DEEP_LEARNING_2024',
        created_at: datetime(),
        indexed_at: datetime()
      })
      CREATE (paper3:PI {
        id: '01PAPER_TRANSFORMERS_2024',
        created_at: datetime(),
        indexed_at: datetime()
      })

      // Create relationships
      CREATE (parent)-[:PARENT_OF]->(paper1)
      CREATE (parent)-[:PARENT_OF]->(paper2)
      CREATE (parent)-[:PARENT_OF]->(paper3)
      CREATE (paper1)-[:CHILD_OF]->(parent)
      CREATE (paper2)-[:CHILD_OF]->(parent)
      CREATE (paper3)-[:CHILD_OF]->(parent)

      RETURN parent, paper1, paper2, paper3
      `,
      {},
      { database: DATABASE }
    );
    console.log('✓ Created PI hierarchy (1 parent, 3 children)\n');

    // Step 2: Create entities - People
    console.log('2️⃣ Creating person entities...');

    const people = [
      {
        canonical_id: 'person_001_dr_sarah_chen',
        code: 'sarah_chen',
        label: 'Dr. Sarah Chen',
        properties: {
          title: 'Professor',
          department: 'Computer Science',
          institution: 'Stanford University',
          email: 'schen@stanford.edu',
          specialization: 'Neural Networks'
        },
        pi: '01PAPER_NEURAL_NETWORKS_2024'
      },
      {
        canonical_id: 'person_002_prof_michael_zhang',
        code: 'michael_zhang',
        label: 'Prof. Michael Zhang',
        properties: {
          title: 'Associate Professor',
          department: 'AI Research',
          institution: 'MIT',
          h_index: 42,
          specialization: 'Deep Learning'
        },
        pi: '01PAPER_DEEP_LEARNING_2024'
      },
      {
        canonical_id: 'person_003_dr_emily_rodriguez',
        code: 'emily_rodriguez',
        label: 'Dr. Emily Rodriguez',
        properties: {
          title: 'Research Scientist',
          department: 'Machine Learning',
          institution: 'Google Research',
          specialization: 'Transformers'
        },
        pi: '01PAPER_TRANSFORMERS_2024'
      },
      {
        canonical_id: 'person_004_james_wilson',
        code: 'james_wilson',
        label: 'James Wilson',
        properties: {
          title: 'PhD Candidate',
          department: 'Computer Science',
          institution: 'Stanford University',
          advisor: 'Dr. Sarah Chen'
        },
        pi: '01PAPER_NEURAL_NETWORKS_2024'
      }
    ];

    for (const person of people) {
      await driver.executeQuery(
        `
        MATCH (pi:PI {id: $pi})
        CREATE (e:Entity {
          canonical_id: $canonical_id,
          code: $code,
          label: $label,
          type: 'person',
          properties: $properties,
          first_seen: datetime(),
          last_updated: datetime()
        })
        CREATE (e)-[:EXTRACTED_FROM {
          original_code: $code,
          extracted_at: datetime()
        }]->(pi)
        `,
        {
          ...person,
          properties: JSON.stringify(person.properties)
        },
        { database: DATABASE }
      );
    }
    console.log(`✓ Created ${people.length} person entities\n`);

    // Step 3: Create entities - Organizations
    console.log('3️⃣ Creating organization entities...');

    const organizations = [
      {
        canonical_id: 'org_001_stanford',
        code: 'stanford_university',
        label: 'Stanford University',
        properties: {
          type: 'university',
          location: 'Stanford, CA, USA',
          founded: '1885',
          website: 'https://www.stanford.edu'
        },
        pi: '01PAPER_NEURAL_NETWORKS_2024'
      },
      {
        canonical_id: 'org_002_mit',
        code: 'mit',
        label: 'Massachusetts Institute of Technology',
        properties: {
          type: 'university',
          location: 'Cambridge, MA, USA',
          founded: '1861',
          website: 'https://www.mit.edu'
        },
        pi: '01PAPER_DEEP_LEARNING_2024'
      },
      {
        canonical_id: 'org_003_google_research',
        code: 'google_research',
        label: 'Google Research',
        properties: {
          type: 'research_lab',
          parent: 'Google LLC',
          location: 'Mountain View, CA, USA',
          focus: 'Artificial Intelligence'
        },
        pi: '01PAPER_TRANSFORMERS_2024'
      },
      {
        canonical_id: 'org_004_neurips',
        code: 'neurips_conference',
        label: 'NeurIPS Conference',
        properties: {
          type: 'conference',
          full_name: 'Neural Information Processing Systems',
          frequency: 'annual',
          website: 'https://nips.cc'
        },
        pi: '01PROJECT_AI_RESEARCH_2024'
      }
    ];

    for (const org of organizations) {
      await driver.executeQuery(
        `
        MATCH (pi:PI {id: $pi})
        CREATE (e:Entity {
          canonical_id: $canonical_id,
          code: $code,
          label: $label,
          type: 'organization',
          properties: $properties,
          first_seen: datetime(),
          last_updated: datetime()
        })
        CREATE (e)-[:EXTRACTED_FROM {
          original_code: $code,
          extracted_at: datetime()
        }]->(pi)
        `,
        {
          ...org,
          properties: JSON.stringify(org.properties)
        },
        { database: DATABASE }
      );
    }
    console.log(`✓ Created ${organizations.length} organization entities\n`);

    // Step 4: Create entities - Topics/Concepts
    console.log('4️⃣ Creating topic entities...');

    const topics = [
      {
        canonical_id: 'topic_001_neural_networks',
        code: 'neural_networks',
        label: 'Neural Networks',
        properties: {
          category: 'machine_learning',
          description: 'Computational models inspired by biological neural networks'
        },
        pi: '01PAPER_NEURAL_NETWORKS_2024'
      },
      {
        canonical_id: 'topic_002_deep_learning',
        code: 'deep_learning',
        label: 'Deep Learning',
        properties: {
          category: 'machine_learning',
          description: 'Machine learning based on artificial neural networks with multiple layers'
        },
        pi: '01PAPER_DEEP_LEARNING_2024'
      },
      {
        canonical_id: 'topic_003_transformers',
        code: 'transformer_architecture',
        label: 'Transformer Architecture',
        properties: {
          category: 'neural_architecture',
          introduced: '2017',
          key_feature: 'Self-attention mechanism'
        },
        pi: '01PAPER_TRANSFORMERS_2024'
      }
    ];

    for (const topic of topics) {
      await driver.executeQuery(
        `
        MATCH (pi:PI {id: $pi})
        CREATE (e:Entity {
          canonical_id: $canonical_id,
          code: $code,
          label: $label,
          type: 'topic',
          properties: $properties,
          first_seen: datetime(),
          last_updated: datetime()
        })
        CREATE (e)-[:EXTRACTED_FROM {
          original_code: $code,
          extracted_at: datetime()
        }]->(pi)
        `,
        {
          ...topic,
          properties: JSON.stringify(topic.properties)
        },
        { database: DATABASE }
      );
    }
    console.log(`✓ Created ${topics.length} topic entities\n`);

    // Step 5: Create relationships between entities
    console.log('5️⃣ Creating relationships between entities...');

    const relationships = [
      // Affiliation relationships
      {
        subject: 'person_001_dr_sarah_chen',
        predicate: 'affiliated_with',
        object: 'org_001_stanford',
        properties: { role: 'Professor', since: '2015' },
        source_pi: '01PAPER_NEURAL_NETWORKS_2024'
      },
      {
        subject: 'person_002_prof_michael_zhang',
        predicate: 'affiliated_with',
        object: 'org_002_mit',
        properties: { role: 'Associate Professor', since: '2018' },
        source_pi: '01PAPER_DEEP_LEARNING_2024'
      },
      {
        subject: 'person_003_dr_emily_rodriguez',
        predicate: 'affiliated_with',
        object: 'org_003_google_research',
        properties: { role: 'Research Scientist', since: '2020' },
        source_pi: '01PAPER_TRANSFORMERS_2024'
      },
      {
        subject: 'person_004_james_wilson',
        predicate: 'affiliated_with',
        object: 'org_001_stanford',
        properties: { role: 'PhD Candidate', since: '2021' },
        source_pi: '01PAPER_NEURAL_NETWORKS_2024'
      },
      // Research interest relationships
      {
        subject: 'person_001_dr_sarah_chen',
        predicate: 'researches',
        object: 'topic_001_neural_networks',
        properties: { years_active: '10+', expertise_level: 'expert' },
        source_pi: '01PAPER_NEURAL_NETWORKS_2024'
      },
      {
        subject: 'person_002_prof_michael_zhang',
        predicate: 'researches',
        object: 'topic_002_deep_learning',
        properties: { years_active: '8', expertise_level: 'expert' },
        source_pi: '01PAPER_DEEP_LEARNING_2024'
      },
      {
        subject: 'person_003_dr_emily_rodriguez',
        predicate: 'researches',
        object: 'topic_003_transformers',
        properties: { years_active: '5', expertise_level: 'expert' },
        source_pi: '01PAPER_TRANSFORMERS_2024'
      },
      // Collaboration relationships
      {
        subject: 'person_001_dr_sarah_chen',
        predicate: 'collaborates_with',
        object: 'person_002_prof_michael_zhang',
        properties: { projects: '3', since: '2019' },
        source_pi: '01PROJECT_AI_RESEARCH_2024'
      },
      {
        subject: 'person_002_prof_michael_zhang',
        predicate: 'collaborates_with',
        object: 'person_003_dr_emily_rodriguez',
        properties: { projects: '2', since: '2021' },
        source_pi: '01PROJECT_AI_RESEARCH_2024'
      },
      // Advisor relationship
      {
        subject: 'person_001_dr_sarah_chen',
        predicate: 'advises',
        object: 'person_004_james_wilson',
        properties: { since: '2021', thesis_topic: 'Neural Network Optimization' },
        source_pi: '01PAPER_NEURAL_NETWORKS_2024'
      },
      // Topic hierarchy
      {
        subject: 'topic_002_deep_learning',
        predicate: 'specialization_of',
        object: 'topic_001_neural_networks',
        properties: { relationship_type: 'is_a' },
        source_pi: '01PAPER_DEEP_LEARNING_2024'
      },
      {
        subject: 'topic_003_transformers',
        predicate: 'specialization_of',
        object: 'topic_002_deep_learning',
        properties: { relationship_type: 'is_a' },
        source_pi: '01PAPER_TRANSFORMERS_2024'
      }
    ];

    for (const rel of relationships) {
      await driver.executeQuery(
        `
        MATCH (subject:Entity {canonical_id: $subject})
        MATCH (object:Entity {canonical_id: $object})
        CREATE (subject)-[:RELATIONSHIP {
          predicate: $predicate,
          properties: $properties,
          source_pi: $source_pi,
          created_at: datetime()
        }]->(object)
        `,
        {
          subject: rel.subject,
          object: rel.object,
          predicate: rel.predicate,
          properties: JSON.stringify(rel.properties),
          source_pi: rel.source_pi
        },
        { database: DATABASE }
      );
    }
    console.log(`✓ Created ${relationships.length} relationships\n`);

    // Step 6: Show summary statistics
    console.log('📈 Database Summary:');
    console.log('═══════════════════\n');

    const stats = await driver.executeQuery(
      `
      MATCH (pi:PI)
      WITH count(pi) as piCount
      MATCH (e:Entity)
      WITH piCount, count(e) as entityCount, collect(DISTINCT e.type) as entityTypes
      MATCH ()-[r:RELATIONSHIP]->()
      WITH piCount, entityCount, entityTypes, count(r) as relCount
      MATCH ()-[ef:EXTRACTED_FROM]->()
      RETURN piCount, entityCount, entityTypes, relCount, count(ef) as extractedFromCount
      `,
      {},
      { database: DATABASE }
    );

    const summary = stats.records[0];
    console.log(`📦 PI Nodes: ${summary.get('piCount')}`);
    console.log(`👥 Entity Nodes: ${summary.get('entityCount')}`);
    console.log(`   Types: ${summary.get('entityTypes').join(', ')}`);
    console.log(`🔗 RELATIONSHIP edges: ${summary.get('relCount')}`);
    console.log(`📎 EXTRACTED_FROM edges: ${summary.get('extractedFromCount')}\n`);

    // Step 7: Show example queries
    console.log('🔍 Example Queries to Explore:\n');
    console.log('1. View all researchers and their affiliations:');
    console.log('   MATCH (p:Entity {type: "person"})-[r:RELATIONSHIP {predicate: "affiliated_with"}]->(o:Entity {type: "organization"})');
    console.log('   RETURN p.label, o.label, r.properties\n');

    console.log('2. Find collaboration network:');
    console.log('   MATCH (p1:Entity)-[r:RELATIONSHIP {predicate: "collaborates_with"}]->(p2:Entity)');
    console.log('   RETURN p1.label, p2.label, r.properties\n');

    console.log('3. Trace PI hierarchy:');
    console.log('   MATCH (parent:PI)-[:PARENT_OF]->(child:PI)');
    console.log('   RETURN parent.id, collect(child.id)\n');

    console.log('4. Find entities from specific PI:');
    console.log('   MATCH (pi:PI {id: "01PAPER_NEURAL_NETWORKS_2024"})<-[:EXTRACTED_FROM]-(e:Entity)');
    console.log('   RETURN e.type, e.label, e.properties\n');

    console.log('✅ Sample data populated successfully!\n');
    console.log('💡 You can now explore the data in Neo4j Browser or run cleanup with:');
    console.log('   node cleanup-test-data.js\n');

  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.code) {
      console.error('Error code:', error.code);
    }
    throw error;
  } finally {
    await driver.close();
  }
}

populateData().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
