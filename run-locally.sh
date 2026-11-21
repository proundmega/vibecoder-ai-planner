#!/bin/bash
set -euo pipefail

if [ ! -f .env.local ]; then
  if [ ! -f .env.example ]; then
    echo "error: .env.local and .env.example are both missing" >&2
    exit 1
  fi
  cp .env.example .env.local
  echo "Created .env.local from .env.example; edit it if you need non-default secrets."
fi

COMPOSE=(docker compose --env-file .env.local -f docker-compose.yml -f docker-compose.override.yml up --build)

if docker info >/dev/null 2>&1; then
  "${COMPOSE[@]}"
elif command -v sudo >/dev/null 2>&1 && sudo -n docker info >/dev/null 2>&1; then
  sudo "${COMPOSE[@]}"
else
  echo "error: Docker is not accessible to ${USER:-this user}." >&2
  echo "Add the user to the docker group and log out/in, or run with passwordless sudo." >&2
  exit 1
fi
