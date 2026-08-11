#!/usr/bin/env bash
# Consistent SQLite backup.
#
# Uses SQLite's own `.backup` command rather than copying the file. A plain `cp`
# of a live WAL-mode database can capture a torn page or miss committed data
# still sitting in the -wal file; `.backup` takes a proper snapshot while other
# connections keep working.
#
#   ./scripts/backup-db.sh                    # back up ./data/publishflow.db
#   DATABASE_PATH=/app/data/x.db ./scripts/backup-db.sh
#   docker compose exec app ./scripts/backup-db.sh

set -euo pipefail

DATABASE_PATH="${DATABASE_PATH:-./data/publishflow.db}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"

if [ ! -f "$DATABASE_PATH" ]; then
  echo "error: no database at $DATABASE_PATH" >&2
  exit 1
fi

if ! command -v sqlite3 >/dev/null 2>&1; then
  echo "error: sqlite3 is not installed (apt-get install sqlite3)." >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"

timestamp="$(date -u +%Y%m%d-%H%M%S)"
target="${BACKUP_DIR}/publishflow-${timestamp}.db"

echo "Backing up $DATABASE_PATH → $target"
sqlite3 "$DATABASE_PATH" ".backup '${target}'"

# Verify the snapshot before trusting it.
if [ "$(sqlite3 "$target" 'PRAGMA quick_check;')" != "ok" ]; then
  echo "error: the backup failed its integrity check; keeping it for inspection." >&2
  exit 1
fi

gzip -f "$target"
echo "Backup complete: ${target}.gz"

# Prune old snapshots.
if [ "$RETENTION_DAYS" -gt 0 ]; then
  removed="$(find "$BACKUP_DIR" -name 'publishflow-*.db.gz' -type f -mtime "+${RETENTION_DAYS}" -print -delete | wc -l)"
  [ "$removed" -gt 0 ] && echo "Pruned $removed snapshot(s) older than ${RETENTION_DAYS} days."
fi

echo
echo "To restore:"
echo "  1. stop the application (docker compose stop app)"
echo "  2. gunzip -c ${target}.gz > ${DATABASE_PATH}"
echo "  3. rm -f ${DATABASE_PATH}-wal ${DATABASE_PATH}-shm"
echo "  4. start it again (docker compose start app)"
