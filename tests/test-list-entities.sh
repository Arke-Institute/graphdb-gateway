#!/bin/bash

BASE_URL="http://localhost:8787"

echo "🧪 Testing /entities/list Endpoint"
echo "===================================="
echo ""

# Test 1: Single PI
echo "📍 Test 1: List entities from single PI"
curl -s -X POST "$BASE_URL/entities/list" \
  -H "Content-Type: application/json" \
  -d '{
    "pi": "01PAPER_NEURAL_NETWORKS_2024"
  }' | python3 -m json.tool
echo ""
echo ""

# Test 2: Multiple PIs
echo "📍 Test 2: List entities from multiple PIs"
curl -s -X POST "$BASE_URL/entities/list" \
  -H "Content-Type: application/json" \
  -d '{
    "pis": ["01PAPER_NEURAL_NETWORKS_2024", "01PAPER_DEEP_LEARNING_2024", "01PAPER_TRANSFORMERS_2024"]
  }' | python3 -m json.tool
echo ""
echo ""

# Test 3: Single PI with type filter
echo "📍 Test 3: List only 'person' entities from single PI"
curl -s -X POST "$BASE_URL/entities/list" \
  -H "Content-Type: application/json" \
  -d '{
    "pi": "01PAPER_NEURAL_NETWORKS_2024",
    "type": "person"
  }' | python3 -m json.tool
echo ""
echo ""

# Test 4: Multiple PIs with type filter
echo "📍 Test 4: List only 'organization' entities from multiple PIs"
curl -s -X POST "$BASE_URL/entities/list" \
  -H "Content-Type: application/json" \
  -d '{
    "pis": ["01PAPER_NEURAL_NETWORKS_2024", "01PAPER_DEEP_LEARNING_2024"],
    "type": "organization"
  }' | python3 -m json.tool
echo ""
echo ""

# Test 5: Error case - no pi or pis provided
echo "📍 Test 5: Error case - missing pi/pis"
curl -s -X POST "$BASE_URL/entities/list" \
  -H "Content-Type: application/json" \
  -d '{}' | python3 -m json.tool
echo ""
echo ""

echo "✅ Tests completed!"
