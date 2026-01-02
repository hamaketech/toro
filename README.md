# 🏮 Tōrō - The River of Souls

A multiplayer .io survival game inspired by the Obon Festival. Guide your Lantern through the river of souls, collect Hitodama spirits to grow your procession, and cut off other players to absorb their collection.

## Tech Stack

- **Client:** Phaser 3 + TypeScript + Vite
- **Server:** Node.js + Socket.io + Express
- **Communication:** WebSocket (Socket.io)

## Getting Started

### Install Dependencies

```bash
npm install
```

### Development Mode

Run both client and server in development mode:

```bash
npm run dev
```

Or run them separately:

```bash
# Terminal 1 - Server (port 3001)
npm run dev:server

# Terminal 2 - Client (port 3000)
npm run dev:client
```

### Controls

| Input | Action |
|-------|--------|
| **Mouse Position** | Controls direction and speed (further = faster) |
| **Space / Left Click** | Boost (+50% speed, drops body segments) |
| **F3** | Toggle debug overlay |

## Gameplay

### Core Loop
1. **Collect Hitodama** (soul pellets) to grow your procession
2. **Boost** to move faster, but you'll drop segments as food
3. **Cut off** other players by making them hit your body
4. **Absorb** dropped souls from defeated players

### The Procession
Your Lantern leads a procession of spirits. The longer your procession:
- Higher score
- More dangerous to enemies (they can hit your body)
- More to lose if you die

### Magnetism
Hitodama are magnetically attracted to your Lantern. Get close and they'll drift toward you!

## Project Structure

```
toro/
├── client/                  # Phaser 3 game client
│   ├── src/
│   │   ├── main.ts          # Entry point
│   │   ├── config.ts        # Game configuration
│   │   ├── network/         # Network systems
│   │   │   ├── SnapshotInterpolation.ts
│   │   │   └── ClientPrediction.ts
│   │   └── scenes/
│   │       └── GameScene.ts # Main game scene
│   ├── index.html
│   └── vite.config.ts
├── server/                  # Socket.io game server
│   └── src/
│       └── index.ts         # Server with game loop
├── shared/                  # Shared types & constants
│   └── types.ts
├── docs/                    # Documentation
│   ├── guideline.md         # Game design spec
│   ├── RFC-001-*.md         # Phase 1: Foundation
│   ├── RFC-002-*.md         # Phase 2: Multiplayer Movement
│   └── RFC-003-*.md         # Phase 3: Snake Logic
└── package.json
```

## Development Phases

- [x] **Phase 1:** Basic setup with Phaser + Socket.io + Vite
- [x] **Phase 2:** Multiplayer movement with snapshot interpolation
- [x] **Phase 3:** Snake logic (body segments, food, growth)
  - Position history for smooth body following
  - Food (Hitodama) with magnetic pull
  - Boost drops segments as food (risk/reward)
- [ ] **Phase 4:** Combat & collision detection
- [ ] **Phase 5:** Juice & polish (fog of war, bloom effects, classes)

## Network Architecture

```
┌──────────────────┐                      ┌──────────────────┐
│      CLIENT      │    Input (60fps)     │      SERVER      │
│                  │ ──────────────────▶  │                  │
│  • Prediction    │                      │  • Authority     │
│  • Interpolation │  ◀──────────────────  │  • Physics       │
│  • Rendering     │    Snapshots (20hz)  │  • Food/Body     │
└──────────────────┘                      └──────────────────┘
```

- **Client Prediction:** Local player moves instantly
- **Snapshot Interpolation:** Other players render 100ms behind for smoothness
- **Server Authority:** Server owns all physics and collision

## Game Constants

| Constant | Value | Description |
|----------|-------|-------------|
| World Size | 2000×2000 | Game world dimensions |
| Tick Rate | 20 Hz | Server update frequency |
| Body Spacing | 25px | Distance between segments |
| Magnet Radius | 100px | Food attraction range |
| Boost Drop | 2/sec | Segments lost while boosting |
| Max Food | 200 | Maximum food items in world |
