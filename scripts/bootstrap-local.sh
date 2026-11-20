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
NVM_VERSION="v0.40.3"
NVM_INSTALL_SHA256="2d8359a64a3cb07c02389ad88ceecd43f2fa469c06104f92f98df5b6f315275f"
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
  for tool in curl git sha256sum; do
    if ! command -v "$tool" >/dev/null 2>&1; then
      echo "error: $tool is required to install nvm" >&2
      echo "Install it with your package manager, then re-run this script." >&2
      exit 1
    fi
  done

  echo "==> Installing nvm $NVM_VERSION into $NVM_DIR"
  mkdir -p "$NVM_DIR"
  curl -sSL --fail --max-time 120 \
    "https://raw.githubusercontent.com/nvm-sh/nvm/$NVM_VERSION/install.sh" \
    -o "$NVM_DIR/install.sh"
  if ! echo "$NVM_INSTALL_SHA256  $NVM_DIR/install.sh" | sha256sum -c - >/dev/null 2>&1; then
    echo "error: nvm install.sh checksum did not match" >&2
    rm -f "$NVM_DIR/install.sh"
    exit 1
  fi
  NVM_INSTALL_VERSION="$NVM_VERSION" bash "$NVM_DIR/install.sh"
  rm -f "$NVM_DIR/install.sh"
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

CHROME_BIN_FOUND="${CHROME_BIN:-}"
if [ -z "$CHROME_BIN_FOUND" ]; then
  for candidate in google-chrome google-chrome-stable chromium chromium-browser; do
    if command -v "$candidate" >/dev/null 2>&1; then
      CHROME_BIN_FOUND="$(command -v "$candidate")"
      break
    fi
  done
fi
if [ -n "$CHROME_BIN_FOUND" ]; then
  echo "chrome:  $CHROME_BIN_FOUND"
else
  echo "chrome:  not installed; Cypress needs Chrome/Chromium and Xvfb locally"
  echo "         (or run Cypress in the Docker image)"
fi

echo
echo "Bootstrap complete. Verify the checkout with:"
echo "  bash scripts/verify-local.sh"
