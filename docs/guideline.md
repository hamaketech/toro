# PROJECT: Tōrō (The River of Souls) - Development Guidelines

## 1. Project Context & Vision
* **Genre:** Multiplayer .io Survival / Action
* **Theme:** "Obon Festival" (Japanese Folklore). Relaxing visual atmosphere mixed with high-tension survival.
* **Core Loop:** Collect souls (growth) -> Lengthen your procession -> Cut off enemies to destroy them -> Absorb their collection.
* **Visual Style:** 2D, Top-down. Dark background (River/Abyss), Glowing lights, Soft bloom effects, Floating motion.

## 2. Tech Stack (Strict Enforcement)
* **Language:** TypeScript (Strict typing enabled).
* **Client Engine:** Phaser 3 (Arcade Physics).
* **Server:** Node.js + Socket.io (Geckos.io is an alternative if UDP is needed later, stick to TCP/Socket.io for MVP).
* **Bundler:** Vite.
* **State Management:** Snapshot Interpolation (Server sends state @ 20-30hz, Client interpolates for smoothness).

## 3. Game Design Specifications (The "Rules of Reality")

### A. The Player (The Lantern)
* **Head:** The "Lantern" is the hitbox for death.
* **Body:** The "Procession" (Spirits) follows the head.
* **Movement Physics:** * NOT grid-based.
    * Floaty/Boat-like inertia.
    * Rotation speed is limited (cannot turn 180 instantly).
    * Mouse distance determines speed (Slow drift vs Fast movement).

### B. Mechanics
1.  **Collection:** * Small pellets ("Hitodama") increase score + length.
    * Pellets have a slight magnetic pull toward the Lantern.
2.  **Combat (The Kill):**
    * IF [My Lantern] touches [Enemy Procession] -> I die.
    * IF [My Lantern] touches [World Border] -> I die.
    * Head-to-Head collision -> Both die (or smaller one dies, depending on balance testing).
3.  **Death Consequence:**
    * Player entity is removed.
    * All collected souls in the "Body" are dropped as high-value pellets at the location of death.
4.  **Boost (Sprint):**
    * Holding `Space` or `Left Click` increases speed by 50%.
    * **Cost:** While boosting, the player drops mass (shrinks) rapidly, leaving a trail of pellets behind.
5.  **Fog of War:**
    * The player can only see a radius around their Lantern.
    * The radius *shrinks* slightly as the player gets massive (Simulating "Tunnel Vision" or "Corrupted Sight").

### C. Classes (Variables)
* **Paper Guide (Default):** Balanced stats.
* **Kitsune (Speed):** +20% Base Speed, -30% Turn Radius.
* **Stone Toro (Tank):** -20% Speed, Collision cooldown (1 hit shield).

## 4. Coding Standards & Conventions
* **Architecture:** Use a Component-based structure or Phaser's Scene management.
* **Variables:** `camelCase` for variables/functions, `PascalCase` for Classes/Components.
* **Multiplayer Logic:** * *Server Authority:* The server calculates positions and collisions.
    * *Client Prediction:* Client moves instantly visually, then corrects if server disagrees.
* **Assets:** Use placeholder colored circles/squares for now. Do not wait for art assets to code logic.

## 5. Implementation Phases (Roadmap)
*Use these phases to prompt Cursor. Do not skip ahead.*

**Phase 1: The Skeleton**
* Setup Vite + Phaser + Socket.io boilerplate.
* Get a "Circle" moving on the screen with mouse input (Client side).
* Connect Client to Server (Basic Handshake).

**Phase 2: Multiplayer Movement**
* Send input to Server -> Server updates position -> Broadcast to all Clients.
* Implement "Snapshot Interpolation" so movement looks smooth, not laggy.

**Phase 3: The Snake Logic (The Hard Part)**
* Implement the "Body" array.
* Logic for body segments to follow the head (History trail buffering).
* Spawn "Food" on the server and sync to clients.
* Eating food = Grow body.

**Phase 4: Combat & Collision**
* Server-side collision detection (Head vs Body).
* Death state handling (Explosion of food).
* Scoreboard.

**Phase 5: Juice & Polish**
* Name selection screen before joining
* Add Glow/Bloom shaders.

**Phase 6: Infrastructure & Deployment** ✅
*Focus: Preparing the application for containerized deployment with Redis support.*
*See: `docs/RFC-006-phase6-infrastructure.md` for full details.*

**1. Containerization (Docker)** ✅
* `Dockerfile` - Multi-stage build with node:20-alpine
* `.dockerignore` - Excludes node_modules, .git, docs
* `docker-compose.yml` - Local testing with optional Redis
* Build uses `esbuild` for fast TypeScript bundling

**2. Network Logic Update (Sticky Session Bypass)** ✅
* Client: `transports: ['websocket']` in socket connection
* Server: Configurable CORS via `CORS_ORIGIN` env var
* Client auto-detects production URL (same origin)

**3. Redis Integration (Horizontal Scaling)** ✅
* Dependencies: `redis`, `@socket.io/redis-adapter`
* Server checks `REDIS_URL` env var on startup
* Falls back to single-instance mode if Redis unavailable
* Enables broadcasting across multiple server instances

**4. Environment Variables**
| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3001/3000 | Server port |
| `NODE_ENV` | development | Environment |
| `REDIS_URL` | (empty) | Redis connection for scaling |
| `CORS_ORIGIN` | * | Allowed origins |

**5. Deployment Commands**
```bash
npm run dev          # Development
npm run build        # Build for production
npm start            # Run production server
npm run docker:up    # Docker (single instance)
docker-compose --profile redis up --build  # With Redis
```