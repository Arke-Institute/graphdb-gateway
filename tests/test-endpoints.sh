#!/bin/bash

# Test script for GraphDB Gateway endpoints
# Make sure the worker is running with: npm run dev

BASE_URL="http://localhost:8788"

echo "🧪 Testing GraphDB Gateway Endpoints"
echo "===================================="
echo ""

# Test 1: Health check
echo "📍 Test 1: Health Check"
echo "GET $BASE_URL/health"
curl -s "$BASE_URL/health" | jq .
echo ""
echo ""

# Test 2: Create PI node with parent and children
echo "📍 Test 2: Create PI Node"
echo "POST $BASE_URL/pi/create"
curl -s -X POST "$BASE_URL/pi/create" \
  -H "Content-Type: application/json" \
  -d '{
    "pi": "01KA1H53CP8Y9V2XQN5Z3R7M4E",
    "parent": "01KA1H51YC8Y9V2XQN5Z3R7M4E",
    "children": ["01KA1H5VGR8Y9V2XQN5Z3R7M4E", "01KA1H63MP8Y9V2XQN5Z3R7M4E"]
  }' | jq .
echo ""
echo ""

# Test 3: Create entity
echo "📍 Test 3: Create Entity"
echo "POST $BASE_URL/entity/create"
curl -s -X POST "$BASE_URL/entity/create" \
  -H "Content-Type: application/json" \
  -d '{
    "canonical_id": "uuid_123_test",
    "code": "dr_gillingham",
    "label": "Dr Gillingham",
    "type": "person",
    "properties": {
      "role": "researcher",
      "department": "Computer Science"
    },
    "source_pi": "01KA1H5VGR8Y9V2XQN5Z3R7M4E"
  }' | jq .
echo ""
echo ""

# Test 4: Create another entity for relationship testing
echo "📍 Test 4: Create Second Entity"
echo "POST $BASE_URL/entity/create"
curl -s -X POST "$BASE_URL/entity/create" \
  -H "Content-Type: application/json" \
  -d '{
    "canonical_id": "uuid_456_test",
    "code": "cambridge_university",
    "label": "Cambridge University",
    "type": "organization",
    "properties": {
      "location": "Cambridge, UK",
      "type": "university"
    },
    "source_pi": "01KA1H5VGR8Y9V2XQN5Z3R7M4E"
  }' | jq .
echo ""
echo ""

# Test 5: Query children entities
echo "📍 Test 5: Query Children Entities"
echo "POST $BASE_URL/entities/query_children"
curl -s -X POST "$BASE_URL/entities/query_children" \
  -H "Content-Type: application/json" \
  -d '{
    "pi": "01KA1H53CP8Y9V2XQN5Z3R7M4E",
    "label": "Dr Gillingham",
    "type": "person"
  }' | jq .
echo ""
echo ""

# Test 6: Merge entity (add from another PI)
echo "📍 Test 6: Merge Entity"
echo "POST $BASE_URL/entity/merge"
curl -s -X POST "$BASE_URL/entity/merge" \
  -H "Content-Type: application/json" \
  -d '{
    "canonical_id": "uuid_123_test",
    "new_properties": {
      "role": "senior researcher",
      "department": "Computer Science",
      "publications": 42
    },
    "source_pi": "01KA1H63MP8Y9V2XQN5Z3R7M4E"
  }' | jq .
echo ""
echo ""

# Test 7: Create relationships
echo "📍 Test 7: Create Relationships"
echo "POST $BASE_URL/relationships/create"
curl -s -X POST "$BASE_URL/relationships/create" \
  -H "Content-Type: application/json" \
  -d '{
    "relationships": [
      {
        "subject_id": "uuid_123_test",
        "predicate": "affiliated_with",
        "object_id": "uuid_456_test",
        "properties": {
          "since": "2020",
          "role": "researcher"
        },
        "source_pi": "01KA1H5VGR8Y9V2XQN5Z3R7M4E"
      }
    ]
  }' | jq .
echo ""
echo ""

echo "✅ All endpoint tests completed!"
echo ""
echo "💡 To cleanup test data, run:"
echo "   node cleanup-test-data.js"
