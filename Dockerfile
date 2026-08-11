# syntax=docker/dockerfile:1

# PublishFlow CMS — multi-stage build producing a small, non-root runtime image.
#
# Native modules (better-sqlite3, argon2, sharp) are compiled/downloaded in the
# deps stage only. The runtime stage carries the Next.js standalone server plus
# just those native packages, so no compiler toolchain ships to production.

ARG NODE_VERSION=24-bookworm-slim

# ---------------------------------------------------------------------------
# 1. Dependencies — full install, including native builds.
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS deps
WORKDIR /app

# python3/make/g++ are needed only if a prebuilt binary is unavailable for the
# platform; they never reach the runtime image.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# ---------------------------------------------------------------------------
# 2. Build — compile the Next.js application.
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS builder
WORKDIR /app

RUN corepack enable

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Placeholder values so the build-time environment validation passes; the real
# secrets are supplied at runtime and are never baked into the image.
ENV NEXT_TELEMETRY_DISABLED=1 \
    NODE_ENV=production \
    APP_URL=http://localhost:3000 \
    SESSION_SECRET=build-time-placeholder-secret-value-0123456789 \
    CSRF_SECRET=build-time-placeholder-secret-value-0123456789 \
    VIEWER_HASH_SECRET=build-time-placeholder-secret-value-0123456789 \
    SCHEDULE_JOB_SECRET=build-time-placeholder-secret-value-0123456789

RUN pnpm build

# ---------------------------------------------------------------------------
# 3. Runtime — standalone server, non-root, no build tools.
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    DATABASE_PATH=/app/data/publishflow.db \
    UPLOAD_DIR=/app/uploads

RUN apt-get update \
    && apt-get install -y --no-install-recommends sqlite3 tini ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# `node` (uid 1000) ships with the base image; run as it rather than root.
RUN mkdir -p /app/data /app/uploads /app/backups \
    && chown -R node:node /app

# The standalone bundle contains the server and its traced dependencies.
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static

# Migrations and the runtime scripts the entrypoint needs.
COPY --from=builder --chown=node:node /app/drizzle ./drizzle
COPY --from=builder --chown=node:node /app/scripts ./scripts

# tsx is a dev-only tool and is deliberately absent here, so the migration
# runner is plain JavaScript that uses the same better-sqlite3 copy the
# standalone bundle already traced.
COPY --chown=node:node docker/ ./docker/
RUN chmod +x ./docker/entrypoint.sh

USER node

EXPOSE 3000

VOLUME ["/app/data", "/app/uploads", "/app/backups"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/v1/health').then(r=>r.json()).then(b=>process.exit(b.status==='ok'?0:1)).catch(()=>process.exit(1))"

# tini reaps zombies and forwards signals so the container stops cleanly.
ENTRYPOINT ["/usr/bin/tini", "--", "./docker/entrypoint.sh"]
CMD ["node", "server.js"]
