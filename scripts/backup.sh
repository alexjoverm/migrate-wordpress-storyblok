#!/usr/bin/env bash
set -euo pipefail

# Snapshot WordPress (files + DB) by tarring Docker named volumes.
# Default assumes Compose default volume names: <project>_wp_data and <project>_db_data.
# Override via env: WP_VOL=... DB_VOL=... COMPOSE_PROJECT_NAME=...

PROJECT="${COMPOSE_PROJECT_NAME:-$(basename "$PWD")}"
WP_VOL="${WP_VOL:-${PROJECT}_wp_data}"
DB_VOL="${DB_VOL:-${PROJECT}_db_data}"
OUT_DIR="backups/$(date +%Y%m%d-%H%M%S)"

ONLINE="${ONLINE:-0}"  # ONLINE=1 will avoid stopping containers (riskier for DB)

echo ">> Project: ${PROJECT}"
echo ">> WP_VOL:  ${WP_VOL}"
echo ">> DB_VOL:  ${DB_VOL}"
echo ">> Output:  ${OUT_DIR}"
mkdir -p "${OUT_DIR}"

if [ "${ONLINE}" != "1" ]; then
  echo ">> Stopping services (safe mode)"
  docker compose stop wordpress db
else
  echo ">> ONLINE=1 (not stopping services) — DB snapshot may be inconsistent"
fi

echo ">> Backing up wp_data -> ${OUT_DIR}/wp_data.tar.gz"
docker run --rm -v "${WP_VOL}":/source -v "$(pwd)/${OUT_DIR}":/backup alpine \
  sh -c 'cd /source && tar czf /backup/wp_data.tar.gz .'

echo ">> Backing up db_data -> ${OUT_DIR}/db_data.tar.gz"
docker run --rm -v "${DB_VOL}":/source -v "$(pwd)/${OUT_DIR}":/backup alpine \
  sh -c 'cd /source && tar czf /backup/db_data.tar.gz .'

echo ">> Saving docker compose config"
docker compose config > "${OUT_DIR}/compose.config.yml"

if [ "${ONLINE}" != "1" ]; then
  echo ">> Starting services back"
  docker compose up -d
fi

echo "✅ Backup complete at: ${OUT_DIR}"
