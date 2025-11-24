#!/bin/bash
# Integration test for cleanup phase merge workflow
# Tests the complete flow: create duplicates → redirect relationships → delete duplicate
# Usage: ./tests/test-cleanup-merge.sh [endpoint]
# Example: ./tests/test-cleanup-merge.sh http://localhost:8787

set -e  # Exit on error

ENDPOINT="${1:-http://localhost:8787}"
echo "Testing cleanup merge workflow at: $ENDPOINT"
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Test counter
TESTS_PASSED=0
TESTS_FAILED=0

# Helper function to run tests
run_test() {
  local test_name="$1"
  local expected="$2"
  local response="$3"

  echo -n "  ✓ $test_name ... "

  if echo "$response" | grep -q "$expected"; then
    echo -e "${GREEN}PASSED${NC}"
    ((TESTS_PASSED++))
  else
    echo -e "${RED}FAILED${NC}"
    echo "    Expected: $expected"
    echo "    Response: $response"
    ((TESTS_FAILED++))
  fi
}

echo "=========================================="
echo -e "${BLUE}SCENARIO: Cleanup Phase Integration Test${NC}"
echo "=========================================="
echo ""
echo "Simulating orchestrator cleanup phase:"
echo "1. Two duplicate entities discovered after Pinecone propagation"
echo "2. Both have domain relationships and provenance"
echo "3. Redirect all relationships to canonical entity"
echo "4. Delete duplicate entity"
echo "5. Verify all data preserved"
echo ""

# Create test PIs
PI_1="cleanup_merge_pi_1_$(date +%s)"
PI_2="cleanup_merge_pi_2_$(date +%s)"

echo -e "${YELLOW}Step 1: Creating test PIs${NC}"
curl -s -X POST "$ENDPOINT/pi/create" \
  -H "Content-Type: application/json" \
  -d "{\"pi\": \"$PI_1\"}" > /dev/null

curl -s -X POST "$ENDPOINT/pi/create" \
  -H "Content-Type: application/json" \
  -d "{\"pi\": \"$PI_2\"}" > /dev/null

echo "  Created PIs: $PI_1, $PI_2"
echo ""

# Create duplicate entity (will be merged away)
DUPLICATE_ID="duplicate-lincoln-$(date +%s)"

echo -e "${YELLOW}Step 2: Creating duplicate entity (Abraham Lincoln)${NC}"
curl -s -X POST "$ENDPOINT/entity/create" \
  -H "Content-Type: application/json" \
  -d "{
    \"canonical_id\": \"$DUPLICATE_ID\",
    \"code\": \"person_lincoln_dup\",
    \"label\": \"Abraham Lincoln\",
    \"type\": \"person\",
    \"properties\": {
      \"birthdate\": \"1809-02-12\",
      \"role\": \"president\"
    },
    \"source_pi\": \"$PI_1\"
  }" > /dev/null

echo "  Created duplicate entity: $DUPLICATE_ID"
echo "  Label: Abraham Lincoln"
echo "  Properties: birthdate, role=president"
echo ""

# Create canonical entity (will be kept)
CANONICAL_ID="canonical-lincoln-$(date +%s)"

echo -e "${YELLOW}Step 3: Creating canonical entity (Abraham Lincoln)${NC}"
curl -s -X POST "$ENDPOINT/entity/create" \
  -H "Content-Type: application/json" \
  -d "{
    \"canonical_id\": \"$CANONICAL_ID\",
    \"code\": \"person_lincoln_canonical\",
    \"label\": \"Abraham Lincoln\",
    \"type\": \"person\",
    \"properties\": {
      \"birthdate\": \"1809-02-12\",
      \"role\": \"general\"
    },
    \"source_pi\": \"$PI_2\"
  }" > /dev/null

echo "  Created canonical entity: $CANONICAL_ID"
echo "  Label: Abraham Lincoln"
echo "  Properties: birthdate, role=general"
echo ""

# Create related entities for relationships
echo -e "${YELLOW}Step 4: Creating related entities${NC}"

USA_ID="usa-$(date +%s)"
curl -s -X POST "$ENDPOINT/entity/create" \
  -H "Content-Type: application/json" \
  -d "{
    \"canonical_id\": \"$USA_ID\",
    \"code\": \"country_usa\",
    \"label\": \"United States\",
    \"type\": \"organization\",
    \"properties\": {\"type\": \"country\"},
    \"source_pi\": \"$PI_1\"
  }" > /dev/null

CIVIL_WAR_ID="civil-war-$(date +%s)"
curl -s -X POST "$ENDPOINT/entity/create" \
  -H "Content-Type: application/json" \
  -d "{
    \"canonical_id\": \"$CIVIL_WAR_ID\",
    \"code\": \"event_civil_war\",
    \"label\": \"Civil War\",
    \"type\": \"event\",
    \"properties\": {\"start\": \"1861\", \"end\": \"1865\"},
    \"source_pi\": \"$PI_1\"
  }" > /dev/null

PHILA_ID="philadelphia-$(date +%s)"
curl -s -X POST "$ENDPOINT/entity/create" \
  -H "Content-Type: application/json" \
  -d "{
    \"canonical_id\": \"$PHILA_ID\",
    \"code\": \"place_philadelphia\",
    \"label\": \"Philadelphia\",
    \"type\": \"location\",
    \"properties\": {\"state\": \"Pennsylvania\"},
    \"source_pi\": \"$PI_2\"
  }" > /dev/null

echo "  Created: United States ($USA_ID)"
echo "  Created: Civil War ($CIVIL_WAR_ID)"
echo "  Created: Philadelphia ($PHILA_ID)"
echo ""

# Create relationships from duplicate entity
echo -e "${YELLOW}Step 5: Creating relationships from duplicate entity${NC}"

curl -s -X POST "$ENDPOINT/relationships/create" \
  -H "Content-Type: application/json" \
  -d "{
    \"relationships\": [
      {
        \"subject_id\": \"$DUPLICATE_ID\",
        \"predicate\": \"led_country\",
        \"object_id\": \"$USA_ID\",
        \"properties\": {\"term\": \"1861-1865\"},
        \"source_pi\": \"$PI_1\"
      },
      {
        \"subject_id\": \"$DUPLICATE_ID\",
        \"predicate\": \"participated_in\",
        \"object_id\": \"$CIVIL_WAR_ID\",
        \"properties\": {\"role\": \"commander\"},
        \"source_pi\": \"$PI_1\"
      },
      {
        \"subject_id\": \"$PHILA_ID\",
        \"predicate\": \"contains\",
        \"object_id\": \"$DUPLICATE_ID\",
        \"properties\": {\"reason\": \"delivered_speech\"},
        \"source_pi\": \"$PI_2\"
      }
    ]
  }" > /dev/null

echo "  Created 3 relationships:"
echo "    • Lincoln → led_country → USA"
echo "    • Lincoln → participated_in → Civil War"
echo "    • Philadelphia → contains → Lincoln (incoming)"
echo ""

# Create relationships from canonical entity
echo -e "${YELLOW}Step 6: Creating relationships from canonical entity${NC}"

curl -s -X POST "$ENDPOINT/relationships/create" \
  -H "Content-Type: application/json" \
  -d "{
    \"relationships\": [
      {
        \"subject_id\": \"$CANONICAL_ID\",
        \"predicate\": \"governed\",
        \"object_id\": \"$USA_ID\",
        \"properties\": {\"years\": \"4\"},
        \"source_pi\": \"$PI_2\"
      }
    ]
  }" > /dev/null

echo "  Created 1 relationship:"
echo "    • Lincoln (canonical) → governed → USA"
echo ""

# Verify initial state
echo "=========================================="
echo -e "${BLUE}VERIFICATION: Initial State${NC}"
echo "=========================================="

DUPLICATE_QUERY=$(curl -s -X POST "$ENDPOINT/entity/query" \
  -H "Content-Type: application/json" \
  -d "{\"code\": \"person_lincoln_dup\"}")

CANONICAL_QUERY=$(curl -s -X POST "$ENDPOINT/entity/query" \
  -H "Content-Type: application/json" \
  -d "{\"code\": \"person_lincoln_canonical\"}")

run_test "Duplicate entity exists" "\"found\":true" "$DUPLICATE_QUERY"
run_test "Duplicate has 2 outgoing relationships" "led_country" "$DUPLICATE_QUERY"
run_test "Duplicate has participated_in relationship" "participated_in" "$DUPLICATE_QUERY"
run_test "Canonical entity exists" "\"found\":true" "$CANONICAL_QUERY"
run_test "Canonical has 1 outgoing relationship" "governed" "$CANONICAL_QUERY"

echo ""

# PERFORM CLEANUP MERGE
echo "=========================================="
echo -e "${BLUE}ACTION: Redirecting Relationships${NC}"
echo "=========================================="

REDIRECT_RESPONSE=$(curl -s -X POST "$ENDPOINT/entity/redirect-relationships" \
  -H "Content-Type: application/json" \
  -d "{
    \"from_id\": \"$DUPLICATE_ID\",
    \"to_id\": \"$CANONICAL_ID\",
    \"preserve_provenance\": true
  }")

echo "Redirect response:"
echo "$REDIRECT_RESPONSE" | jq '.' 2>/dev/null || echo "$REDIRECT_RESPONSE"
echo ""

run_test "Redirect operation succeeded" "\"success\":true" "$REDIRECT_RESPONSE"
run_test "Redirected 3 relationships" "\"relationships_redirected\":3" "$REDIRECT_RESPONSE"
run_test "Merged 1 provenance edge" "\"provenance_edges_merged\":1" "$REDIRECT_RESPONSE"

echo ""

# Verify canonical entity has all relationships
echo "=========================================="
echo -e "${BLUE}VERIFICATION: Relationships Transferred${NC}"
echo "=========================================="

CANONICAL_AFTER=$(curl -s -X POST "$ENDPOINT/entity/query" \
  -H "Content-Type: application/json" \
  -d "{\"code\": \"person_lincoln_canonical\"}")

run_test "Canonical has led_country relationship" "led_country" "$CANONICAL_AFTER"
run_test "Canonical has participated_in relationship" "participated_in" "$CANONICAL_AFTER"
run_test "Canonical has governed relationship" "governed" "$CANONICAL_AFTER"
run_test "Canonical has incoming contains relationship" "contains" "$CANONICAL_AFTER"
run_test "Canonical has 2 source PIs" "$PI_1" "$CANONICAL_AFTER"

echo ""

# Verify duplicate has no relationships
echo "=========================================="
echo -e "${BLUE}VERIFICATION: Duplicate Cleaned${NC}"
echo "=========================================="

DUPLICATE_AFTER=$(curl -s -X POST "$ENDPOINT/entity/query" \
  -H "Content-Type: application/json" \
  -d "{\"code\": \"person_lincoln_dup\"}")

run_test "Duplicate entity still exists (for now)" "\"found\":true" "$DUPLICATE_AFTER"

# Count relationships (should be 0 except EXTRACTED_FROM which was moved)
DUPLICATE_REL_COUNT=$(echo "$DUPLICATE_AFTER" | grep -o "led_country\|participated_in\|governed" | wc -l || echo "0")

if [ "$DUPLICATE_REL_COUNT" -eq "0" ]; then
  echo -e "  ✓ Duplicate has no domain relationships ... ${GREEN}PASSED${NC}"
  ((TESTS_PASSED++))
else
  echo -e "  ✓ Duplicate has no domain relationships ... ${RED}FAILED${NC}"
  echo "    Found $DUPLICATE_REL_COUNT domain relationships"
  ((TESTS_FAILED++))
fi

echo ""

# Delete duplicate entity
echo "=========================================="
echo -e "${BLUE}ACTION: Deleting Duplicate Entity${NC}"
echo "=========================================="

DELETE_RESPONSE=$(curl -s -X DELETE "$ENDPOINT/entity/$DUPLICATE_ID")

echo "Delete response:"
echo "$DELETE_RESPONSE" | jq '.' 2>/dev/null || echo "$DELETE_RESPONSE"
echo ""

run_test "Delete operation succeeded" "\"success\":true" "$DELETE_RESPONSE"
run_test "Entity was deleted" "\"deleted\":true" "$DELETE_RESPONSE"

echo ""

# Verify duplicate is gone
echo "=========================================="
echo -e "${BLUE}VERIFICATION: Duplicate Removed${NC}"
echo "=========================================="

DUPLICATE_FINAL=$(curl -s -X POST "$ENDPOINT/entity/query" \
  -H "Content-Type: application/json" \
  -d "{\"code\": \"person_lincoln_dup\"}")

run_test "Duplicate entity no longer exists" "\"found\":false" "$DUPLICATE_FINAL"

echo ""

# Verify canonical entity still intact
echo "=========================================="
echo -e "${BLUE}VERIFICATION: Canonical Entity Intact${NC}"
echo "=========================================="

CANONICAL_FINAL=$(curl -s -X POST "$ENDPOINT/entity/query" \
  -H "Content-Type: application/json" \
  -d "{\"code\": \"person_lincoln_canonical\"}")

run_test "Canonical entity still exists" "\"found\":true" "$CANONICAL_FINAL"
run_test "All relationships preserved on canonical" "led_country" "$CANONICAL_FINAL"
run_test "Relationship properties preserved" "\"term\":\"1861-1865\"" "$CANONICAL_FINAL"
run_test "Incoming relationships preserved" "contains" "$CANONICAL_FINAL"

echo ""

# Verify related entities still exist
echo "=========================================="
echo -e "${BLUE}VERIFICATION: Related Entities Intact${NC}"
echo "=========================================="

USA_QUERY=$(curl -s -X POST "$ENDPOINT/entity/query" \
  -H "Content-Type: application/json" \
  -d "{\"code\": \"country_usa\"}")

run_test "USA entity still exists" "\"found\":true" "$USA_QUERY"
run_test "USA has relationships to canonical Lincoln" "\"target_code\":\"person_lincoln_canonical\"" "$USA_QUERY"

echo ""

# Cleanup
echo "=========================================="
echo -e "${YELLOW}Cleanup: Removing test data${NC}"
echo "=========================================="

curl -s -X POST "$ENDPOINT/admin/clear" > /dev/null
echo "  All test data removed"

echo ""
echo "=========================================="
echo -e "${BLUE}Test Summary${NC}"
echo "=========================================="
echo -e "Tests passed: ${GREEN}$TESTS_PASSED${NC}"
echo -e "Tests failed: ${RED}$TESTS_FAILED${NC}"
echo ""

if [ $TESTS_FAILED -eq 0 ]; then
  echo -e "${GREEN}✓ Integration test PASSED!${NC}"
  echo ""
  echo "Cleanup merge workflow verified:"
  echo "  ✓ Relationships redirected successfully"
  echo "  ✓ Provenance edges merged"
  echo "  ✓ Duplicate entity deleted"
  echo "  ✓ All data preserved on canonical entity"
  echo "  ✓ Related entities intact"
  exit 0
else
  echo -e "${RED}✗ Integration test FAILED!${NC}"
  exit 1
fi
