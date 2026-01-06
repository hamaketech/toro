# RFC-002: Phase 2 - Multiplayer Movement

**Status:** Implemented ✅  
**Author:** Development Team  
**Created:** 2026-01-02  
**Phase:** 2 - Multiplayer Movement  
**Depends On:** RFC-001 (Phase 1 Foundation)

---

## 1. Summary

Phase 2 implements smooth multiplayer movement through three key systems:
1. **Snapshot Interpolation** - Remote players move smoothly between server updates
2. **Client-side Prediction** - Local player moves instantly without waiting for server
3. **Server Reconciliation** - Corrects prediction errors when server disagrees

---

## 2. Problem Statement

Phase 1 had these issues:
- **Remote player jitter** - Players teleported between 50ms server ticks
- **Input lag** - Local player waited for server round-trip before moving
- **No error correction** - Client and server could desync permanently

---

## 3. Solution Architecture

### 3.1 High-Level Data Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              CLIENT                                      │
│                                                                          │
│  ┌──────────────────┐     ┌───────────────────┐     ┌────────────────┐  │
│  │   User Input     │────▶│ Client Prediction │────▶│  Render Local  │  │
│  │   (Mouse/Keys)   │     │  (Predict + Store)│     │     Player     │  │
│  └────────┬─────────┘     └───────────────────┘     └────────────────┘  │
│           │                        ▲                                     │
│           │                        │ Reconcile                           │
│           ▼                        │                                     │
│  ┌──────────────────┐     ┌───────┴───────────┐     ┌────────────────┐  │
│  │  Send Input      │     │ Snapshot Buffer   │────▶│ Render Remote  │  │
│  │  (with sequence) │     │ (Interpolation)   │     │    Players     │  │
│  └────────┬─────────┘     └───────────────────┘     └────────────────┘  │
│           │                        ▲                                     │
└───────────┼────────────────────────┼─────────────────────────────────────┘
            │                        │
            ▼                        │
┌───────────────────────────────────────────────────────────────────────────┐
│                              SERVER                                        │
│                                                                            │
│  ┌──────────────────┐     ┌───────────────────┐     ┌──────────────────┐  │
│  │  Receive Input   │────▶│   Physics Update  │────▶│  Broadcast State │  │
│  │  (Store latest)  │     │   (Authoritative) │     │  (With sequence) │  │
│  └──────────────────┘     └───────────────────┘     └──────────────────┘  │
└───────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Time Synchronization

```
Client                                     Server
   │                                          │
   │──── ping(clientTime: 1000) ─────────────▶│
   │                                          │
   │◀─── pong(serverTime: 5050, client: 1000) │
   │                                          │
   
RTT = now - clientTime = 1100 - 1000 = 100ms
Server time offset = serverTime + RTT/2 - now
                   = 5050 + 50 - 1100 = 4000ms
```

---

## 4. Implementation Details

### 4.1 Snapshot Interpolation (`SnapshotInterpolation.ts`)

**Purpose:** Smooth rendering of remote players by interpolating between server snapshots.

**Key Concepts:**
- **Render Delay:** We render 100ms behind real-time to ensure we always have two snapshots to interpolate between
- **Snapshot Buffer:** Store the last 30 snapshots for interpolation
- **Time Sync:** Periodic ping/pong to estimate server time offset

**Algorithm:**
```typescript
function getInterpolatedPlayers() {
  // 1. Calculate render time (server time - delay)
  const renderTime = getServerTime() - INTERPOLATION_DELAY;
  
  // 2. Find snapshots that bracket render time
  const { before, after, t } = findInterpolationSnapshots(renderTime);
  
  // 3. Interpolate each player's position
  for (player in after.players) {
    result[player] = {
      x: lerp(before.x, after.x, t),
      y: lerp(before.y, after.y, t),
      angle: lerpAngle(before.angle, after.angle, t),
    };
  }
  
  return result;
}
```

### 4.2 Client Prediction (`ClientPrediction.ts`)

**Purpose:** Instant local movement without waiting for server confirmation.

**Key Concepts:**
- **Input Sequence:** Each input has a unique incrementing number
- **Input History:** Store predicted states for reconciliation
- **Deterministic Simulation:** Client and server use identical physics

**Algorithm:**
```typescript
function processInput(mouseX, mouseY, boosting, delta, sequence) {
  // 1. Apply same physics as server
  // 2. Store input + predicted state in history
  inputHistory.push({
    input: { sequence, mouseX, mouseY, boosting },
    predictedX: x,
    predictedY: y,
  });
  
  // 3. Return predicted position for rendering
  return { x, y, angle };
}
```

### 4.3 Server Reconciliation

**Purpose:** Correct client when prediction differs from server authority.

**Algorithm:**
```typescript
function reconcile(serverState) {
  // 1. Find the input server just processed
  const processedIndex = findInput(serverState.lastProcessedInput);
  
  // 2. Calculate error between prediction and server
  const error = {
    x: serverState.x - inputHistory[processedIndex].predictedX,
    y: serverState.y - inputHistory[processedIndex].predictedY,
  };
  
  // 3. If error is small, smooth correction
  if (distance(error) < MAX_ERROR) {
    correction += error; // Applied gradually over frames
  } else {
    // Large error: snap to server and replay inputs
    position = serverState.position;
    replayUnprocessedInputs();
  }
  
  // 4. Remove processed inputs from history
  inputHistory.splice(0, processedIndex + 1);
}
```

---

## 5. Configuration

New network configuration added to `config.ts`:

| Constant | Value | Description |
|----------|-------|-------------|
| `INTERPOLATION_DELAY` | 100ms | How far behind real-time to render remote players |
| `SNAPSHOT_BUFFER_SIZE` | 30 | Max snapshots to keep |
| `INPUT_BUFFER_SIZE` | 60 | Max inputs to keep for reconciliation |
| `MAX_POSITION_ERROR` | 50px | Error threshold before snapping |
| `RECONCILIATION_SMOOTHING` | 0.1 | How fast to apply corrections |
| `TIME_SYNC_INTERVAL` | 5000ms | How often to sync clocks |

---

## 6. Updated Types

### PlayerInput (Client → Server)
```typescript
interface PlayerInput {
  sequence: number;      // NEW: For reconciliation
  mouseX: number;
  mouseY: number;
  boosting: boolean;
  timestamp: number;
}
```

### PlayerState (Server → Client)
```typescript
interface PlayerState {
  id: string;
  x: number;
  y: number;
  angle: number;
  speed: number;          // NEW: For interpolation
  score: number;
  bodySegments: Array<{ x: number; y: number }>;
  lastProcessedInput: number;  // NEW: For reconciliation
}
```

### GameSnapshot
```typescript
interface GameSnapshot {
  players: Record<string, PlayerState>;
  serverTime: number;     // NEW: For interpolation timing
  tick: number;           // NEW: For ordering
}
```

### New Events
```typescript
// Time synchronization
ping: (clientTime: number) => void;
pong: (serverTime: number, clientTime: number) => void;

// Initial state includes full snapshot
connected: (state: InitialGameState) => void;
```

---

## 7. File Structure Changes

```
client/src/
├── network/                     # NEW FOLDER
│   ├── SnapshotInterpolation.ts # Smooth remote player rendering
│   └── ClientPrediction.ts      # Local prediction + reconciliation
├── scenes/
│   └── GameScene.ts             # Updated to use new systems
└── config.ts                    # Added NETWORK section
```

---

## 8. Debug Features

Press **F3** to toggle debug overlay showing:
- RTT (round-trip time)
- Interpolation delay
- Server time vs render time
- Current position
- Number of other players

---

## 9. Verification Checklist

### ✅ Completed

- [x] Snapshot buffer stores incoming server states
- [x] Time synchronization via ping/pong
- [x] Interpolation between snapshots for remote players
- [x] Client-side prediction for local movement
- [x] Input sequence tracking
- [x] Server reconciliation on state mismatch
- [x] Smooth error correction (not snapping)
- [x] Input replay after large corrections
- [x] Debug overlay for network stats

### 🔲 Deferred to Phase 3+

- [ ] Body segment interpolation (snake tail)
- [ ] Collision prediction
- [ ] Food spawning and collection

---

## 10. Testing Scenarios

### Scenario 1: Normal Gameplay
1. Start server and client
2. Move with mouse - should feel instant
3. Open second browser tab
4. Other player should move smoothly (no teleporting)

### Scenario 2: Network Simulation
1. Add artificial latency (Chrome DevTools → Network → Slow 3G)
2. Local player should still feel responsive
3. Remote players should still interpolate smoothly
4. After removing throttle, positions should reconcile

### Scenario 3: Debug Verification
1. Press F3 to show debug overlay
2. Verify RTT shows reasonable values (< 100ms local)
3. Verify render time is ~100ms behind server time

---

## 11. Next Steps (Phase 3)

1. Implement body segment array ("snake tail")
2. Body segments follow head using position history
3. Spawn food (Hitodama) on server
4. Sync food to clients
5. Eating food increases body length

---

*End of RFC-002*



