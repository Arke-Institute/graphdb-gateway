#!/bin/bash

BASE_URL="https://graphdb-gateway.arke.institute"

echo "🌐 Testing Production /entities/list Endpoint"
echo "=============================================="
echo ""

# Test 1: Get all person entities from multiple papers
echo "📍 Test 1: Get all 'person' entities from 3 papers"
curl -s -X POST "$BASE_URL/entities/list" \
  -H "Content-Type: application/json" \
  -d '{
    "pis": ["01PAPER_NEURAL_NETWORKS_2024", "01PAPER_DEEP_LEARNING_2024", "01PAPER_TRANSFORMERS_2024"],
    "type": "person"
  }' | python3 -m json.tool
echo ""
echo ""

# Test 2: Get all entities from project parent
echo "📍 Test 2: Get all entities from single PI (parent project)"
curl -s -X POST "$BASE_URL/entities/list" \
  -H "Content-Type: application/json" \
  -d '{
    "pi": "01PROJECT_AI_RESEARCH_2024"
  }' | python3 -m json.tool
echo ""
echo ""

# Test 3: Get all organizations
echo "📍 Test 3: Get all 'organization' entities from all papers"
curl -s -X POST "$BASE_URL/entities/list" \
  -H "Content-Type: application/json" \
  -d '{
    "pis": ["01PAPER_NEURAL_NETWORKS_2024", "01PAPER_DEEP_LEARNING_2024", "01PAPER_TRANSFORMERS_2024"],
    "type": "organization"
  }' | python3 -m json.tool
echo ""
echo ""

echo "✅ Production tests completed!"
echo ""
echo "🌐 Worker URL: $BASE_URL"
