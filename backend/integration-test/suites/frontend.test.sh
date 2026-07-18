#!/usr/bin/env bash
# Frontend SPA tests

test_frontend() {
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  Frontend"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:3000/")
  assert_status "Frontend serves SPA" "200" "$code"

  local body
  body=$(curl_sf "http://localhost:3000/")
  if echo "$body" | grep -q 'id="app"'; then
    pass "Frontend serves SPA with app div"
  else
    fail "Frontend" "app div not found in response"
  fi
}
test_frontend
