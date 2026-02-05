# ============================================================
# Murkl — Production Dockerfile
# Single service: Express relayer serves API + static frontend
# ============================================================

# ---- Build frontend ----
FROM node:20-slim AS frontend-builder

WORKDIR /build/web
COPY web/package.json web/package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi
COPY web/ ./
RUN npm run build

# ---- Build relayer ----
FROM node:20-slim AS relayer-builder

WORKDIR /build/relayer

# better-sqlite3 needs build tools for native addon
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

COPY relayer/package.json relayer/package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi
COPY relayer/tsconfig.json ./
COPY relayer/src ./src
RUN npm run build

# ---- Production ----
FROM node:20-slim

WORKDIR /app/relayer

# better-sqlite3 native addon
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

# Install production deps
COPY relayer/package.json relayer/package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi && rm -rf /root/.npm

# Copy built relayer → /app/relayer/dist/
COPY --from=relayer-builder /build/relayer/dist ./dist

# Copy built frontend → /app/web/dist/
# Relayer resolves: path.join(__dirname, '../..', 'web', 'dist')
#   __dirname = /app/relayer/dist → ../../ = /app → web/dist = /app/web/dist ✓
COPY --from=frontend-builder /build/web/dist /app/web/dist

ENV NODE_ENV=production
ENV PORT=3001

EXPOSE 3001

CMD ["node", "dist/index.js"]
