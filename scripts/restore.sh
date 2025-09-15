#!/usr/bin/env bash
set -euo pipefail

# Restore WordPress from a backup created by backup.sh
# Handles bind mounts (WP files) and named volumes (DB) correctly.
# Usage: ./restore.sh backups/20250908-123456

if [ $# -ne 1 ]; then
  echo "Usage: $0 <backup-folder>"
  echo "Example: $0 backups/20250908-123456"
  exit 1
fi

SRC_DIR="$1"
[ -f "${SRC_DIR}/wp_data.tar.gz" ] || { echo "Missing ${SRC_DIR}/wp_data.tar.gz"; exit 1; }
[ -f "${SRC_DIR}/db_data.tar.gz" ] || { echo "Missing ${SRC_DIR}/db_data.tar.gz"; exit 1; }

PROJECT="${COMPOSE_PROJECT_NAME:-$(basename "$PWD")}"
DB_VOL="${DB_VOL:-${PROJECT}_db_data}"
WP_DATA_DIR="${WP_DATA_DIR:-./wp_data}"

echo ">> Project: ${PROJECT}"
echo ">> DB_VOL:  ${DB_VOL}"
echo ">> WP_DATA: ${WP_DATA_DIR}"
echo ">> Source:  ${SRC_DIR}"

echo ">> Bringing stack down"
docker compose down

# Clean up existing data
echo ">> Removing existing data"
docker volume rm "${DB_VOL}" >/dev/null 2>&1 || true
if [ -d "${WP_DATA_DIR}" ]; then
  echo ">> Backing up existing wp_data to wp_data.backup.$(date +%s)"
  mv "${WP_DATA_DIR}" "${WP_DATA_DIR}.backup.$(date +%s)" || {
    echo "!! Cannot backup existing wp_data, removing it"
    rm -rf "${WP_DATA_DIR}"
  }
fi

# Recreate clean directories/volumes
echo ">> Creating fresh directories and volumes"
mkdir -p "${WP_DATA_DIR}"
docker volume create "${DB_VOL}" >/dev/null

# Restore WP files (bind mount) - direct extraction to host directory
echo ">> Restoring wp_data -> ${WP_DATA_DIR}"
tar xzf "${SRC_DIR}/wp_data.tar.gz" -C "${WP_DATA_DIR}"

# Restore DB data (named volume) - using Alpine container method
echo ">> Restoring db_data -> ${DB_VOL}"
docker run --rm -v "${DB_VOL}":/dest -v "$(pwd)/${SRC_DIR}":/backup alpine \
  sh -c 'cd /dest && tar xzf /backup/db_data.tar.gz'

echo ">> Starting stack"
docker compose up -d

# Wait for containers to be ready
echo ">> Waiting for services to be ready..."
sleep 5

echo ">> Normalizing WordPress file permissions"
# Fix ownership and permissions for WordPress files
if [ -d "${WP_DATA_DIR}" ]; then
  # Set proper ownership (33 is www-data user ID)
  sudo chown -R 33:33 "${WP_DATA_DIR}" 2>/dev/null || {
    echo "!! Cannot set ownership (sudo required), trying container method"
    docker compose exec --user root wordpress sh -c '\
      chown -R www-data:www-data /var/www/html && \
      find /var/www/html -type d -exec chmod 755 {} \; && \
      find /var/www/html -type f -exec chmod 644 {} \;' 2>/dev/null || {
      echo "!! Could not fix permissions, WordPress might have issues writing files"
    }
  }
  
  # Set proper file permissions
  find "${WP_DATA_DIR}" -type d -exec chmod 755 {} \; 2>/dev/null || true
  find "${WP_DATA_DIR}" -type f -exec chmod 644 {} \; 2>/dev/null || true
  
  # WordPress config should be writable
  [ -f "${WP_DATA_DIR}/wp-config.php" ] && chmod 644 "${WP_DATA_DIR}/wp-config.php"
fi

echo "✅ Restore complete!"
echo "   Visit http://localhost:8080 to verify your site is working"
echo "   If you see permission errors, run: sudo chown -R 33:33 ${WP_DATA_DIR}"
