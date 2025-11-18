# Quick Start Guide

## 🚀 Current Status

Your Neo4j database is now populated with **realistic sample data** representing an AI research project!

### What's in the Database?

**📦 4 PI Nodes:**
- 1 parent project: `01PROJECT_AI_RESEARCH_2024`
- 3 child papers:
  - `01PAPER_NEURAL_NETWORKS_2024`
  - `01PAPER_DEEP_LEARNING_2024`
  - `01PAPER_TRANSFORMERS_2024`

**👥 11 Entity Nodes:**
- **4 People:** Dr. Sarah Chen, Prof. Michael Zhang, Dr. Emily Rodriguez, James Wilson
- **4 Organizations:** Stanford, MIT, Google Research, NeurIPS Conference
- **3 Topics:** Neural Networks, Deep Learning, Transformers

**🔗 12 Relationships:**
- Affiliations (people ↔ organizations)
- Research interests (people ↔ topics)
- Collaborations (people ↔ people)
- Advisor-advisee (mentor ↔ student)
- Topic hierarchy (specialized ↔ general)

## 🎯 Quick Commands

### Explore the Data
```bash
npm run explore
```
This shows you everything in the database in a nicely formatted way!

### Access Neo4j Browser
Open in your browser:
```
https://b54409b4.databases.neo4j.io
```
Login with credentials from `.dev.vars`

### Test the API
```bash
npm run dev              # Start worker (in one terminal)
npm run test:endpoints   # Test endpoints (in another terminal)
```

### Clean Up When Done
```bash
npm run cleanup
```

## 🔍 Example Cypher Queries

Copy these into Neo4j Browser to explore:

### 1. See the full graph
```cypher
MATCH (n)
OPTIONAL MATCH (n)-[r]->(m)
RETURN n, r, m
LIMIT 100
```

### 2. Find all researchers and what they research
```cypher
MATCH (person:Entity {type: "person"})-[r:RELATIONSHIP]->(topic:Entity {type: "topic"})
WHERE r.predicate = "researches"
RETURN person.label, topic.label, r.properties
```

### 3. Show the collaboration network
```cypher
MATCH (p1:Entity)-[r:RELATIONSHIP {predicate: "collaborates_with"}]->(p2:Entity)
RETURN p1.label as Person1, p2.label as Person2,
       JSON.parse(r.properties).projects as Projects
```

### 4. Find who works where
```cypher
MATCH (person:Entity {type: "person"})-[r:RELATIONSHIP]->(org:Entity {type: "organization"})
WHERE r.predicate = "affiliated_with"
RETURN person.label as Researcher,
       org.label as Institution,
       JSON.parse(r.properties).role as Role
ORDER BY Institution
```

### 5. Trace entity back to source PI
```cypher
MATCH (e:Entity {label: "Dr. Sarah Chen"})-[:EXTRACTED_FROM]->(pi:PI)
RETURN e.label, pi.id
```

### 6. Find all entities from a specific paper
```cypher
MATCH (pi:PI {id: "01PAPER_NEURAL_NETWORKS_2024"})<-[:EXTRACTED_FROM]-(e:Entity)
RETURN e.type, e.label, e.properties
ORDER BY e.type
```

## 📊 Visual Exploration

### Neo4j Bloom (if available)
Neo4j Aura instances include Bloom for visual graph exploration:
1. Go to https://workspace-preview.neo4j.io/
2. Select your instance
3. Click "Open with Bloom"
4. Explore visually!

### Common Perspectives to Try:
- **People Network:** See collaboration patterns
- **Research Topics:** Understand topic hierarchy
- **Institution Map:** See which institutions are involved

## 🧪 Sample API Calls

### Query entities by label and type
```bash
curl -X POST http://localhost:8788/entities/query_children \
  -H "Content-Type: application/json" \
  -d '{
    "pi": "01PROJECT_AI_RESEARCH_2024",
    "label": "Dr. Sarah Chen",
    "type": "person"
  }'
```

### Create a new relationship
```bash
curl -X POST http://localhost:8788/relationships/create \
  -H "Content-Type: application/json" \
  -d '{
    "relationships": [
      {
        "subject_id": "person_004_james_wilson",
        "predicate": "researches",
        "object_id": "topic_001_neural_networks",
        "properties": {"expertise_level": "intermediate", "years_active": "3"},
        "source_pi": "01PAPER_NEURAL_NETWORKS_2024"
      }
    ]
  }'
```

## 📁 Useful Scripts

| Script | Command | Purpose |
|--------|---------|---------|
| **Populate** | `npm run populate` | Add sample data to database |
| **Explore** | `npm run explore` | View all data in terminal |
| **Cleanup** | `npm run cleanup` | Remove all test data |
| **Test Neo4j** | `npm run test:neo4j` | Verify Neo4j connectivity |
| **Test Endpoints** | `npm run test:endpoints` | Test all API endpoints |

## 🎨 Data Model

```
PI (Processing Instance)
├── id: string (ULID format)
├── created_at: datetime
└── indexed_at: datetime

Entity (Canonical Entity)
├── canonical_id: string (UUID)
├── code: string
├── label: string
├── type: person | organization | topic
├── properties: JSON string
├── first_seen: datetime
└── last_updated: datetime

Relationships:
├── PI -[:PARENT_OF]-> PI
├── PI -[:CHILD_OF]-> PI
├── Entity -[:EXTRACTED_FROM]-> PI
└── Entity -[:RELATIONSHIP {predicate, properties, source_pi}]-> Entity
```

## 💡 Next Steps

1. **Explore the data** with `npm run explore`
2. **Open Neo4j Browser** and run some Cypher queries
3. **Test the API** with `npm run test:endpoints`
4. **Try your own queries** using the examples above
5. **Clean up** when done with `npm run cleanup`

## ⚠️ Important Notes

- The data will persist in Neo4j until you run `npm run cleanup`
- You can re-populate at any time with `npm run populate`
- Neo4j Browser URL: https://b54409b4.databases.neo4j.io
- Worker is currently in dev mode - use `npm run deploy` to deploy to production

## 🆘 Need Help?

- Run `npm run explore` to see what's in the database
- Check SETUP.md for detailed documentation
- View README.md for API endpoint details
