#!/usr/bin/env bash
# Frontend SPA tests

test_frontend() {
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  Frontend"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  local frontend_url="${FRONTEND_URL:-http://localhost:3000}"
  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' "$frontend_url/")
  assert_status "Frontend serves SPA" "200" "$code"

  local body
  body=$(curl_sf "$frontend_url/")
  if echo "$body" | grep -q 'id="app"'; then
    pass "Frontend serves SPA with app div"
  else
    fail "Frontend" "app div not found in response"
  fi
}
test_frontend
