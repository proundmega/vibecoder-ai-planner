#!/bin/bash
set -euo pipefail

if [ -f .env.local ]; then
  sudo docker compose --env-file .env.local \
    -f docker-compose.yml -f docker-compose.override.yml up --build
else
  sudo docker compose \
    -f docker-compose.yml -f docker-compose.override.yml up --build
fi
