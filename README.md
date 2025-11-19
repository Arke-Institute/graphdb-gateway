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

- 🚀 **Edge-deployed** - Runs on Cloudflare's global network (300+ cities)
- 🔒 **Secure** - TLS encryption, credential management via Cloudflare Secrets
- ⚡ **Fast** - 26ms cold start, connection pooling, database indexes
- 📊 **Graph Operations** - PI hierarchy, entity management, relationship creation
- 🔍 **Hierarchy Queries** - Parent/child entity traversal with caching support
- 🔄 **Smart Merging** - 4 merge strategies including conflict resolution
- 🎯 **Type-safe** - Full TypeScript implementation with modular architecture
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

### PI Operations

#### Create PI Node
```http
POST /pi/create
Content-Type: application/json

{
  "pi": "01KA1H53CP8Y9V2XQN5Z3R7M4E",
  "parent": "01KA1H51YC...",
  "children": ["01KA1H5VGR...", "01KA1H63MP..."]
}
```

### Entity Operations

#### Create Entity
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

#### Merge Entity (Enhanced with Strategies)
```http
POST /entity/merge
Content-Type: application/json

{
  "canonical_id": "uuid_123",
  "enrichment_data": {
    "type": "person",              // Optional: upgrade placeholder type
    "label": "Updated Label",      // Optional: refine label
    "new_properties": {"role": "researcher"},
    "merge_strategy": "merge_peers"  // enrich_placeholder | merge_peers | link_only | prefer_new
  },
  "source_pi": "01KA1H5VGR..."
}

// Response includes conflicts for merge_peers strategy
{
  "canonical_id": "uuid_123",
  "updated": true,
  "conflicts": [
    {
      "property": "role",
      "existing_value": "president",
      "new_value": "general",
      "resolution": "accumulated"  // Now: ["president", "general"]
    }
  ]
}
```

**Merge Strategies:**
- `enrich_placeholder`: Upgrade placeholder (type="unknown") to rich entity
- `merge_peers`: Merge two rich entities with conflict resolution (accumulates into arrays)
- `link_only`: Just add source PI relationship, no data changes
- `prefer_new`: Overwrite existing data with new data

#### Query Entity
```http
POST /entity/query
Content-Type: application/json

{
  "code": "dr_gillingham"
}
```

#### List Entities
```http
POST /entities/list
Content-Type: application/json

{
  "pi": "01PAPER_001",       // Single PI
  // OR
  "pis": ["01PAPER_001", "01PAPER_002"],  // Multiple PIs
  "type": "person"            // Optional: filter by type
}
```

### Hierarchy Operations (NEW)

#### Find Entity in Hierarchy
```http
POST /entity/find-in-hierarchy
Content-Type: application/json

{
  "pi": "01KA1H53CP...",
  "code": "george_washington",
  "search_scope": "both",          // parents | children | both
  "include_placeholder": true      // Optional: include type="unknown"
}

// Response
{
  "found": true,
  "entity": {
    "canonical_id": "uuid_123",
    "code": "george_washington",
    "label": "George Washington",
    "type": "person",
    "properties": {"role": "president"},
    "source_pis": ["01KA1H63MP..."],
    "is_placeholder": false
  },
  "found_in": "parent"  // parent | child
}
```

#### Get Entities from Hierarchy (Bulk)
```http
POST /entities/hierarchy
Content-Type: application/json

{
  "pi": "01KA1H53CP...",
  "direction": "both",              // ancestors | descendants | both
  "exclude_type": ["file"],         // Optional: exclude types
  "include_placeholders": true      // Optional: include type="unknown"
}

// Response
{
  "entities": [...],
  "total_count": 45,
  "from_parents": 20,
  "from_children": 25
}
```

### Relationship Operations

#### Create Relationships
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
Orchestrator (entity linking pipeline)
     ↓
[GraphDB Gateway Worker] (Cloudflare edge)
     ↓ (neo4j+s://)
Neo4j AuraDB (graph database)
```

### Division of Responsibilities

**Orchestrator** (external service calling this API):
- ✅ Decides whether to merge, create, or enrich entities
- ✅ Semantic similarity scoring (via Pinecone)
- ✅ Resolves ALL entity references from properties
- ✅ Generates canonical IDs (UUIDs)
- ✅ Workflow orchestration

**GraphDB Gateway** (this service):
- ✅ Simple storage and retrieval of entities
- ✅ Execute property merging with conflict resolution
- ✅ Track source PIs via EXTRACTED_FROM relationships
- ✅ Query parent/child entity hierarchies
- ✅ Database constraints and validation

**Key Principle**: The orchestrator handles all decision-making logic; the Graph API is a data layer.

### Technology Stack

- **Runtime:** Cloudflare Workers (V8 isolates)
- **Language:** TypeScript 5.9
- **Database:** Neo4j AuraDB 5.27
- **Driver:** neo4j-driver 5.28
- **Build:** TypeScript compiler
- **Deploy:** Wrangler CLI

### Code Architecture

The codebase follows a modular, domain-driven design:
- **Handlers**: Domain-specific request handlers (PI, Entity, Hierarchy, Relationship)
- **Types**: Organized type definitions per domain
- **Utils**: Shared utilities for responses and validation
- **Router**: Clean route table with automatic dispatch
- **Constants**: Centralized configuration and error codes

Benefits: Easier testing, better maintainability, clear separation of concerns.

## Project Structure

```
graphdb-gateway/
├── src/
│   ├── index.ts              # Entry point (minimal)
│   ├── router.ts             # Route matching & dispatch
│   ├── constants.ts          # Configuration & error codes
│   ├── neo4j.ts              # Neo4j connection module
│   ├── handlers/             # Domain-specific handlers
│   │   ├── pi.ts            # PI operations
│   │   ├── entity.ts        # Entity CRUD operations
│   │   ├── hierarchy.ts     # Hierarchy traversal (NEW)
│   │   └── relationship.ts  # Relationship operations
│   ├── types/                # TypeScript type definitions
│   │   ├── index.ts         # Re-exports
│   │   ├── common.ts        # Shared types
│   │   ├── pi.ts            # PI types
│   │   ├── entity.ts        # Entity types
│   │   ├── hierarchy.ts     # Hierarchy types (NEW)
│   │   └── relationship.ts  # Relationship types
│   └── utils/                # Shared utilities
│       ├── response.ts      # Response helpers
│       └── validation.ts    # Input validation
├── tests/
│   ├── test-neo4j.js        # Neo4j connectivity tests
│   ├── test-endpoints.sh    # Local API tests
│   ├── test-production.sh   # Production API tests
│   └── explore-data.js      # Database exploration
├── scripts/
│   ├── populate-sample-data.js  # Sample data generator
│   ├── cleanup-test-data.js     # Test data cleanup
│   └── add-indexes.js           # Database index setup (NEW)
├── docs/
│   ├── SETUP.md             # Setup & deployment guide
│   ├── QUICK_START.md       # Quick reference
│   ├── DEPLOYMENT.md        # Production deployment info
│   └── neo4j_documentation.md
├── GRAPH_API_REQUIREMENTS.md # API specification (NEW)
├── CLAUDE.md                 # AI assistant guidance
├── wrangler.jsonc            # Cloudflare Worker config
├── tsconfig.json             # TypeScript config
└── package.json              # Project dependencies
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
# Development
npm run dev              # Start local development server
npm run deploy           # Deploy to Cloudflare
npm run logs             # View production logs

# Testing
npm test                 # Test Neo4j connectivity
npm run test:endpoints   # Test API endpoints (local)
npm run test:production  # Test production deployment

# Database utilities
npm run populate         # Add sample data to Neo4j
npm run explore          # View database contents
npm run cleanup          # Remove test data
npm run add-indexes      # Add performance indexes (NEW)
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

### Database Indexes

Performance-optimized indexes (created via `npm run add-indexes`):
- `entity_code_idx`: Index on Entity.code for fast hierarchy lookups
- `entity_type_code_idx`: Composite index on (Entity.type, Entity.code) for filtered queries

These indexes significantly improve:
- Entity hierarchy traversal performance
- Entity resolution during orchestration
- Filtered entity queries

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
