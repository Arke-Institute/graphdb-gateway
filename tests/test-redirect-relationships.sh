#!/bin/bash
# Test script for redirect-relationships endpoint
# Usage: ./tests/test-redirect-relationships.sh [endpoint]
# Example: ./tests/test-redirect-relationships.sh http://localhost:8787

set -e  # Exit on error

ENDPOINT="${1:-http://localhost:8787}"
echo "Testing redirect-relationships endpoint at: $ENDPOINT"
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test counter
TESTS_PASSED=0
TESTS_FAILED=0

# Helper function to run tests
run_test() {
  local test_name="$1"
  local expected="$2"
  local response="$3"

  echo -n "Testing: $test_name ... "

  if echo "$response" | grep -q "$expected"; then
    echo -e "${GREEN}PASSED${NC}"
    ((TESTS_PASSED++))
  else
    echo -e "${RED}FAILED${NC}"
    echo "Expected: $expected"
    echo "Response: $response"
    ((TESTS_FAILED++))
  fi
}

echo "=========================================="
echo "Setup: Creating test entities and relationships"
echo "=========================================="

# Create test PIs
echo "Creating test PI..."
PI_ID="test_redirect_pi_$(date +%s)"
curl -s -X POST "$ENDPOINT/pi/create" \
  -H "Content-Type: application/json" \
  -d "{\"pi\": \"$PI_ID\"}" > /dev/null

# Create duplicate entity A with relationships
echo "Creating entity A (duplicate)..."
ENTITY_A_ID="redirect-test-entity-a-$(date +%s)"
curl -s -X POST "$ENDPOINT/entity/create" \
  -H "Content-Type: application/json" \
  -d "{
    \"canonical_id\": \"$ENTITY_A_ID\",
    \"code\": \"entity_a\",
    \"label\": \"Entity A\",
    \"type\": \"person\",
    \"properties\": {\"role\": \"researcher\"},
    \"source_pi\": \"$PI_ID\"
  }" > /dev/null

# Create canonical entity B
echo "Creating entity B (canonical)..."
ENTITY_B_ID="redirect-test-entity-b-$(date +%s)"
curl -s -X POST "$ENDPOINT/entity/create" \
  -H "Content-Type: application/json" \
  -d "{
    \"canonical_id\": \"$ENTITY_B_ID\",
    \"code\": \"entity_b\",
    \"label\": \"Entity B\",
    \"type\": \"person\",
    \"properties\": {\"role\": \"professor\"},
    \"source_pi\": \"$PI_ID\"
  }" > /dev/null

# Create target entity for relationships
echo "Creating target entity C..."
ENTITY_C_ID="redirect-test-entity-c-$(date +%s)"
curl -s -X POST "$ENDPOINT/entity/create" \
  -H "Content-Type: application/json" \
  -d "{
    \"canonical_id\": \"$ENTITY_C_ID\",
    \"code\": \"entity_c\",
    \"label\": \"Entity C\",
    \"type\": \"organization\",
    \"properties\": {\"name\": \"University\"},
    \"source_pi\": \"$PI_ID\"
  }" > /dev/null

# Create source entity for incoming relationships
echo "Creating source entity D..."
ENTITY_D_ID="redirect-test-entity-d-$(date +%s)"
curl -s -X POST "$ENDPOINT/entity/create" \
  -H "Content-Type: application/json" \
  -d "{
    \"canonical_id\": \"$ENTITY_D_ID\",
    \"code\": \"entity_d\",
    \"label\": \"Entity D\",
    \"type\": \"organization\",
    \"properties\": {\"name\": \"Lab\"},
    \"source_pi\": \"$PI_ID\"
  }" > /dev/null

# Create relationships from A
echo "Creating relationships..."
curl -s -X POST "$ENDPOINT/relationships/create" \
  -H "Content-Type: application/json" \
  -d "{
    \"relationships\": [
      {
        \"subject_id\": \"$ENTITY_A_ID\",
        \"predicate\": \"affiliated_with\",
        \"object_id\": \"$ENTITY_C_ID\",
        \"properties\": {\"since\": \"2020\"},
        \"source_pi\": \"$PI_ID\"
      },
      {
        \"subject_id\": \"$ENTITY_D_ID\",
        \"predicate\": \"employs\",
        \"object_id\": \"$ENTITY_A_ID\",
        \"properties\": {\"position\": \"researcher\"},
        \"source_pi\": \"$PI_ID\"
      }
    ]
  }" > /dev/null

echo -e "${GREEN}Setup complete!${NC}"
echo ""

echo "=========================================="
echo "Test 1: Basic redirect (2 relationships)"
echo "=========================================="

RESPONSE=$(curl -s -X POST "$ENDPOINT/entity/redirect-relationships" \
  -H "Content-Type: application/json" \
  -d "{
    \"from_id\": \"$ENTITY_A_ID\",
    \"to_id\": \"$ENTITY_B_ID\",
    \"preserve_provenance\": true
  }")

run_test "Redirect returns success" '"success": true' "$RESPONSE"
run_test "Relationships redirected count is 2" '"relationships_redirected": 2' "$RESPONSE"
run_test "Provenance edges merged" '"provenance_edges_merged": 1' "$RESPONSE"

echo ""

echo "=========================================="
echo "Test 2: Verify relationships transferred"
echo "=========================================="

RESPONSE=$(curl -s -X POST "$ENDPOINT/entity/query" \
  -H "Content-Type: application/json" \
  -d "{\"code\": \"entity_b\"}")

run_test "Entity B has relationships" '"found": true' "$RESPONSE"
run_test "Entity B has affiliated_with relationship" "affiliated_with" "$RESPONSE"
run_test "Entity B has employs relationship" "employs" "$RESPONSE"

echo ""

echo "=========================================="
echo "Test 3: Verify duplicate has no relationships"
echo "=========================================="

RESPONSE=$(curl -s -X POST "$ENDPOINT/entity/query" \
  -H "Content-Type: application/json" \
  -d "{\"code\": \"entity_a\"}")

# Entity A should still exist but have no relationships (except EXTRACTED_FROM)
run_test "Entity A still exists" '"found": true' "$RESPONSE"

echo ""

echo "=========================================="
echo "Test 4: Idempotent redirect (call twice)"
echo "=========================================="

# Create new test entities for idempotency test
ENTITY_E_ID="redirect-test-entity-e-$(date +%s)"
ENTITY_F_ID="redirect-test-entity-f-$(date +%s)"

curl -s -X POST "$ENDPOINT/entity/create" \
  -H "Content-Type: application/json" \
  -d "{
    \"canonical_id\": \"$ENTITY_E_ID\",
    \"code\": \"entity_e\",
    \"label\": \"Entity E\",
    \"type\": \"person\",
    \"properties\": {},
    \"source_pi\": \"$PI_ID\"
  }" > /dev/null

curl -s -X POST "$ENDPOINT/entity/create" \
  -H "Content-Type: application/json" \
  -d "{
    \"canonical_id\": \"$ENTITY_F_ID\",
    \"code\": \"entity_f\",
    \"label\": \"Entity F\",
    \"type\": \"person\",
    \"properties\": {},
    \"source_pi\": \"$PI_ID\"
  }" > /dev/null

# Create relationship
curl -s -X POST "$ENDPOINT/relationships/create" \
  -H "Content-Type: application/json" \
  -d "{
    \"relationships\": [{
      \"subject_id\": \"$ENTITY_E_ID\",
      \"predicate\": \"knows\",
      \"object_id\": \"$ENTITY_F_ID\",
      \"properties\": {},
      \"source_pi\": \"$PI_ID\"
    }]
  }" > /dev/null

# First redirect
RESPONSE1=$(curl -s -X POST "$ENDPOINT/entity/redirect-relationships" \
  -H "Content-Type: application/json" \
  -d "{
    \"from_id\": \"$ENTITY_E_ID\",
    \"to_id\": \"$ENTITY_F_ID\",
    \"preserve_provenance\": false
  }")

# Second redirect (should succeed with 0 relationships)
RESPONSE2=$(curl -s -X POST "$ENDPOINT/entity/redirect-relationships" \
  -H "Content-Type: application/json" \
  -d "{
    \"from_id\": \"$ENTITY_E_ID\",
    \"to_id\": \"$ENTITY_F_ID\",
    \"preserve_provenance\": false
  }")

run_test "First redirect succeeds" '"success": true' "$RESPONSE1"
run_test "Second redirect succeeds (idempotent)" '"success": true' "$RESPONSE2"
run_test "Second redirect has 0 relationships" '"relationships_redirected": 0' "$RESPONSE2"

echo ""

echo "=========================================="
echo "Test 5: Entity not found"
echo "=========================================="

RESPONSE=$(curl -s -X POST "$ENDPOINT/entity/redirect-relationships" \
  -H "Content-Type: application/json" \
  -d "{
    \"from_id\": \"nonexistent-entity\",
    \"to_id\": \"$ENTITY_B_ID\",
    \"preserve_provenance\": true
  }")

run_test "Returns 404 for nonexistent entity" "ENTITY_NOT_FOUND" "$RESPONSE"

echo ""

echo "=========================================="
echo "Test 6: Delete entity with relationships (should fail)"
echo "=========================================="

RESPONSE=$(curl -s -X DELETE "$ENDPOINT/entity/$ENTITY_B_ID")

run_test "Delete fails with relationships" "ENTITY_HAS_RELATIONSHIPS" "$RESPONSE"
run_test "Returns success false" '"success": false' "$RESPONSE"

echo ""

echo "=========================================="
echo "Test 7: Delete entity without relationships (should succeed)"
echo "=========================================="

# Entity A should have no relationships now (after redirect)
RESPONSE=$(curl -s -X DELETE "$ENDPOINT/entity/$ENTITY_A_ID")

run_test "Delete succeeds without relationships" '"success": true' "$RESPONSE"
run_test "Deleted flag is true" '"deleted": true' "$RESPONSE"

# Verify entity is gone
RESPONSE=$(curl -s -X POST "$ENDPOINT/entity/query" \
  -H "Content-Type: application/json" \
  -d "{\"code\": \"entity_a\"}")

run_test "Entity A no longer exists" '"found": false' "$RESPONSE"

echo ""

echo "=========================================="
echo "Test 8: Validation errors"
echo "=========================================="

# Missing from_id
RESPONSE=$(curl -s -X POST "$ENDPOINT/entity/redirect-relationships" \
  -H "Content-Type: application/json" \
  -d "{
    \"to_id\": \"$ENTITY_B_ID\"
  }")

run_test "Missing from_id returns validation error" "VALIDATION_ERROR" "$RESPONSE"

# Same from_id and to_id
RESPONSE=$(curl -s -X POST "$ENDPOINT/entity/redirect-relationships" \
  -H "Content-Type: application/json" \
  -d "{
    \"from_id\": \"$ENTITY_B_ID\",
    \"to_id\": \"$ENTITY_B_ID\"
  }")

run_test "Same from_id and to_id returns validation error" "VALIDATION_ERROR" "$RESPONSE"

echo ""

echo "=========================================="
echo "Cleanup: Removing test data"
echo "=========================================="

curl -s -X POST "$ENDPOINT/admin/clear" > /dev/null
echo -e "${GREEN}Cleanup complete!${NC}"

echo ""
echo "=========================================="
echo "Test Summary"
echo "=========================================="
echo -e "Tests passed: ${GREEN}$TESTS_PASSED${NC}"
echo -e "Tests failed: ${RED}$TESTS_FAILED${NC}"
echo ""

if [ $TESTS_FAILED -eq 0 ]; then
  echo -e "${GREEN}All tests passed!${NC}"
  exit 0
else
  echo -e "${RED}Some tests failed!${NC}"
  exit 1
fi
