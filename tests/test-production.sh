#!/bin/bash

# Test script for production GraphDB Gateway
# Uses the deployed worker at graphdb-gateway.arke.institute

BASE_URL="https://graphdb-gateway.arke.institute"

echo "🌐 Testing Production GraphDB Gateway"
echo "======================================"
echo "URL: $BASE_URL"
echo ""

# Test 1: Health check
echo "📍 Test 1: Health Check"
echo "GET $BASE_URL/health"
curl -s "$BASE_URL/health" | jq .
echo ""
echo ""

# Test 2: Query existing entities (from our sample data)
echo "📍 Test 2: Query Existing Entities"
echo "POST $BASE_URL/entities/query_children"
curl -s -X POST "$BASE_URL/entities/query_children" \
  -H "Content-Type: application/json" \
  -d '{
    "pi": "01PROJECT_AI_RESEARCH_2024",
    "label": "Dr. Sarah Chen",
    "type": "person"
  }' | jq .
echo ""
echo ""

# Test 3: Query another entity
echo "📍 Test 3: Query Organization Entities"
echo "POST $BASE_URL/entities/query_children"
curl -s -X POST "$BASE_URL/entities/query_children" \
  -H "Content-Type: application/json" \
  -d '{
    "pi": "01PROJECT_AI_RESEARCH_2024",
    "label": "Stanford University",
    "type": "organization"
  }' | jq .
echo ""
echo ""

# Test 4: Create a new PI
echo "📍 Test 4: Create New PI (Production Test)"
echo "POST $BASE_URL/pi/create"
curl -s -X POST "$BASE_URL/pi/create" \
  -H "Content-Type: application/json" \
  -d '{
    "pi": "01PROD_TEST_PI_001",
    "parent": "01PROJECT_AI_RESEARCH_2024"
  }' | jq .
echo ""
echo ""

# Test 5: Create entity
echo "📍 Test 5: Create Entity (Production Test)"
echo "POST $BASE_URL/entity/create"
curl -s -X POST "$BASE_URL/entity/create" \
  -H "Content-Type: application/json" \
  -d '{
    "canonical_id": "prod_test_person_001",
    "code": "test_researcher",
    "label": "Test Researcher",
    "type": "person",
    "properties": {
      "title": "Tester",
      "department": "QA",
      "test": true
    },
    "source_pi": "01PROD_TEST_PI_001"
  }' | jq .
echo ""
echo ""

# Test 6: Query the entity we just created
echo "📍 Test 6: Query Newly Created Entity"
echo "POST $BASE_URL/entities/query_children"
curl -s -X POST "$BASE_URL/entities/query_children" \
  -H "Content-Type: application/json" \
  -d '{
    "pi": "01PROJECT_AI_RESEARCH_2024",
    "label": "Test Researcher",
    "type": "person"
  }' | jq .
echo ""
echo ""

# Test 7: Create relationship
echo "📍 Test 7: Create Relationship (Production Test)"
echo "POST $BASE_URL/relationships/create"
curl -s -X POST "$BASE_URL/relationships/create" \
  -H "Content-Type: application/json" \
  -d '{
    "relationships": [
      {
        "subject_id": "prod_test_person_001",
        "predicate": "affiliated_with",
        "object_id": "org_001_stanford",
        "properties": {
          "role": "Test Subject",
          "temporary": true
        },
        "source_pi": "01PROD_TEST_PI_001"
      }
    ]
  }' | jq .
echo ""
echo ""

echo "✅ Production tests completed!"
echo ""
echo "🌐 Your worker is live at: $BASE_URL"
echo "📊 Neo4j Browser: https://b54409b4.databases.neo4j.io"
echo ""
echo "💡 To cleanup production test data, run:"
echo "   node cleanup-test-data.js"
