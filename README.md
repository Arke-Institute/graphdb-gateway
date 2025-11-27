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

- **Edge-deployed** - Runs on Cloudflare's global network (300+ cities)
- **Secure** - TLS encryption, credential management via Cloudflare Secrets
- **Fast** - 26ms cold start, connection pooling, database indexes
- **Graph Operations** - PI hierarchy, entity management, relationship creation
- **Hierarchy Queries** - Parent/child entity traversal with caching support
- **Atomic Merging** - APOC-based entity absorption with full relationship transfer
- **Type-safe** - Full TypeScript implementation with modular architecture
- **Well-tested** - Complete test suite with sample data

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

#### Create Entity (Idempotent)
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

// Idempotent: Uses MERGE on canonical_id
// First call: Creates entity (ON CREATE)
// Subsequent calls: Updates timestamp (ON MATCH)
// All requests with same canonical_id succeed (no 409)
```

#### Atomic Merge (Absorb Entity)
```http
POST /entity/merge
Content-Type: application/json

{
  "source_id": "uuid-of-entity-to-delete",
  "target_id": "uuid-of-entity-to-keep"
}

// Response (success)
{
  "success": true,
  "target_id": "uuid-of-entity-to-keep",
  "merged": {
    "properties_transferred": 5,
    "relationships_transferred": 12,
    "source_pis_added": ["pi1", "pi2"]
  }
}

// Response (target not found - 404)
{
  "success": false,
  "error": "target_not_found",
  "message": "Target entity does not exist"
}

// Response (source not found - 404)
{
  "success": false,
  "error": "source_not_found",
  "message": "Source entity does not exist (may have been merged already)"
}
```

**Atomic Merge Behavior:**
- Absorbs source entity INTO target entity
- Transfers ALL relationships from source to target
- Merges properties (target wins on conflicts)
- Deletes source entity after transfer
- Uses APOC `refactor.mergeNodes` for atomicity
- Single Neo4j transaction - completes fully or rolls back

#### Check Entity Exists
```http
GET /entity/exists/:canonical_id

// Response
{
  "exists": true
}
```

#### Get Entity by ID
```http
GET /entity/:canonical_id

// Response (found)
{
  "found": true,
  "entity": {
    "canonical_id": "uuid_123",
    "code": "dr_gillingham",
    "label": "Dr Gillingham",
    "type": "person",
    "properties": {"role": "researcher"},
    "created_by_pi": "01KA1H53CP...",
    "source_pis": ["01KA1H53CP...", "01KA1H63MP..."]
  }
}

// Response (not found)
{
  "found": false
}
```

#### Delete Entity (Cascade)
```http
DELETE /entity/:canonical_id

// Response
{
  "success": true,
  "canonical_id": "uuid_123",
  "deleted": true,
  "relationship_count": 5  // Relationships deleted
}
```

#### Query Entity (with Relationships)
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

#### Lookup Entities by Code
```http
POST /entities/lookup-by-code
Content-Type: application/json

{
  "code": "concert_a",
  "type": "unknown",        // Optional: only return this type
  "excludeType": "unknown"  // Optional: exclude this type
}

// Response
{
  "entities": [
    {
      "canonical_id": "uuid_123",
      "code": "concert_a",
      "label": "Concert A",
      "type": "event",
      "properties": {...},
      "created_by_pi": "...",
      "source_pis": [...]
    }
  ],
  "count": 1
}
```

### Lineage Operations

#### Find Entity in Lineage
```http
POST /entities/find-in-lineage
Content-Type: application/json

{
  "sourcePi": "01KA1H53CP...",
  "candidateIds": ["uuid1", "uuid2", "uuid3"],
  "maxHops": 10
}

// Response (found in direct lineage)
{
  "found": true,
  "entity": {
    "canonical_id": "uuid_123",
    "code": "concert_a",
    "label": "Concert A",
    "type": "event",
    "properties": {...},
    "created_by_pi": "..."
  },
  "hops": 2,
  "direction": "ancestor"  // ancestor | descendant | same
}

// Response (not in lineage)
{
  "found": false
}
```

**Notes:**
- **Direct lineage only**: Only matches ancestors (up) or descendants (down)
- **No cousin matching**: Entities in sibling branches are NOT matched
- Used for placeholder resolution within the same document branch

### Relationship Operations

#### Get Entity Relationships
```http
GET /relationships/:canonical_id

// Response (found)
{
  "found": true,
  "canonical_id": "uuid_123",
  "relationships": [
    {
      "direction": "outgoing",
      "predicate": "affiliated_with",
      "target_id": "uuid_456",
      "target_code": "org_123",
      "target_label": "Organization Name",
      "target_type": "organization",
      "properties": {"since": "2020"},
      "source_pi": "01KA1H53CP...",
      "created_at": "2025-11-19T22:00:00Z"
    }
  ],
  "total_count": 2
}

// Response (not found)
{
  "found": false
}
```

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

// Note: Allows duplicate relationships
// Use /relationships/merge for idempotent behavior
```

#### Merge Relationships (Idempotent)
```http
POST /relationships/merge
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

// Response
{
  "success": true,
  "message": "Relationships merged successfully",
  "data": {
    "count": 1,
    "relationshipsCreated": 1,
    "relationshipsUpdated": 0
  }
}

// Uniqueness key: (subject_id, predicate, object_id, source_pi)
// First call: Creates relationship
// Subsequent calls: Updates properties, prevents duplicates
```

### Admin Operations

#### Custom Query
```http
POST /query
Content-Type: application/json

{
  "query": "MATCH (e:Entity) RETURN count(e) as entity_count",
  "params": {}  // Optional parameters
}

// Response
{
  "results": [{"entity_count": 100}],
  "count": 1,
  "summary": {
    "counters": {...},
    "queryType": "r"
  }
}
```

**Safeguard:** Mass delete patterns are blocked to prevent accidental data loss:
- `MATCH (n) DETACH DELETE n` ❌ Blocked
- `MATCH (n:Entity {id: 'foo'}) DELETE n` ✓ Allowed (filtered)

#### Clear Test Data
```http
POST /admin/clear-test-data
Content-Type: application/json

{}

// Response
{
  "success": true,
  "message": "Test data cleared successfully",
  "data": {
    "deleted_nodes": 16,
    "deleted_relationships": 12,
    "pattern": "nodes with \"test\" in id or canonical_id"
  }
}
```

**Safety:** Only deletes nodes where `id` or `canonical_id` contains "test". Safe to run in production - will not affect real data. Tests should use `test-` prefix in IDs.

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
- Decides whether to merge or create entities
- Semantic similarity scoring (via Pinecone)
- Resolves ALL entity references from properties
- Generates canonical IDs (UUIDs)
- Workflow orchestration

**GraphDB Gateway** (this service):
- Simple storage and retrieval of entities
- Atomic entity merging (absorb source into target)
- Track source PIs via EXTRACTED_FROM relationships
- Query parent/child entity hierarchies
- Database constraints and validation

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
│   │   ├── entity.ts        # Entity CRUD + atomic merge
│   │   ├── hierarchy.ts     # Lineage operations
│   │   ├── relationship.ts  # Relationship operations
│   │   └── admin.ts         # Admin operations (query, clear)
│   ├── types/                # TypeScript type definitions
│   │   ├── index.ts         # Re-exports
│   │   ├── common.ts        # Shared types
│   │   ├── pi.ts            # PI types
│   │   ├── entity.ts        # Entity types
│   │   ├── hierarchy.ts     # Lineage types
│   │   └── relationship.ts  # Relationship types
│   └── utils/                # Shared utilities
│       ├── response.ts      # Response helpers
│       └── validation.ts    # Input validation
├── tests/
│   ├── test-neo4j.js           # Neo4j connectivity tests
│   ├── test-endpoints.sh       # Local API tests
│   ├── test-production.sh      # Production API tests
│   └── explore-data.js         # Database exploration
├── scripts/
│   ├── populate-sample-data.js  # Sample data generator
│   ├── cleanup-test-data.js     # Test data cleanup
│   └── add-indexes.js           # Database index setup
├── docs/
│   ├── SETUP.md             # Setup & deployment guide
│   ├── QUICK_START.md       # Quick reference
│   ├── DEPLOYMENT.md        # Production deployment info
│   └── neo4j_documentation.md
├── GRAPH_API_REQUIREMENTS.md # API specification
├── CLAUDE.md                 # AI assistant guidance
├── wrangler.jsonc            # Cloudflare Worker config
├── tsconfig.json             # TypeScript config
└── package.json              # Project dependencies
```

## Neo4j Schema

### Node Types
- `(:PI {id, created_at, indexed_at})`
- `(:Entity {canonical_id, code, label, type, properties, created_by_pi, first_seen, last_updated})`
  - `created_by_pi`: Immutable field tracking which PI first created this entity
  - Provides O(1) lookup of entity creator (faster than relationship traversal)
  - Preserved across all merge operations
- `(:Entity:Date)` - Date entities
- `(:Entity:File)` - File entities

### Relationship Types
- `(:PI)-[:PARENT_OF]->(:PI)`
- `(:PI)-[:CHILD_OF]->(:PI)`
- `(:Entity)-[:EXTRACTED_FROM {original_code, extracted_at}]->(:PI)`
  - Tracks all PIs that extracted/mentioned this entity
  - Different from `created_by_pi` (which only tracks the creator)
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
npm run add-indexes      # Add performance indexes
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

- TLS/HTTPS encryption
- Secrets stored in Cloudflare (not in code)
- Secure Neo4j connection (neo4j+s://)
- CORS currently set to `*` (configure for production)
- No authentication layer (add for production)

## Documentation

- **[Setup Guide](docs/SETUP.md)** - Complete setup and configuration
- **[Quick Start](docs/QUICK_START.md)** - Quick reference and examples
- **[Testing Guide](docs/TESTING.md)** - Test data conventions and cleanup
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

Built with Arke Institute
