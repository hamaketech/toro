# Tōrō - The River of Souls

> A multiplayer .io survival game inspired by Japanese folklore

**Live:** https://toro-b5mm.onrender.com

---

## Game Overview

### Theme & Aesthetic
- **Setting:** The River of Souls during Obon Festival
- **Visual Style:** Dark ethereal atmosphere with glowing spirits
- **Mood:** Relaxing visuals with high-tension survival gameplay

### Core Gameplay Loop
1. **Collect** floating souls (Hitodama/ghosts) to grow your procession
2. **Navigate** the river, avoiding other players' bodies
3. **Hunt** other players by cutting them off with your body
4. **Survive** - if your lantern touches another player's body, you die
5. **Dominate** - absorb the souls dropped by defeated players

---

## How It Works

### Player (The Lantern)

| Component | Description |
|-----------|-------------|
| **Head (Lantern)** | Your hitbox - if it touches an enemy body, you die |
| **Body (Procession)** | Trail of spirits following your lantern |
| **Size** | Grows with each soul collected, lantern scales up slightly |

### Movement

- **Desktop:** Mouse position determines direction, distance from player controls speed
- **Mobile:** Touch position determines direction and speed
- **Physics:** Smooth, floaty movement with momentum (boat-like inertia)
- **Turn Rate:** Limited - you cannot instantly reverse direction

### Controls

| Platform | Move | Boost |
|----------|------|-------|
| Desktop | Mouse position | Hold Space or Left Click |
| Mobile | Touch & drag | Dedicated boost button (bottom-right) |

### Boost Mechanic
- **Speed:** +50% movement speed while active
- **Cost:** Drops souls behind you (shrinks your body)
- **Use:** Escaping danger, chasing prey, strategic positioning

### Food System

| Type | Color | Value | Spawn |
|------|-------|-------|-------|
| Normal Ghost | Cyan/Teal | 1 soul | Natural spawn |
| Golden Ghost | Orange/Gold | 3-4 souls | Death drops (~30%) |

- Food has **magnetic pull** toward nearby players (larger players = stronger pull)
- Golden food is **larger**, **brighter**, and always **animated**

### Death & Drops

When you die:
1. Your lantern disappears
2. All body segments drop as food at death location
3. ~70% drop as normal ghosts (1 soul)
4. ~30% drop as golden ghosts (3-4 souls)
5. You respawn with a new name/session

### Collision Rules

| Scenario | Result |
|----------|--------|
| Your head → Enemy body | **You die** |
| Your head → World border | **You die** |
| Head vs Head (same size) | **Both die** |
| Head vs Head (different) | **Smaller dies** |

---

## Technical Architecture

### Stack

| Layer | Technology |
|-------|------------|
| Client | Phaser 3 + TypeScript + Vite |
| Server | Node.js + Express + Socket.io |
| Transport | WebSocket (no long-polling) |
| Build | esbuild (server), Vite (client) |
| Deploy | Docker → Render |

### Network Model

```
┌─────────────┐     Input (20hz)      ┌─────────────┐
│   Client    │ ───────────────────→  │   Server    │
│  (Phaser)   │                       │  (Node.js)  │
│             │  ←───────────────────  │             │
└─────────────┘    Game State (20hz)  └─────────────┘
```

- **Server Authoritative:** Server calculates all positions and collisions
- **Snapshot Interpolation:** Client smoothly interpolates between server states
- **No Client Prediction:** Avoids jitter/desync issues on mobile

### Room System

```
┌──────────────────────────────────────────────┐
│              Room Manager                     │
│  • Auto-creates rooms when full              │
│  • Supports room codes for friends           │
│  • Cleans up empty rooms                     │
└──────────────────────────────────────────────┘
         │
    ┌────┴────┬────────────┐
    ▼         ▼            ▼
┌────────┐ ┌────────┐ ┌────────┐
│FIRE-42 │ │MOON-17 │ │STAR-99 │
│ 8/10   │ │ 5/10   │ │ 2/10   │
└────────┘ └────────┘ └────────┘
```

- Max 10 players per room (configurable)
- Each room has isolated game state
- Share room via URL: `?room=FIRE-42`

### Performance Optimizations

#### Server
| Optimization | Impact |
|--------------|--------|
| Spatial Grid | O(n) collision instead of O(n²) |
| Squared Distance | Avoids expensive sqrt() |
| Set-based Death | O(1) lookup for dead players |

#### Client
| Optimization | Impact |
|--------------|--------|
| Body LOD | Max 150 visual segments (handles 1000+ souls) |
| Food Culling | Only renders food in viewport |
| Animation Distance | Static food beyond 600px |
| Golden Priority | Always animates valuable food |

---

## Project Structure

```
toro/
├── client/
│   ├── src/
│   │   ├── scenes/
│   │   │   ├── MainMenuScene.ts    # Name entry, room code
│   │   │   └── GameScene.ts        # Main game rendering
│   │   ├── network/
│   │   │   ├── SnapshotInterpolation.ts
│   │   │   └── ClientPrediction.ts
│   │   ├── config.ts               # Game constants
│   │   └── main.ts                 # Entry point
│   └── public/
│       └── assets/                 # SVG sprites
├── server/
│   └── src/
│       └── index.ts                # Game server + room logic
├── shared/
│   └── types.ts                    # Shared TypeScript types
├── docs/
│   └── RFC-*.md                    # Technical documentation
├── Dockerfile
├── docker-compose.yml
└── package.json
```

---

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3001 (dev) / 3000 (prod) | Server port |
| `NODE_ENV` | development | Environment mode |
| `CORS_ORIGIN` | * | Allowed origins |
| `MAX_PLAYERS_PER_ROOM` | 10 | Players per room |

### Game Constants (server/client)

| Constant | Value | Description |
|----------|-------|-------------|
| World Size | 6000 x 6000 | Play area dimensions |
| Tick Rate | 20 Hz | Server update frequency |
| Food Count | ~150 | Target food on map |
| Base Speed | 200 | Player movement speed |
| Boost Multiplier | 1.5x | Speed while boosting |
| Magnet Radius | 150-300 | Food attraction range |

---

## Development

### Commands

```bash
# Development (hot reload)
npm run dev

# Production build
npm run build
npm start

# Docker
npm run docker:up      # Build & run
npm run docker:down    # Stop
```

### Local URLs

| Service | URL |
|---------|-----|
| Client (dev) | http://localhost:5173 |
| Server (dev) | http://localhost:3001 |
| Docker | http://localhost:3000 |

---

## Deployment (Render)

### Setup

1. Create **Web Service** → Connect GitHub repo
2. Runtime: **Docker**
3. Region: **Oregon** (or closest)

### Environment Variables

```
PORT=3000
NODE_ENV=production
CORS_ORIGIN=https://your-app.onrender.com
MAX_PLAYERS_PER_ROOM=10
```

### Health Check

```bash
curl https://toro-b5mm.onrender.com/api/status
```

Returns:
```json
{
  "status": "ok",
  "totalPlayers": 5,
  "totalRooms": 1,
  "tick": 12345,
  "uptime": 3600
}
```

---

## Visual Assets

| Asset | File | Description |
|-------|------|-------------|
| Lantern | `lantern.svg` | Local player head |
| Devil Mask | `devil-mask.svg` | Other player heads |
| Ghost | `ghost.svg` | Food (Hitodama) |

All assets use **SVG** for crisp scaling. Colors are applied via Phaser tints.

---

## Implementation Status

| Phase | Status | Description |
|-------|--------|-------------|
| 1. Foundation | ✅ | Phaser + Socket.io setup |
| 2. Multiplayer | ✅ | Server-authoritative movement |
| 3. Snake Logic | ✅ | Body segments, food collection |
| 4. Combat | ✅ | Collisions, death, scoreboard |
| 5. Polish | ✅ | Menu, glow effects, mobile |
| 6. Infrastructure | ✅ | Docker, Render, performance |
| 7. Optimization | 🚧 | Binary protocol, prediction, pooling |

---

## Phase 7: Professional Optimization

*See: `docs/RFC-007-phase7-optimization.md` for full details.*

**Goal:** Achieve slither.io-level performance (50+ players, 60fps mobile, <20ms input latency)

| Optimization | Impact | Status |
|--------------|--------|--------|
| Object Pooling | Eliminates GC stuttering | ⬜ Pending |
| Texture Atlas | 2x mobile FPS | ⬜ Pending |
| Client Prediction | Instant input response | ⬜ Pending |
| Viewport Filtering | 4x player capacity | ⬜ Pending |
| Binary Protocol | 80% bandwidth reduction | ⬜ Pending |

### Target Metrics

| Metric | Current | Target |
|--------|---------|--------|
| Mobile FPS | 30-45 | 60 stable |
| Input latency | 100ms | <20ms perceived |
| Players/room | 10-20 | 50+ |
| Bandwidth | 50 KB/s | <15 KB/s |

---

## Future Ideas (Not Implemented)

- [ ] Player classes (Speed, Tank, Balanced)
- [ ] Fog of war (vision radius)
- [ ] Leaderboard persistence
- [ ] Spectator mode
- [ ] Power-ups / abilities
