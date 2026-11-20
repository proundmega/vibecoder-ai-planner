#!/usr/bin/env bash
# Prepare a fresh checkout for local development and PR checks.
#
# Installs the Node version pinned in .nvmrc (via nvm when available), installs
# the backend/frontend dependencies with `npm ci`, and downloads the Cypress
# binary that npm 11 no longer installs automatically. Optional tooling (Docker,
# JDK 17, Maven, Xvfb) is reported, never installed.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
NODE_VERSION="$(tr -d '[:space:]' < .nvmrc)"
SKIP_CYPRESS=0
for arg in "$@"; do
  case "$arg" in
    --no-cypress) SKIP_CYPRESS=1 ;;
    -h|--help)
      echo "Usage: $0 [--no-cypress]"
      exit 0
      ;;
    *)
      echo "Unknown option: $arg" >&2
      exit 1
      ;;
  esac
done

if [ ! -s "$NVM_DIR/nvm.sh" ]; then
  echo "==> Installing nvm into $NVM_DIR"
  mkdir -p "$NVM_DIR"
  curl -sSL --fail --max-time 120 \
    https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh \
    -o "$NVM_DIR/install.sh"
  bash "$NVM_DIR/install.sh"
fi

# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh"

echo "==> Using Node $NODE_VERSION from .nvmrc"
nvm install "$NODE_VERSION"
nvm use "$NODE_VERSION"

# Pick up the optional user-local JDK/Maven installed by hand or by a previous
# agent setup; nothing is installed here.
if [ -d "$HOME/.local/opt/jdk-17" ]; then
  export JAVA_HOME="$HOME/.local/opt/jdk-17"
  export PATH="$JAVA_HOME/bin:$PATH"
fi
if [ -d "$HOME/.local/opt/maven" ]; then
  export PATH="$HOME/.local/opt/maven/bin:$PATH"
fi

echo "==> Installing backend dependencies"
(cd backend && npm ci)

echo "==> Installing frontend dependencies"
(cd frontend && npm ci)

if [ "$SKIP_CYPRESS" -eq 0 ]; then
  echo "==> Installing the Cypress binary"
  (cd frontend && npx cypress install)
fi

echo
echo "==> Environment check"
if command -v docker >/dev/null 2>&1; then
  if docker info >/dev/null 2>&1; then
    echo "docker:  accessible"
  elif sudo -n docker info >/dev/null 2>&1; then
    echo "docker:  accessible via passwordless sudo (use 'sudo docker ...' or run-locally.sh)"
  else
    echo "docker:  installed but not accessible to ${USER:-this user}."
    echo "         Run 'sudo usermod -aG docker ${USER:-$LOGNAME}' and log out/in,"
    echo "         or use 'sudo docker compose ...' as run-locally.sh does."
  fi
else
  echo "docker:  not installed (required only for the Compose stack)"
fi

if command -v java >/dev/null 2>&1; then
  echo "java:    $(java -version 2>&1 | head -1)"
else
  echo "java:    not installed (optional, required for the Java agent)"
fi

if command -v mvn >/dev/null 2>&1; then
  echo "maven:   $(mvn -version 2>&1 | head -1)"
else
  echo "maven:   not installed (optional, required for the Java agent)"
fi

if ! command -v Xvfb >/dev/null 2>&1; then
  echo "xvfb:    not installed; run Cypress locally via Docker or install xvfb"
fi

echo
echo "Bootstrap complete. Verify the checkout with:"
echo "  bash scripts/verify-local.sh"
