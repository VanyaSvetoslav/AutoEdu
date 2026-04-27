# --- builder ---
FROM node:22-bookworm-slim AS builder
WORKDIR /app

# Native build deps for better-sqlite3
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Optional: override the npm registry at build time when registry.npmjs.org
# is slow/blocked from your network (e.g. running build inside Russia).
# Examples: https://registry.npmmirror.com, https://npm.pkg.github.com.
ARG NPM_REGISTRY=https://registry.npmjs.org
# Optional: pass through HTTP(S) proxy at build time if needed for `npm ci`.
# (Note: npm does NOT support socks proxies; use http(s)://… here.)
ARG HTTP_PROXY=
ARG HTTPS_PROXY=
ENV HTTP_PROXY=${HTTP_PROXY} HTTPS_PROXY=${HTTPS_PROXY}

COPY package.json package-lock.json ./
RUN npm config set registry "$NPM_REGISTRY" \
 && npm ci --prefer-offline --no-audit --fund=false --no-progress

COPY tsconfig.json ./
COPY src ./src
RUN npm run build \
 && npm prune --omit=dev

# --- runtime ---
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Default DB_PATH points at the Railway/Docker volume mount.
ENV DB_PATH=/data/autoedu.sqlite

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package.json ./

# /data is expected to be mounted as a Railway/Docker volume in production.
# (Do not use the VOLUME keyword — Railway forbids it; the mount is configured in the Railway UI.)
RUN mkdir -p /data && chown -R node:node /data /app

USER node
CMD ["node", "dist/index.js"]
