# Vazhikara Aatam — single-service production image.
#
# The engine ships TS source (no compile step) and the server runs it directly
# via tsx at runtime — see DEPLOY.md and the Decisions log in PLAN.md for why.
# This image just needs: install deps, build the web frontend, run the server,
# which then serves that built frontend + Socket.IO on one port.
FROM node:22-slim

WORKDIR /app

# Corepack ships with Node 22 and pins pnpm to the version in package.json's
# "packageManager" field. Prepare it in its own cached layer so a registry
# failure surfaces at a clear step, not mid-install.
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare pnpm@10.12.4 --activate

# Copy manifests first so dependency install is cached across source-only changes.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/engine/package.json packages/engine/package.json
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json

RUN pnpm install --frozen-lockfile

# Now the rest of the source.
COPY . .

# Builds apps/web (tsc + vite build) into apps/web/dist, which the server
# discovers automatically at runtime (see resolveWebDist in apps/server/src/server.ts).
RUN pnpm build

ENV NODE_ENV=production
EXPOSE 3001

# Run the tsx shim directly instead of nesting pnpm → pnpm → tsx: pnpm as
# PID 1 does not forward SIGTERM down that chain, so every deploy/scale-down
# would wait out the platform's kill grace period. The shim exec's node, so
# node ends up as PID 1 with clean signal handling.
CMD ["apps/server/node_modules/.bin/tsx", "apps/server/src/index.ts"]
