#!/usr/bin/env bash
set -euo pipefail

# Restore WordPress from a volume snapshot created by backup.sh
# Usage: ./restore.sh backups/20250908-123456
# Override volumes via env: WP_VOL=... DB_VOL=... COMPOSE_PROJECT_NAME=...

if [ $# -ne 1 ]; then
  echo "Usage: $0 <backup-folder>"
  echo "Example: $0 backups/20250908-123456"
  exit 1
fi

SRC_DIR="$1"
[ -f "${SRC_DIR}/wp_data.tar.gz" ] || { echo "Missing ${SRC_DIR}/wp_data.tar.gz"; exit 1; }
[ -f "${SRC_DIR}/db_data.tar.gz" ] || { echo "Missing ${SRC_DIR}/db_data.tar.gz"; exit 1; }

PROJECT="${COMPOSE_PROJECT_NAME:-$(basename "$PWD")}"
WP_VOL="${WP_VOL:-${PROJECT}_wp_data}"
DB_VOL="${DB_VOL:-${PROJECT}_db_data}"

echo ">> Project: ${PROJECT}"
echo ">> WP_VOL:  ${WP_VOL}"
echo ">> DB_VOL:  ${DB_VOL}"
echo ">> Source:  ${SRC_DIR}"

echo ">> Bringing stack down"
docker compose down

echo ">> Recreating empty volumes"
docker volume rm "${WP_VOL}" >/dev/null 2>&1 || true
docker volume rm "${DB_VOL}" >/dev/null 2>&1 || true
docker volume create "${WP_VOL}" >/dev/null
docker volume create "${DB_VOL}" >/dev/null

echo ">> Restoring wp_data"
docker run --rm -v "${WP_VOL}":/dest -v "$(pwd)/${SRC_DIR}":/backup alpine \
  sh -c 'cd /dest && tar xzf /backup/wp_data.tar.gz'

echo ">> Restoring db_data"
docker run --rm -v "${DB_VOL}":/dest -v "$(pwd)/${SRC_DIR}":/backup alpine \
  sh -c 'cd /dest && tar xzf /backup/db_data.tar.gz'

echo ">> Starting stack"
docker compose up -d

echo ">> Normalizing permissions (optional but recommended)"
docker compose exec --user root wordpress sh -lc '\
  chown -R www-data:www-data /var/www/html && \
  find /var/www/html -type d -exec chmod 755 {} \; && \
  find /var/www/html -type f -exec chmod 644 {} \;'

echo "✅ Restore complete. Visit your site to verify."
