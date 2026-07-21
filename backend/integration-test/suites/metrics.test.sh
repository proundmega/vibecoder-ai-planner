#!/usr/bin/env bash
# Prometheus metrics integration tests

test_metrics() {
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  Prometheus Metrics"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  # 1. GET /metrics returns text/plain content-type
  local metrics_body
  metrics_body=$(curl_sf -D - "$BASE/metrics" 2>/dev/null)
  local headers body
  headers=$(echo "$metrics_body" | sed -e '/^$/q')
  body=$(echo "$metrics_body" | tail -n +3)
  if echo "$headers" | grep -qi "content-type:.*text/plain"; then
    pass "/metrics returns text/plain content-type"
  else
    fail "/metrics content-type" "expected text/plain, got: $(echo "$headers" | grep -i content-type)"
  fi

  # 2. Response contains http_request_duration_seconds
  if echo "$body" | grep -q "http_request_duration_seconds"; then
    pass "/metrics contains http_request_duration_seconds histogram"
  else
    fail "/metrics histogram" "missing http_request_duration_seconds"
  fi

  # 3. Response contains http_requests_total counter
  if echo "$body" | grep -q "http_requests_total"; then
    pass "/metrics contains http_requests_total counter"
  else
    fail "/metrics counter" "missing http_requests_total"
  fi

  # 4. Response contains db_pool_total gauge
  if echo "$body" | grep -q "db_pool_total"; then
    pass "/metrics contains db_pool_total gauge"
  else
    fail "/metrics db_pool_total" "missing db_pool_total"
  fi

  # 5. Response contains db_pool_idle gauge
  if echo "$body" | grep -q "db_pool_idle"; then
    pass "/metrics contains db_pool_idle gauge"
  else
    fail "/metrics db_pool_idle" "missing db_pool_idle"
  fi

  # 6. Response contains db_pool_waiting gauge
  if echo "$body" | grep -q "db_pool_waiting"; then
    pass "/metrics contains db_pool_waiting gauge"
  else
    fail "/metrics db_pool_waiting" "missing db_pool_waiting"
  fi

  # 7. GET /api/metrics returns application/json
  local api_metrics
  api_metrics=$(curl_sf "$BASE/api/metrics")
  if [ -n "$api_metrics" ]; then
    pass "/api/metrics returns JSON data"
  else
    fail "/api/metrics" "expected JSON response"
  fi

  # 8. /api/metrics contains uptime field
  if echo "$api_metrics" | jq -e '.data.uptime' >/dev/null 2>&1; then
    pass "/api/metrics contains uptime field"
  else
    fail "/api/metrics uptime" "missing uptime field"
  fi

  # 9. /api/metrics contains memoryUsage field
  if echo "$api_metrics" | jq -e '.data.memoryUsage' >/dev/null 2>&1; then
    pass "/api/metrics contains memoryUsage field"
  else
    fail "/api/metrics memoryUsage" "missing memoryUsage field"
  fi

  # 10. /api/metrics contains database field
  if echo "$api_metrics" | jq -e '.data.database' >/dev/null 2>&1; then
    pass "/api/metrics contains database field"
  else
    fail "/api/metrics database" "missing database field"
  fi

  # 11. /api/metrics returns success: true
  if echo "$api_metrics" | jq -e '.success == true' >/dev/null 2>&1; then
    pass "/api/metrics returns success: true"
  else
    fail "/api/metrics success" "expected success: true"
  fi
}
test_metrics
