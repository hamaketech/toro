# ==============================================================================
# Tōrō - Multi-stage Dockerfile for Production
# ==============================================================================

# Stage 1: Build
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files first for better caching
COPY package*.json ./

# Install all dependencies (including devDependencies for build)
RUN npm ci

# Copy TypeScript configs
COPY tsconfig.base.json ./
COPY client/tsconfig.json ./client/
COPY client/vite.config.ts ./client/

# Copy source code
COPY shared/ ./shared/
COPY client/ ./client/
COPY server/ ./server/

# Build client (Vite) and server (esbuild)
RUN npm run build

# Verify build outputs exist
RUN ls -la client/dist/ && ls -la server/dist/

# ==============================================================================
# Stage 2: Production Runtime
# ==============================================================================
FROM node:20-alpine AS runner

WORKDIR /app

# Install production dependencies only
COPY package*.json ./
RUN npm ci --omit=dev

# Copy built artifacts from builder stage
COPY --from=builder /app/client/dist ./client/dist
COPY --from=builder /app/server/dist ./server/dist

# Copy public assets (SVGs, etc.)
COPY --from=builder /app/client/public ./client/public

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000

# Expose the port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:${PORT}/api/status || exit 1

# Start the server
CMD ["node", "server/dist/index.js"]

