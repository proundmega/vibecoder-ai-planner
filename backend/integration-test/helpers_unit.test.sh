#!/usr/bin/env bash
# Unit tests for the local-checkout compose path in helpers.sh.
# Runs without a Docker daemon by stubbing `docker` and `sudo` on PATH.
#
# Skips inside the CI test container (/app/compose), where helpers.sh takes the
# CI branch instead. The local branch is the one this file exercises.
set -u

if [ -f /app/compose/docker-compose.yml ]; then
  echo "SKIP: /app/compose is present — local-checkout helper path is not used here"
  exit 0
fi

HELPERS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

BIN="$WORK_DIR/bin"
REPO="$WORK_DIR/repo"
mkdir -p "$BIN" "$REPO/backend/integration-test"
cp "$HELPERS_DIR/helpers.sh" "$REPO/backend/integration-test/helpers.sh"
: > "$REPO/docker-compose.yml"

# Stub `docker`: logs the invocation, honours STUB_DOCKER_FAIL, prints a marker.
cat > "$BIN/docker" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "docker $*" >> "$DOCKER_CALLS"
[ "${STUB_DOCKER_FAIL:-0}" = "1" ] && exit 1
printf 'stub-output'
STUB

# Stub `sudo`: logs the invocation and re-runs the inner command with docker
# forced to succeed, simulating a host where only `sudo docker` is allowed.
cat > "$BIN/sudo" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "sudo $*" >> "$DOCKER_CALLS"
STUB_DOCKER_FAIL=0 exec "$@"
STUB
chmod +x "$BIN/docker" "$BIN/sudo"

export PATH="$BIN:$PATH"
export DOCKER_CALLS="$WORK_DIR/calls.log"
: > "$DOCKER_CALLS"

# shellcheck source=helpers.sh
source "$REPO/backend/integration-test/helpers.sh"

FAILURES=0
check() { # label expected actual
  if [ "$2" = "$3" ]; then
    echo "ok - $1"
  else
    echo "not ok - $1: expected [$2], got [$3]"
    FAILURES=$((FAILURES + 1))
  fi
}
check_line() { # label exact logged invocation
  if grep -Fxq -- "$2" "$DOCKER_CALLS"; then
    echo "ok - $1"
  else
    echo "not ok - $1: no logged line [$2]"
    FAILURES=$((FAILURES + 1))
  fi
}
check_no_match() { # label regex that must not appear in the log
  if grep -Eq -- "$2" "$DOCKER_CALLS"; then
    echo "not ok - $1: log unexpectedly matched [$2]"
    FAILURES=$((FAILURES + 1))
  else
    echo "ok - $1"
  fi
}

COMPOSE_EXEC="compose -f $REPO/docker-compose.yml exec -T postgres psql -c select 1"

# Local branch: plain `docker compose -f <repo>/docker-compose.yml exec` is used,
# and neither sudo nor the legacy container fallback is reached on success.
: > "$DOCKER_CALLS"
out=$(docker_exec_out vibecode-postgres psql -c "select 1" 2>&1)
check "local compose exec returns captured output" "stub-output" "$out"
check_line "docker_exec_out uses the repo compose file" "docker $COMPOSE_EXEC"
check_no_match "no sudo retry after compose success" '^sudo '
check_no_match "no legacy docker exec after compose success" '^docker exec '

# Sudo fallback: plain docker fails, sudo docker succeeds, legacy name untouched.
: > "$DOCKER_CALLS"
STUB_DOCKER_FAIL=1 docker_exec vibecode-postgres psql -c "select 1"
check "docker_exec falls back to sudo compose" "0" "$?"
check_line "docker_exec attempts plain compose first" "docker $COMPOSE_EXEC"
check_line "docker_exec retries the compose file via sudo" "sudo docker $COMPOSE_EXEC"
check_no_match "docker_exec skips the legacy container" '^docker exec '

: > "$DOCKER_CALLS"
out=$(STUB_DOCKER_FAIL=1 docker_exec_out vibecode-postgres psql -c "select 1" 2>&1)
check "docker_exec_out falls back to sudo compose" "stub-output" "$out"
check_line "docker_exec_out attempts plain compose first" "docker $COMPOSE_EXEC"
check_line "docker_exec_out retries the compose file via sudo" "sudo docker $COMPOSE_EXEC"
check_no_match "docker_exec_out skips the legacy container" '^docker exec '

if [ "$FAILURES" -gt 0 ]; then
  echo "FAILED: $FAILURES helper unit test(s) failed"
  exit 1
fi
echo "ALL HELPER UNIT TESTS PASSED"
