// Interactive data exploration script
// Run with: node explore-data.js

const neo4j = require('neo4j-driver');
require('dotenv').config({ path: '.dev.vars' });

async function exploreData() {
  const URI = process.env.NEO4J_URI;
  const USER = process.env.NEO4J_USERNAME;
  const PASSWORD = process.env.NEO4J_PASSWORD;
  const DATABASE = process.env.NEO4J_DATABASE || 'neo4j';

  console.log('🔍 Exploring GraphDB Data\n');
  console.log('═══════════════════════════\n');

  const driver = neo4j.driver(URI, neo4j.auth.basic(USER, PASSWORD));

  try {
    // Query 1: All PIs and their hierarchy
    console.log('1️⃣ PI HIERARCHY\n');
    const piResults = await driver.executeQuery(
      `
      MATCH (parent:PI)-[:PARENT_OF]->(child:PI)
      RETURN parent.id as parent, collect(child.id) as children
      `,
      {},
      { database: DATABASE }
    );

    for (const record of piResults.records) {
      console.log(`📦 Parent: ${record.get('parent')}`);
      const children = record.get('children');
      children.forEach(child => console.log(`   └─ Child: ${child}`));
    }
    console.log('\n');

    // Query 2: All people and their affiliations
    console.log('2️⃣ RESEARCHERS & AFFILIATIONS\n');
    const peopleResults = await driver.executeQuery(
      `
      MATCH (p:Entity {type: "person"})-[r:RELATIONSHIP]->(o:Entity {type: "organization"})
      WHERE r.predicate = "affiliated_with"
      RETURN p.label as researcher,
             p.properties as person_props,
             o.label as organization,
             r.properties as rel_props
      ORDER BY p.label
      `,
      {},
      { database: DATABASE }
    );

    for (const record of peopleResults.records) {
      const props = JSON.parse(record.get('person_props'));
      const relProps = JSON.parse(record.get('rel_props'));
      console.log(`👤 ${record.get('researcher')}`);
      console.log(`   Title: ${props.title || 'N/A'}`);
      console.log(`   Institution: ${record.get('organization')}`);
      console.log(`   Role: ${relProps.role || 'N/A'}`);
      console.log(`   Since: ${relProps.since || 'N/A'}\n`);
    }

    // Query 3: Research topics and who researches them
    console.log('3️⃣ RESEARCH TOPICS & RESEARCHERS\n');
    const topicsResults = await driver.executeQuery(
      `
      MATCH (p:Entity {type: "person"})-[r:RELATIONSHIP]->(t:Entity {type: "topic"})
      WHERE r.predicate = "researches"
      RETURN t.label as topic,
             collect(p.label) as researchers,
             collect(r.properties) as expertises
      ORDER BY t.label
      `,
      {},
      { database: DATABASE }
    );

    for (const record of topicsResults.records) {
      console.log(`📚 ${record.get('topic')}`);
      const researchers = record.get('researchers');
      const expertises = record.get('expertises');
      researchers.forEach((r, i) => {
        const exp = JSON.parse(expertises[i]);
        console.log(`   └─ ${r} (${exp.expertise_level}, ${exp.years_active} years)`);
      });
      console.log();
    }

    // Query 4: Collaboration network
    console.log('4️⃣ COLLABORATION NETWORK\n');
    const collabResults = await driver.executeQuery(
      `
      MATCH (p1:Entity)-[r:RELATIONSHIP]->(p2:Entity)
      WHERE r.predicate = "collaborates_with"
      RETURN p1.label as person1,
             p2.label as person2,
             r.properties as collab_info
      `,
      {},
      { database: DATABASE }
    );

    for (const record of collabResults.records) {
      const info = JSON.parse(record.get('collab_info'));
      console.log(`🤝 ${record.get('person1')} ↔️ ${record.get('person2')}`);
      console.log(`   Projects: ${info.projects}, Since: ${info.since}\n`);
    }

    // Query 5: Advisor-advisee relationships
    console.log('5️⃣ ADVISOR-ADVISEE RELATIONSHIPS\n');
    const advisorResults = await driver.executeQuery(
      `
      MATCH (advisor:Entity)-[r:RELATIONSHIP]->(advisee:Entity)
      WHERE r.predicate = "advises"
      RETURN advisor.label as advisor,
             advisee.label as advisee,
             r.properties as info
      `,
      {},
      { database: DATABASE }
    );

    for (const record of advisorResults.records) {
      const info = JSON.parse(record.get('info'));
      console.log(`🎓 ${record.get('advisor')} → ${record.get('advisee')}`);
      console.log(`   Thesis: ${info.thesis_topic}`);
      console.log(`   Since: ${info.since}\n`);
    }

    // Query 6: Topic hierarchy
    console.log('6️⃣ TOPIC HIERARCHY\n');
    const topicHierarchy = await driver.executeQuery(
      `
      MATCH (specific:Entity)-[r:RELATIONSHIP]->(general:Entity)
      WHERE r.predicate = "specialization_of"
      RETURN specific.label as specific_topic,
             general.label as general_topic
      ORDER BY general.label
      `,
      {},
      { database: DATABASE }
    );

    for (const record of topicHierarchy.records) {
      console.log(`📊 ${record.get('specific_topic')} ⊂ ${record.get('general_topic')}`);
    }
    console.log('\n');

    // Query 7: Entity count by type
    console.log('7️⃣ ENTITY STATISTICS\n');
    const statsResults = await driver.executeQuery(
      `
      MATCH (e:Entity)
      RETURN e.type as type, count(e) as count
      ORDER BY count DESC
      `,
      {},
      { database: DATABASE }
    );

    for (const record of statsResults.records) {
      console.log(`${record.get('type')}: ${record.get('count')}`);
    }
    console.log('\n');

    // Query 8: Full graph view for a specific PI
    console.log('8️⃣ ENTITIES FROM "NEURAL NETWORKS" PAPER\n');
    const piEntities = await driver.executeQuery(
      `
      MATCH (pi:PI {id: "01PAPER_NEURAL_NETWORKS_2024"})<-[:EXTRACTED_FROM]-(e:Entity)
      RETURN e.type as type, e.label as label, e.properties as props
      ORDER BY e.type, e.label
      `,
      {},
      { database: DATABASE }
    );

    for (const record of piEntities.records) {
      const props = JSON.parse(record.get('props'));
      console.log(`${record.get('type')}: ${record.get('label')}`);
      console.log(`   ${JSON.stringify(props, null, 2).split('\n').join('\n   ')}\n`);
    }

    console.log('═══════════════════════════\n');
    console.log('✅ Exploration complete!\n');
    console.log('💡 Neo4j Browser URL:');
    console.log(`   ${URI.replace('neo4j+s://', 'https://').replace(':7687', ':7474')}\n`);
    console.log('💡 Login with credentials from .dev.vars\n');

  } catch (error) {
    console.error('❌ Error:', error.message);
    throw error;
  } finally {
    await driver.close();
  }
}

exploreData().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
