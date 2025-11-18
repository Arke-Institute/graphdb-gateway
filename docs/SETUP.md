# GraphDB Gateway - Setup & Deployment Guide

## Project Overview

This Cloudflare Worker provides a RESTful API gateway to Neo4j AuraDB for entity linking operations.

## Prerequisites

- Node.js 18+ installed
- npm or yarn package manager
- Cloudflare account (for deployment)
- Neo4j AuraDB instance (or Neo4j database)

## Local Development Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment Variables

Create a `.dev.vars` file in the project root with your Neo4j credentials:

```env
NEO4J_URI=neo4j+s://your-instance.databases.neo4j.io
NEO4J_USERNAME=neo4j
NEO4J_PASSWORD=your-password
NEO4J_DATABASE=neo4j
```

### 3. Test Neo4j Connectivity

Run the connectivity test to ensure your Neo4j instance is accessible:

```bash
npm run test:neo4j
```

This will:
- Verify connection to Neo4j
- Create test PI nodes and entities
- Test all Cypher query patterns
- Clean up test data automatically

### 4. Start Local Development Server

```bash
npm run dev
```

The worker will be available at `http://localhost:8788`

### 5. Test API Endpoints

Run the endpoint test suite:

```bash
./test-endpoints.sh
```

This tests all 5 API endpoints:
- ✅ Health check
- ✅ Create PI nodes
- ✅ Create entities
- ✅ Query child entities
- ✅ Merge entities
- ✅ Create relationships

### 6. Clean Up Test Data

After testing, clean up test data from Neo4j:

```bash
node cleanup-test-data.js
```

## Deployment to Cloudflare

### 1. Login to Cloudflare

```bash
npx wrangler login
```

### 2. Set Production Secrets

Set your Neo4j credentials as Cloudflare secrets (these won't be in your code):

```bash
npx wrangler secret put NEO4J_URI
npx wrangler secret put NEO4J_USERNAME
npx wrangler secret put NEO4J_PASSWORD
```

### 3. Deploy

```bash
npm run deploy
```

Your worker will be deployed to Cloudflare's edge network!

## API Endpoints

### Health Check
```bash
GET /health
```

Returns worker status and available endpoints.

### Create PI Node
```bash
POST /pi/create
Content-Type: application/json

{
  "pi": "01KA1H53CP8Y9V2XQN5Z3R7M4E",
  "parent": "01KA1H51YC...",
  "children": ["01KA1H5VGR...", "01KA1H63MP..."]
}
```

### Query Child Entities
```bash
POST /entities/query_children
Content-Type: application/json

{
  "pi": "01KA1H53CP...",
  "label": "Dr Gillingham",
  "type": "person"
}
```

### Create Entity
```bash
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
```bash
POST /entity/merge
Content-Type: application/json

{
  "canonical_id": "uuid_123",
  "new_properties": {"updated": "data"},
  "source_pi": "01KA1H5VGR..."
}
```

### Create Relationships
```bash
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

## Project Structure

```
graphdb-gateway/
├── src/
│   ├── index.ts          # Main worker entry point & API handlers
│   ├── neo4j.ts          # Neo4j connection module
│   └── types.ts          # TypeScript type definitions
├── test-neo4j.js         # Neo4j connectivity test
├── test-endpoints.sh     # API endpoint test suite
├── cleanup-test-data.js  # Test data cleanup script
├── wrangler.jsonc        # Cloudflare Worker configuration
├── tsconfig.json         # TypeScript configuration
├── package.json          # Project dependencies
├── .dev.vars             # Local environment variables (git-ignored)
└── README.md             # Project overview
```

## Development Workflow

1. **Make changes** to `src/*.ts` files
2. **Local testing** - Wrangler auto-reloads on file changes
3. **Test endpoints** - Use `./test-endpoints.sh` or curl/Postman
4. **Clean up** - Run `node cleanup-test-data.js` after testing
5. **Deploy** - Run `npm run deploy` when ready

## Troubleshooting

### Connection Timeout
- Check Neo4j instance is running
- Verify URI uses `neo4j+s://` for secure connections
- Ensure firewall allows outbound connections

### Authentication Failed
- Verify NEO4J_USERNAME and NEO4J_PASSWORD in `.dev.vars`
- Check credentials in Neo4j Aura console

### Query Errors
- Check Cypher syntax in `src/index.ts`
- Enable detailed error logging in worker
- View errors in Wrangler dev console

## Performance Considerations

- **Driver Lifecycle**: Each request creates a new driver instance (stateless)
- **Connection Pool**: Configured for 50 max connections
- **Timeout**: 30 second maximum execution time
- **Memory**: 128 MB allocated per worker

## Security Notes

- Never commit `.dev.vars` to git
- Use Cloudflare secrets for production credentials
- CORS is currently set to `*` - restrict in production
- Error responses include stack traces - disable in production

## Next Steps

- [ ] Add request validation middleware
- [ ] Implement rate limiting
- [ ] Add authentication/API keys
- [ ] Set up monitoring and logging
- [ ] Create integration tests
- [ ] Add Cypher query optimization
- [ ] Implement caching layer

## Resources

- [Neo4j JavaScript Driver Docs](https://neo4j.com/docs/javascript-manual/current/)
- [Cloudflare Workers Docs](https://developers.cloudflare.com/workers/)
- [Wrangler CLI Docs](https://developers.cloudflare.com/workers/wrangler/)
