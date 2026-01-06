# RFC-001: Phase 1 Foundation Architecture

**Status:** Implemented ✅  
**Author:** Development Team  
**Created:** 2026-01-02  
**Phase:** 1 - The Skeleton  

---

## 1. Summary

This RFC documents the foundational architecture for Tōrō, establishing the client-server communication layer, rendering pipeline, and movement system. Phase 1 creates a working skeleton that all future phases will build upon.

---

## 2. Motivation

Before implementing complex game mechanics (snake bodies, collisions, combat), we need a stable foundation that:

1. Establishes real-time bidirectional communication
2. Proves the rendering pipeline works smoothly at 60fps
3. Validates the "floaty/boat-like" movement feel
4. Sets up proper TypeScript typing across client and server

---

## 3. Technical Architecture

### 3.1 High-Level Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                          CLIENT (Port 3000)                     │
│  ┌─────────────┐    ┌──────────────┐    ┌───────────────────┐  │
│  │   Vite      │───▶│   Phaser 3   │───▶│    GameScene      │  │
│  │  (Bundler)  │    │   (Engine)   │    │  (Render + Input) │  │
│  └─────────────┘    └──────────────┘    └─────────┬─────────┘  │
│                                                    │            │
│                                          Socket.io Client       │
└────────────────────────────────────────────────────┼────────────┘
                                                     │
                                            WebSocket Connection
                                                     │
┌────────────────────────────────────────────────────┼────────────┐
│                          SERVER (Port 3001)        │            │
│  ┌─────────────┐    ┌──────────────┐    ┌─────────▼─────────┐  │
│  │  Express    │───▶│  Socket.io   │───▶│    Game Loop      │  │
│  │  (HTTP)     │    │  (WebSocket) │    │  (20 Hz Tick)     │  │
│  └─────────────┘    └──────────────┘    └───────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 Directory Structure

```
toro/
├── client/                     # Browser-side game
│   ├── src/
│   │   ├── main.ts             # Phaser bootstrap
│   │   ├── config.ts           # Game constants
│   │   └── scenes/
│   │       └── GameScene.ts    # Main scene (rendering + input)
│   ├── index.html              # Entry HTML
│   ├── vite.config.ts          # Bundler configuration
│   └── tsconfig.json           # Client TS config
│
├── server/                     # Authoritative game server
│   ├── src/
│   │   └── index.ts            # Server entry + game loop
│   └── tsconfig.json           # Server TS config
│
├── shared/                     # Shared type definitions
│   └── types.ts                # PlayerInput, GameSnapshot, etc.
│
├── docs/                       # Documentation
│   ├── guideline.md            # Game design spec
│   └── RFC-001-*.md            # This document
│
├── package.json                # Root dependencies
└── tsconfig.base.json          # Shared TS settings
```

---

## 4. Implementation Details

### 4.1 Shared Types (`shared/types.ts`)

All client-server communication uses strongly-typed interfaces:

```typescript
// Input sent from client → server (every frame)
interface PlayerInput {
  mouseX: number;      // -1 to 1 (normalized)
  mouseY: number;      // -1 to 1 (normalized)
  boosting: boolean;   // Space/Click held
  timestamp: number;   // For lag compensation
}

// Player state sent from server → clients (20 Hz)
interface PlayerState {
  id: string;
  x: number;
  y: number;
  angle: number;
  score: number;
  bodySegments: Array<{ x: number; y: number }>;
}

// Full game snapshot broadcast
interface GameSnapshot {
  players: Record<string, PlayerState>;
  timestamp: number;
}
```

### 4.2 Client Architecture

#### Entry Point (`main.ts`)
- Initializes Phaser with Arcade Physics
- Registers `GameScene` as the main scene
- Configures auto-scaling to fill viewport

#### Configuration (`config.ts`)
- Centralizes all magic numbers
- Defines color palette (lantern glow, spirits, etc.)
- Stores server URL and physics constants

#### Game Scene (`GameScene.ts`)

**Responsibilities:**
1. **Rendering** - Draws lantern (glow + core) and other players
2. **Input** - Captures mouse position and boost state
3. **Movement** - Implements floaty physics with turn rate limiting
4. **Networking** - Sends input to server, receives game state

**Movement Algorithm:**
```
1. Calculate target angle from mouse position
2. Rotate current angle toward target (limited by TURN_SPEED)
3. Calculate speed from mouse distance (further = faster)
4. Apply boost multiplier if Space/Click held
5. Move in direction of current angle at calculated speed
6. Clamp position to world bounds
```

### 4.3 Server Architecture

#### Game Loop (20 Hz)
```typescript
setInterval(() => {
  // 1. Process all player inputs
  for (player of players) {
    updatePlayer(player, deltaTime);
  }
  
  // 2. Build snapshot of current state
  const snapshot = buildGameSnapshot();
  
  // 3. Broadcast to all clients
  io.emit('gameState', snapshot);
}, 1000 / 20);
```

#### Connection Flow
```
Client connects
    ↓
Server creates PlayerState
    ↓
Server emits 'connected' with playerId
    ↓
Server broadcasts 'playerJoined' to others
    ↓
Client begins sending 'playerInput' every frame
    ↓
Server updates position in game loop
    ↓
Server broadcasts 'gameState' at 20 Hz
```

---

## 5. Configuration Constants

| Constant | Value | Description |
|----------|-------|-------------|
| `WORLD_WIDTH` | 2000 | Game world width in pixels |
| `WORLD_HEIGHT` | 2000 | Game world height in pixels |
| `TICK_RATE` | 20 Hz | Server update frequency |
| `PLAYER.RADIUS` | 20 | Lantern hitbox radius |
| `PLAYER.BASE_SPEED` | 200 | Base movement speed (px/s) |
| `PLAYER.TURN_SPEED` | 4 | Rotation speed (rad/s) |
| `PLAYER.BOOST_MULTIPLIER` | 1.5 | Speed multiplier when boosting |

---

## 6. Socket.io Events

### Client → Server

| Event | Payload | Frequency | Description |
|-------|---------|-----------|-------------|
| `playerInput` | `PlayerInput` | Every frame | Current input state |

### Server → Client

| Event | Payload | Frequency | Description |
|-------|---------|-----------|-------------|
| `connected` | `string` | Once | Assigns player ID |
| `gameState` | `GameSnapshot` | 20 Hz | Full world state |
| `playerJoined` | `string` | On join | Notification |
| `playerLeft` | `string` | On leave | Notification |

---

## 7. Verification Checklist

### ✅ Completed

- [x] Vite bundles client correctly
- [x] Phaser renders at 60fps
- [x] Mouse controls direction and speed
- [x] Turn rate limiting creates "boat-like" feel
- [x] Boost increases speed by 50%
- [x] Boost visual feedback (larger glow)
- [x] Camera follows player
- [x] World bounds enforced
- [x] Socket.io connects successfully
- [x] Server assigns unique player IDs
- [x] Other players rendered in different color
- [x] TypeScript strict mode enabled
- [x] Shared types work across client/server

### 🔲 Deferred to Phase 2+

- [ ] Snapshot interpolation (smooth remote players)
- [ ] Client-side prediction
- [ ] Server reconciliation
- [ ] Body segments (snake tail)
- [ ] Collision detection
- [ ] Food spawning

---

## 8. Running the Project

```bash
# Install dependencies
npm install

# Start both client and server
npm run dev

# Or separately:
npm run dev:server   # http://localhost:3001
npm run dev:client   # http://localhost:3000
```

---

## 9. Known Limitations

1. **No interpolation** - Remote players teleport between server ticks
2. **No prediction** - Local player waits for server confirmation (Phase 2)
3. **No persistence** - All state lost on server restart
4. **Single server** - No horizontal scaling (acceptable for MVP)

---

## 10. Next Steps (Phase 2)

1. Implement snapshot interpolation for smooth remote player movement
2. Add client-side prediction for responsive local movement
3. Server reconciliation to correct prediction errors
4. Begin work on body segment array (snake tail)

---

## Appendix A: Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `phaser` | ^3.80.1 | Game engine |
| `socket.io` | ^4.7.4 | Server WebSocket |
| `socket.io-client` | ^4.7.4 | Client WebSocket |
| `express` | ^4.18.2 | HTTP server |
| `vite` | ^5.0.12 | Bundler |
| `typescript` | ^5.3.3 | Type safety |
| `tsx` | ^4.7.0 | Server hot reload |
| `concurrently` | ^8.2.2 | Run multiple scripts |

---

## Appendix B: Color Palette

```
BACKGROUND:    #0a0a12  (Deep abyss)
LANTERN_GLOW:  #ffcc66  (Warm amber glow)
LANTERN_CORE:  #ffeebb  (Bright center)
SPIRIT_TRAIL:  #88ccff  (Cool spirit blue)
HITODAMA:      #66ffcc  (Soul pellet cyan)
```

---

*End of RFC-001*



