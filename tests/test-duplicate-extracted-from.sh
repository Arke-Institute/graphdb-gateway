#!/bin/bash

# Test script to verify EXTRACTED_FROM relationships are idempotent (no duplicates)
# Tests the fix for MERGE syntax bug

BASE_URL="https://graphdb-gateway.arke.institute"

echo "🧪 Testing EXTRACTED_FROM Idempotency Fix"
echo "=========================================="
echo ""

# Generate unique test IDs
TEST_PI="TEST_PI_$(date +%s)"
TEST_ENTITY_ID="test_entity_$(date +%s)"

echo "Test Setup:"
echo "  PI: $TEST_PI"
echo "  Entity ID: $TEST_ENTITY_ID"
echo ""

# Step 1: Create PI
echo "📍 Step 1: Create Test PI"
curl -s -X POST "$BASE_URL/pi/create" \
  -H "Content-Type: application/json" \
  -d "{
    \"pi\": \"$TEST_PI\"
  }" | jq .
echo ""

# Step 2: Create entity
echo "📍 Step 2: Create Entity (first time)"
curl -s -X POST "$BASE_URL/entity/create" \
  -H "Content-Type: application/json" \
  -d "{
    \"canonical_id\": \"$TEST_ENTITY_ID\",
    \"code\": \"alice_test\",
    \"label\": \"Alice Test\",
    \"type\": \"person\",
    \"properties\": {
      \"role\": \"researcher\"
    },
    \"source_pi\": \"$TEST_PI\"
  }" | jq .
echo ""

# Step 3: Merge with same PI (should NOT create duplicate EXTRACTED_FROM)
echo "📍 Step 3: Merge with SAME PI (link_only strategy) - should be idempotent"
curl -s -X POST "$BASE_URL/entity/merge" \
  -H "Content-Type: application/json" \
  -d "{
    \"canonical_id\": \"$TEST_ENTITY_ID\",
    \"enrichment_data\": {
      \"merge_strategy\": \"link_only\"
    },
    \"source_pi\": \"$TEST_PI\"
  }" | jq .
echo ""

# Step 4: Merge again with same PI
echo "📍 Step 4: Merge AGAIN with same PI - should still be idempotent"
curl -s -X POST "$BASE_URL/entity/merge" \
  -H "Content-Type: application/json" \
  -d "{
    \"canonical_id\": \"$TEST_ENTITY_ID\",
    \"enrichment_data\": {
      \"merge_strategy\": \"link_only\"
    },
    \"source_pi\": \"$TEST_PI\"
  }" | jq .
echo ""

# Step 5: Query entity to check EXTRACTED_FROM count
echo "📍 Step 5: Query Entity to Check EXTRACTED_FROM Relationships"
echo "Expected: Should have exactly 1 EXTRACTED_FROM relationship to $TEST_PI"
echo ""

# Use custom Cypher query to count EXTRACTED_FROM relationships
curl -s -X POST "$BASE_URL/query" \
  -H "Content-Type: application/json" \
  -d "{
    \"query\": \"MATCH (e:Entity {canonical_id: \\\$canonical_id})-[r:EXTRACTED_FROM]->(pi:PI) RETURN e.canonical_id as entity_id, e.code as code, count(r) as extracted_from_count, collect(DISTINCT pi.id) as source_pis\",
    \"params\": {
      \"canonical_id\": \"$TEST_ENTITY_ID\"
    }
  }" | jq .
echo ""

echo "📊 Analysis:"
echo "  ✅ If extracted_from_count = 1 → FIX WORKS (idempotent)"
echo "  ❌ If extracted_from_count > 1 → BUG STILL EXISTS (duplicates created)"
echo ""

# Step 6: Test merge_peers strategy too
echo "📍 Step 6: Test merge_peers strategy (should also be idempotent)"
curl -s -X POST "$BASE_URL/entity/merge" \
  -H "Content-Type: application/json" \
  -d "{
    \"canonical_id\": \"$TEST_ENTITY_ID\",
    \"enrichment_data\": {
      \"merge_strategy\": \"merge_peers\",
      \"new_properties\": {
        \"role\": \"senior researcher\"
      }
    },
    \"source_pi\": \"$TEST_PI\"
  }" | jq .
echo ""

# Step 7: Final count check
echo "📍 Step 7: Final EXTRACTED_FROM Count (after merge_peers)"
curl -s -X POST "$BASE_URL/query" \
  -H "Content-Type: application/json" \
  -d "{
    \"query\": \"MATCH (e:Entity {canonical_id: \\\$canonical_id})-[r:EXTRACTED_FROM]->(pi:PI {id: \\\$pi_id}) RETURN count(r) as relationship_count\",
    \"params\": {
      \"canonical_id\": \"$TEST_ENTITY_ID\",
      \"pi_id\": \"$TEST_PI\"
    }
  }" | jq .
echo ""

echo "✅ Test completed!"
echo ""
echo "💡 Expected Result: relationship_count should be 1 (not 2, 3, or 4)"
echo "💡 To cleanup: Delete PI $TEST_PI and Entity $TEST_ENTITY_ID manually or run cleanup script"
