#!/usr/bin/env bash
set -euo pipefail

# Snapshot WordPress (files + DB) with proper handling of bind mounts vs named volumes.
# WP files are bind-mounted to ./wp_data, DB uses named volume.

PROJECT="${COMPOSE_PROJECT_NAME:-$(basename "$PWD")}"
DB_VOL="${DB_VOL:-${PROJECT}_db_data}"
WP_DATA_DIR="${WP_DATA_DIR:-./wp_data}"
OUT_DIR="backups/$(date +%Y%m%d-%H%M%S)"

ONLINE="${ONLINE:-0}"  # ONLINE=1 will avoid stopping containers (riskier for DB)

echo ">> Project: ${PROJECT}"
echo ">> DB_VOL:  ${DB_VOL}"
echo ">> WP_DATA: ${WP_DATA_DIR}"
echo ">> Output:  ${OUT_DIR}"
mkdir -p "${OUT_DIR}"

if [ "${ONLINE}" != "1" ]; then
  echo ">> Stopping services (safe mode)"
  docker compose stop wordpress db
else
  echo ">> ONLINE=1 (not stopping services) — DB snapshot may be inconsistent"
fi

# Backup WP files (bind mount) - direct tar from host directory
echo ">> Backing up wp_data -> ${OUT_DIR}/wp_data.tar.gz"
if [ -d "${WP_DATA_DIR}" ]; then
  tar czf "${OUT_DIR}/wp_data.tar.gz" -C "${WP_DATA_DIR}" .
else
  echo "!! Warning: WP data directory ${WP_DATA_DIR} not found"
fi

# Backup DB data (named volume) - using Alpine container method
echo ">> Backing up db_data -> ${OUT_DIR}/db_data.tar.gz"
if docker volume inspect "${DB_VOL}" >/dev/null 2>&1; then
  docker run --rm -v "${DB_VOL}":/source -v "$(pwd)/${OUT_DIR}":/backup alpine \
    sh -c 'cd /source && tar czf /backup/db_data.tar.gz .'
else
  echo "!! Warning: DB volume ${DB_VOL} not found"
fi

echo ">> Saving docker compose config"
docker compose config > "${OUT_DIR}/compose.config.yml"

if [ "${ONLINE}" != "1" ]; then
  echo ">> Starting services back"
  docker compose up -d
fi

echo "✅ Backup complete at: ${OUT_DIR}"
