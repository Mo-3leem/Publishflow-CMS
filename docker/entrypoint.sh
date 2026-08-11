#!/bin/sh
# PublishFlow container entrypoint.
#
#   1. validate the environment,
#   2. run pending migrations exactly once, failing loudly if they do not apply,
#   3. hand over to the Next.js server.
#
# Seeding is deliberately NOT run here: a production restart must never
# overwrite real content. Seed explicitly with `docker compose run --rm app
# node docker/seed.mjs` on a fresh deployment.

set -eu

fail() {
  echo "[entrypoint] $1" >&2
  exit 1
}

echo "[entrypoint] starting PublishFlow"

# --- 1. environment ---------------------------------------------------------
PLACEHOLDER="replace-with-at-least-32-random-bytes"

for name in SESSION_SECRET CSRF_SECRET VIEWER_HASH_SECRET SCHEDULE_JOB_SECRET; do
  eval "value=\${$name:-}"
  [ -n "$value" ] || fail "$name is not set. Generate one with: openssl rand -hex 32"
  [ "$value" != "$PLACEHOLDER" ] || fail "$name still holds the placeholder value from .env.example."
  [ "${#value}" -ge 32 ] || fail "$name must be at least 32 characters."
done

[ -n "${APP_URL:-}" ] || fail "APP_URL is not set."

# --- 2. writable volumes ----------------------------------------------------
mkdir -p "$(dirname "${DATABASE_PATH:-/app/data/publishflow.db}")" "${UPLOAD_DIR:-/app/uploads}"

[ -w "$(dirname "${DATABASE_PATH:-/app/data/publishflow.db}")" ] \
  || fail "The data directory is not writable. Check the volume ownership (the container runs as uid 1000)."

# --- 3. migrations ----------------------------------------------------------
echo "[entrypoint] applying database migrations"
node /app/docker/migrate.mjs || fail "Migrations failed; refusing to start with an unknown schema."

# --- 4. run -----------------------------------------------------------------
echo "[entrypoint] migrations complete, starting the server"
exec "$@"
