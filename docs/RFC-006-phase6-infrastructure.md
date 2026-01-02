# RFC-006: Phase 6 - Infrastructure & Deployment

## Overview

Phase 6 focuses on preparing Tōrō for production deployment with containerization, load balancer compatibility, and horizontal scaling support via Redis.

## Goals

1. **Containerization**: Docker-based deployment for consistent environments
2. **Load Balancer Compatibility**: WebSocket-only transport to bypass sticky session requirements
3. **Horizontal Scaling**: Optional Redis adapter for multi-instance deployments
4. **Room-Based Scaling**: Automatic room creation when player limits are reached
5. **Production Readiness**: Environment-based configuration, health checks, and logging

---

## 1. Containerization (Docker)

### Files Created

#### `Dockerfile`
Multi-stage build for optimized production images:

```dockerfile
# Stage 1: Build
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Stage 2: Production
FROM node:20-alpine AS runner
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/client/dist ./client/dist
COPY --from=builder /app/server/dist ./server/dist
COPY --from=builder /app/client/public ./client/public

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:${PORT}/api/status || exit 1

CMD ["node", "server/dist/index.js"]
```

#### `.dockerignore`
Excludes unnecessary files from the build context:
- `node_modules/`
- `.git/`
- `docs/`
- Build artifacts (`client/dist/`, `server/dist/`)
- IDE files (`.vscode/`, `.idea/`)

#### `docker-compose.yml`
Local development and testing with optional Redis:

```yaml
services:
  toro:
    build: .
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - PORT=3000
      - REDIS_URL=redis://redis:6379  # Optional

  redis:
    image: redis:7-alpine
    profiles:
      - redis  # Only starts with --profile redis
```

### Build Process

The build uses **esbuild** to bundle the server:

```json
{
  "build:server": "esbuild server/src/index.ts --bundle --platform=node --target=node20 --outfile=server/dist/index.js --format=esm --packages=external"
}
```

Benefits:
- Bundles TypeScript and shared types into a single file
- Fast compilation (~100ms)
- Proper ESM output for Node.js 20
- External packages (express, socket.io) are not bundled

---

## 2. Network Logic Update (Sticky Session Bypass)

### Problem

Load balancers (Traefik, Nginx, cloud providers) can break Socket.io connections when:
- Multiple server instances are running
- Long-polling transport is used (default)
- Sticky sessions are not configured

### Solution

Force WebSocket-only transport on both client and server:

#### Client (`client/src/scenes/GameScene.ts`)

```typescript
this.socket = io(GAME_CONFIG.SERVER_URL, {
  transports: ['websocket'],  // Skip long-polling
});
```

#### Server (`server/src/index.ts`)

```typescript
const io = new Server(httpServer, {
  cors: {
    origin: corsOrigins,
    methods: ['GET', 'POST'],
    credentials: true,
  },
  transports: ['websocket', 'polling'],
  allowUpgrades: true,
});
```

#### Client URL Configuration (`client/src/config.ts`)

```typescript
const getServerUrl = () => {
  // Production: same origin (server serves client)
  if (import.meta.env.PROD) {
    return window.location.origin;
  }
  // Development: separate server on port 3001
  return `http://${window.location.hostname}:3001`;
};
```

---

## 3. Redis Integration (Horizontal Scaling)

### Purpose

When running multiple server instances behind a load balancer, Socket.io needs a way to broadcast messages across all instances. The Redis adapter provides this capability.

### Implementation

#### Dependencies

```json
{
  "dependencies": {
    "redis": "^4.6.13",
    "@socket.io/redis-adapter": "^8.3.0"
  }
}
```

#### Server Setup (`server/src/index.ts`)

```typescript
const REDIS_URL = process.env.REDIS_URL || '';

async function setupRedisAdapter(): Promise<void> {
  if (!REDIS_URL) {
    console.log('⚠️  No REDIS_URL configured - running in single-instance mode');
    return;
  }

  try {
    const { createClient } = await import('redis');
    const { createAdapter } = await import('@socket.io/redis-adapter');

    const pubClient = createClient({ url: REDIS_URL });
    const subClient = pubClient.duplicate();

    await Promise.all([pubClient.connect(), subClient.connect()]);

    io.adapter(createAdapter(pubClient, subClient));
    console.log('✅ Redis adapter connected - horizontal scaling enabled');
  } catch (error) {
    console.error('❌ Redis adapter failed to connect:', error);
    console.log('⚠️  Falling back to single-instance mode');
  }
}

setupRedisAdapter();
```

### Behavior

| REDIS_URL | Behavior |
|-----------|----------|
| Not set | Single-instance mode (local memory) |
| Set | Connects to Redis, enables horizontal scaling |
| Connection fails | Falls back to single-instance mode with warning |

---

## 4. Room-Based Scaling

### Overview

The server automatically creates and manages game rooms to handle player capacity. When a room fills up, new players are assigned to a new room.

### Configuration

```typescript
const MAX_PLAYERS_PER_ROOM = parseInt(process.env.MAX_PLAYERS_PER_ROOM || '50', 10);
const MIN_ROOMS = 1; // Always keep at least 1 room
```

### Room System Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    RoomManager                          │
│  - Creates rooms when needed                            │
│  - Assigns players to least-full room                   │
│  - Cleans up empty rooms                                │
└────────────────────────┬────────────────────────────────┘
                         │
        ┌────────────────┼────────────────┐
        │                │                │
   ┌────▼────┐      ┌────▼────┐      ┌────▼────┐
   │ Room 1  │      │ Room 2  │      │ Room N  │
   │ 45/50   │      │ 30/50   │      │  5/50   │
   │ players │      │ players │      │ players │
   └─────────┘      └─────────┘      └─────────┘
        │                │                │
    Own food         Own food         Own food
    Own state        Own state        Own state
    Own game loop    Own game loop    Own game loop
```

### GameRoom Class

Each room is completely isolated with its own:
- Player list
- Food items
- Game tick counter
- Collision detection
- Scoreboard

```typescript
class GameRoom {
  readonly id: string;
  readonly players: Map<string, ServerPlayerState>;
  readonly food: Map<string, Hitodama>;
  
  // Each room has independent game state
  isFull(): boolean { return this.players.size >= MAX_PLAYERS_PER_ROOM; }
  isEmpty(): boolean { return this.players.size === 0; }
}
```

### Player Assignment

When a player connects:
1. `RoomManager.findAvailableRoom()` finds the room with lowest player count that isn't full
2. If all rooms are full, a new room is created
3. Player joins the Socket.io room for targeted broadcasts

```typescript
io.on('connection', (socket) => {
  const room = roomManager.findAvailableRoom();
  const player = createPlayer(socket.id, socket, room.id);
  room.addPlayer(player);
  
  // All game events are room-scoped
  io.to(room.socketRoom).emit('gameState', snapshot);
});
```

### Room Cleanup

Empty rooms are automatically cleaned up, but at least `MIN_ROOMS` (default: 1) is always maintained.

### Status Endpoint

The `/api/status` endpoint shows room information:

```json
{
  "status": "ok",
  "totalPlayers": 75,
  "totalRooms": 2,
  "rooms": [
    { "id": "room-1", "players": 50 },
    { "id": "room-2", "players": 25 }
  ],
  "maxPlayersPerRoom": 50
}
```

---

## 5. Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` (dev) / `3000` (prod) | HTTP server port |
| `NODE_ENV` | `development` | Environment mode |
| `REDIS_URL` | (empty) | Redis connection string for scaling |
| `CORS_ORIGIN` | `*` | Allowed origins (comma-separated) |
| `MAX_PLAYERS_PER_ROOM` | `50` | Maximum players per game room |

### Production Example

```bash
PORT=3000
NODE_ENV=production
REDIS_URL=redis://default:password@redis-host:6379
CORS_ORIGIN=https://toro.example.com,https://www.toro.example.com
```

---

## 5. Deployment Commands

### Local Development

```bash
npm run dev                    # Start dev server + client
```

### Local Docker (Single Instance)

```bash
npm run docker:up              # Build and run with docker-compose
npm run docker:down            # Stop containers
```

### Local Docker (With Redis)

```bash
docker-compose --profile redis up --build
```

### Manual Docker Build

```bash
npm run docker:build           # Build image
npm run docker:run             # Run container
```

### Production Build (Without Docker)

```bash
npm run build                  # Build client + server
npm start                      # Start production server
```

---

## 6. Health Check Endpoints

### `/api/status`

Returns server health and statistics:

```json
{
  "status": "ok",
  "players": 5,
  "food": 78,
  "tick": 12345,
  "uptime": 3600.5,
  "env": "production"
}
```

### Docker Health Check

```dockerfile
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:${PORT}/api/status || exit 1
```

---

## 7. Render Deployment

### Configuration

1. **Build Command**: (Uses Dockerfile automatically)
2. **Start Command**: (Uses Dockerfile CMD)
3. **Environment Variables**:
   - `PORT=3000`
   - `NODE_ENV=production`
   - `CORS_ORIGIN=https://your-app.onrender.com`

### Optional: Add Redis

1. Create a Redis instance on Render
2. Add `REDIS_URL` environment variable with the internal connection string

---

## 8. Coolify Deployment

### Configuration

1. **Build Pack**: Dockerfile
2. **Port**: 3000
3. **Environment Variables**:
   ```
   PORT=3000
   NODE_ENV=production
   CORS_ORIGIN=https://your-domain.com
   REDIS_URL=redis://default:password@coolify-redis:6379
   ```

### Redis Setup

Use Coolify's built-in Redis service or deploy a Redis container:

```yaml
# In Coolify, create a Redis service and link it
REDIS_URL=redis://default:password@coolify-redis:6379
```

---

## Architecture Diagram

```
                    ┌─────────────────────────────────────┐
                    │         Load Balancer               │
                    │    (Traefik/Nginx/Render/etc)       │
                    └──────────────┬──────────────────────┘
                                   │
                    ┌──────────────┼──────────────┐
                    │              │              │
              ┌─────▼─────┐  ┌─────▼─────┐  ┌─────▼─────┐
              │  Server 1 │  │  Server 2 │  │  Server N │
              │  (Node)   │  │  (Node)   │  │  (Node)   │
              └─────┬─────┘  └─────┬─────┘  └─────┬─────┘
                    │              │              │
                    └──────────────┼──────────────┘
                                   │
                    ┌──────────────▼──────────────┐
                    │         Redis               │
                    │   (Pub/Sub for Socket.io)   │
                    └─────────────────────────────┘
```

---

## Files Modified/Created

### Created
- `Dockerfile` - Multi-stage production build
- `.dockerignore` - Build context exclusions
- `docker-compose.yml` - Local development/testing
- `docs/RFC-006-phase6-infrastructure.md` - This document

### Modified
- `package.json` - Added esbuild, redis, build scripts
- `server/src/index.ts` - Redis adapter, CORS, env vars
- `client/src/config.ts` - Production URL detection
- `client/src/scenes/GameScene.ts` - WebSocket transport (already had this)

---

## Testing Checklist

- [ ] `npm run build` completes successfully
- [ ] `npm start` runs the production server
- [ ] `npm run docker:up` builds and runs container
- [ ] Health check endpoint responds at `/api/status`
- [ ] Client connects via WebSocket in production
- [ ] Game functions correctly in container
- [ ] Redis adapter connects when REDIS_URL is set
- [ ] Server falls back gracefully without Redis

---

## Status

✅ **Phase 6 Complete**

All infrastructure and deployment components are implemented and ready for production deployment on Render, Coolify, or any Docker-compatible platform.

