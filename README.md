# GraphDB Gateway Worker

> Cloudflare Worker gateway to Neo4j AuraDB for entity linking operations

[![Deployed](https://img.shields.io/badge/deployed-live-success)](https://graphdb-gateway.arke.institute)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue)](https://www.typescriptlang.org/)
[![Neo4j](https://img.shields.io/badge/Neo4j-5.27-green)](https://neo4j.com/)

## Overview

A high-performance RESTful API gateway deployed on Cloudflare's edge network that provides seamless access to Neo4j graph database operations. Built for the Arke Institute's entity linking pipeline.

**Production URL:** https://graphdb-gateway.arke.institute
Worker Name: graphdb-gateway

## Features

- 🚀 **Edge-deployed** - Runs on Cloudflare's global network
- 🔒 **Secure** - TLS encryption, credential management via Cloudflare Secrets
- ⚡ **Fast** - 26ms cold start, connection pooling, optimized queries
- 📊 **Graph Operations** - PI hierarchy, entity management, relationship creation
- 🎯 **Type-safe** - Full TypeScript implementation with comprehensive types
- 🧪 **Well-tested** - Complete test suite with sample data

## Quick Start

```bash
# Install dependencies
npm install

# Test Neo4j connectivity
npm test

# Start local development
npm run dev

# Deploy to production
npm run deploy
```

See [docs/SETUP.md](docs/SETUP.md) for detailed setup instructions.

## API Endpoints

### Health Check
```http
GET /health
```

### Create PI Node
```http
POST /pi/create
Content-Type: application/json

{
  "pi": "01KA1H53CP8Y9V2XQN5Z3R7M4E",
  "parent": "01KA1H51YC...",
  "children": ["01KA1H5VGR...", "01KA1H63MP..."]
}
```

### Query Child Entities
```http
POST /entities/query_children
Content-Type: application/json

{
  "pi": "01KA1H53CP...",
  "label": "Dr Gillingham",
  "type": "person"
}
```

### List Entities
```http
POST /entities/list
Content-Type: application/json

{
  "pi": "01PAPER_001",       // Single PI
  // OR
  "pis": ["01PAPER_001", "01PAPER_002"],  // Multiple PIs
  "type": "person"            // Optional: filter by type
}

// Returns deduplicated entities with source_pis array
{
  "entities": [
    {
      "canonical_id": "uuid_123",
      "code": "dr_chen",
      "label": "Dr. Chen",
      "type": "person",
      "properties": {...},
      "source_pis": ["01PAPER_001", "01PAPER_002"]
    }
  ],
  "total_count": 1
}
```

### Create Entity
```http
POST /entity/create
Content-Type: application/json

{
  "canonical_id": "uuid_123",
  "code": "dr_gillingham",
  "label": "Dr Gillingham",
  "type": "person",
  "properties": {"role": "researcher"},
  "source_pi": "01KA1H53CP..."
}
```

### Merge Entity
```http
POST /entity/merge
Content-Type: application/json

{
  "canonical_id": "uuid_123",
  "new_properties": {"updated": "data"},
  "source_pi": "01KA1H5VGR..."
}
```

### Create Relationships
```http
POST /relationships/create
Content-Type: application/json

{
  "relationships": [
    {
      "subject_id": "uuid_123",
      "predicate": "affiliated_with",
      "object_id": "uuid_456",
      "properties": {"since": "2020"},
      "source_pi": "01KA1H53CP..."
    }
  ]
}
```

## Architecture

```
Orchestrator
     ↓
[GraphDB Gateway Worker]
     ↓ (neo4j+s://)
Neo4j AuraDB
```

### Technology Stack

- **Runtime:** Cloudflare Workers (V8 isolates)
- **Language:** TypeScript 5.9
- **Database:** Neo4j AuraDB 5.27
- **Driver:** neo4j-driver 5.28
- **Build:** TypeScript compiler
- **Deploy:** Wrangler CLI

## Project Structure

```
graphdb-gateway/
├── src/
│   ├── index.ts          # Main worker & API handlers
│   ├── neo4j.ts          # Neo4j connection module
│   └── types.ts          # TypeScript type definitions
├── tests/
│   ├── test-neo4j.js     # Neo4j connectivity tests
│   ├── test-endpoints.sh # Local API tests
│   ├── test-production.sh# Production API tests
│   └── explore-data.js   # Database exploration
├── scripts/
│   ├── populate-sample-data.js  # Sample data generator
│   └── cleanup-test-data.js     # Test data cleanup
├── docs/
│   ├── SETUP.md          # Setup & deployment guide
│   ├── QUICK_START.md    # Quick reference
│   ├── DEPLOYMENT.md     # Production deployment info
│   └── neo4j_documentation.md
├── wrangler.jsonc        # Cloudflare Worker config
├── tsconfig.json         # TypeScript config
└── package.json          # Project dependencies
```

## Neo4j Schema

### Node Types
- `(:PI {id, created_at, indexed_at})`
- `(:Entity {canonical_id, code, label, type, properties, first_seen, last_updated})`
- `(:Entity:Date)` - Date entities
- `(:Entity:File)` - File entities

### Relationship Types
- `(:PI)-[:PARENT_OF]->(:PI)`
- `(:PI)-[:CHILD_OF]->(:PI)`
- `(:Entity)-[:EXTRACTED_FROM {original_code, extracted_at}]->(:PI)`
- `(:Entity)-[:RELATIONSHIP {predicate, properties, source_pi}]->(:Entity)`

## Development

### Available Commands

```bash
npm run dev              # Start local development server
npm run deploy           # Deploy to Cloudflare
npm run logs             # View production logs

npm test                 # Test Neo4j connectivity
npm run test:endpoints   # Test API endpoints (local)
npm run test:production  # Test production deployment

npm run populate         # Add sample data to Neo4j
npm run explore          # View database contents
npm run cleanup          # Remove test data
```

### Environment Variables

Create `.dev.vars` file:

```env
NEO4J_URI=neo4j+s://xxx.databases.neo4j.io
NEO4J_USERNAME=neo4j
NEO4J_PASSWORD=your-password
NEO4J_DATABASE=neo4j
```

### Testing

```bash
# Test Neo4j connection
npm run test:neo4j

# Test local endpoints (requires npm run dev in another terminal)
npm run test:endpoints

# Test production deployment
npm run test:production
```

## Deployment

### Prerequisites
- Cloudflare account
- Wrangler CLI configured
- Neo4j AuraDB instance

### Deploy Steps

```bash
# 1. Login to Cloudflare
npx wrangler login

# 2. Set production secrets
npx wrangler secret put NEO4J_URI
npx wrangler secret put NEO4J_USERNAME
npx wrangler secret put NEO4J_PASSWORD

# 3. Deploy
npm run deploy
```

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for detailed deployment information.

## Performance

- **Cold Start:** 26ms
- **Bundle Size:** 1.4 MB (186 KB gzipped)
- **Max Timeout:** 30 seconds
- **Connection Pool:** 50 concurrent connections
- **Edge Locations:** Cloudflare global network (300+ cities)

## Security

- ✅ TLS/HTTPS encryption
- ✅ Secrets stored in Cloudflare (not in code)
- ✅ Secure Neo4j connection (neo4j+s://)
- ⚠️ CORS currently set to `*` (configure for production)
- ⚠️ No authentication layer (add for production)

## Documentation

- **[Setup Guide](docs/SETUP.md)** - Complete setup and configuration
- **[Quick Start](docs/QUICK_START.md)** - Quick reference and examples
- **[Deployment](docs/DEPLOYMENT.md)** - Production deployment details
- **[Neo4j Docs](docs/neo4j_documentation.md)** - Neo4j driver documentation

## Contributing

This is an internal Arke Institute project. For questions or issues:
- Open an issue in this repository
- Contact the development team

## License

ISC

---

**Production URL:** https://graphdb-gateway.arke.institute
**Neo4j Browser:** https://workspace-preview.neo4j.io/

Built with ❤️ by Arke Institute
