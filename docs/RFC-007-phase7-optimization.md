# RFC-007: Phase 7 - Professional Optimization

## Overview

Phase 7 focuses on optimizing Tōrō to achieve professional-grade performance comparable to slither.io. This involves network bandwidth reduction, client-side prediction, rendering optimizations, and memory management.

**Goal:** Support 50+ concurrent players per room at 30Hz+ tick rate with smooth 60fps on mobile devices.

---

## Current State vs Target

| Metric | Current | Target | Improvement |
|--------|---------|--------|-------------|
| Tick Rate | 20 Hz | 30+ Hz | +50% responsiveness |
| Bandwidth/player | ~50 KB/s | ~10 KB/s | -80% |
| Mobile FPS | 30-45 fps | 60 fps | +100% |
| Max players/room | 10-20 | 50+ | +150% |
| Input latency | 50-100ms | <20ms perceived | -80% |

---

## 1. Network Bandwidth Optimization (Binary Protocol)

### Problem

JSON encoding is inefficient:
```json
{"x":1234.56,"y":789.01,"angle":45.5,"score":100}
```
- Key names repeated for every player, every tick
- Numbers encoded as strings (floats take 6-8 bytes as text)
- ~50 bytes per player × 50 players × 30 ticks = **75 KB/s** per client

### Solution

Binary protocol using `ArrayBuffer` / `DataView`:
```
[x:float32][y:float32][angle:int16][score:uint16] = 12 bytes per player
```

### Implementation

#### Option A: Raw Binary (Recommended for Performance)

```typescript
// shared/protocol.ts

// Packet Types
export const PACKET = {
  GAME_STATE: 0x01,
  PLAYER_INPUT: 0x02,
  PLAYER_DEATH: 0x03,
  FOOD_SPAWN: 0x04,
  FOOD_EATEN: 0x05,
} as const;

// Player state: 18 bytes
// [id:uint16][x:float32][y:float32][angle:int16][score:uint16][segmentCount:uint16]
export function encodePlayer(player: PlayerState): ArrayBuffer {
  const buffer = new ArrayBuffer(18);
  const view = new DataView(buffer);
  
  view.setUint16(0, player.id, true);      // 2 bytes
  view.setFloat32(2, player.x, true);      // 4 bytes
  view.setFloat32(6, player.y, true);      // 4 bytes
  view.setInt16(10, Math.round(player.angle * 100), true);  // 2 bytes (0.01° precision)
  view.setUint16(12, player.score, true);  // 2 bytes
  view.setUint16(14, player.bodySegments.length, true);     // 2 bytes
  view.setUint8(16, player.boosting ? 1 : 0);  // 1 byte
  view.setUint8(17, player.alive ? 1 : 0);     // 1 byte
  
  return buffer;
}

export function decodePlayer(buffer: ArrayBuffer, offset: number): PlayerState {
  const view = new DataView(buffer, offset);
  
  return {
    id: view.getUint16(0, true),
    x: view.getFloat32(2, true),
    y: view.getFloat32(6, true),
    angle: view.getInt16(10, true) / 100,
    score: view.getUint16(12, true),
    segmentCount: view.getUint16(14, true),
    boosting: view.getUint8(16) === 1,
    alive: view.getUint8(17) === 1,
  };
}
```

#### Option B: Schema-based (Easier to maintain)

Use `@colyseus/schema` or `schemapack`:

```typescript
// Using schemapack
import schemapack from 'schemapack';

const playerSchema = schemapack.build({
  id: 'uint16',
  x: 'float32',
  y: 'float32',
  angle: 'int16',
  score: 'uint16',
  segmentCount: 'uint16',
  boosting: 'bool',
  alive: 'bool',
});

const gameStateSchema = schemapack.build({
  tick: 'uint32',
  players: [playerSchema],
  food: [{
    id: 'uint16',
    x: 'float32',
    y: 'float32',
    value: 'uint8',
  }],
});

// Server
const encoded = gameStateSchema.encode(gameState);
socket.emit('state', encoded);

// Client
socket.on('state', (data) => {
  const gameState = gameStateSchema.decode(data);
});
```

#### Body Segment Optimization

Full body positions are expensive. Use **delta compression**:

```typescript
// Instead of sending all segment positions:
// segments: [{x,y}, {x,y}, {x,y}...] // 8 bytes × 100 = 800 bytes

// Send head + relative deltas:
// head: {x, y}          // 8 bytes
// deltas: [dx, dy, ...]  // 2 bytes × 100 = 200 bytes (75% reduction)

function encodeBodyDeltas(segments: BodySegment[]): Int8Array {
  const deltas = new Int8Array((segments.length - 1) * 2);
  
  for (let i = 1; i < segments.length; i++) {
    const dx = Math.round(segments[i].x - segments[i-1].x);
    const dy = Math.round(segments[i].y - segments[i-1].y);
    
    // Clamp to int8 range (-128 to 127)
    deltas[(i-1) * 2] = Math.max(-128, Math.min(127, dx));
    deltas[(i-1) * 2 + 1] = Math.max(-128, Math.min(127, dy));
  }
  
  return deltas;
}
```

### Expected Results

| Data Type | JSON | Binary | Savings |
|-----------|------|--------|---------|
| Player (no body) | ~80 bytes | 18 bytes | 78% |
| Body segment | ~16 bytes | 2 bytes (delta) | 87% |
| Food item | ~40 bytes | 9 bytes | 78% |
| Full game state (50 players) | ~50 KB | ~8 KB | 84% |

---

## 2. Client Prediction (Input Latency)

### Problem

Current flow creates perceived lag:
```
[User Input] → [Send to Server] → [Server Process] → [Broadcast] → [Client Render]
                     50ms              16ms              50ms
                              Total: ~116ms delay
```

Players feel "heavy" turning, especially on mobile networks.

### Solution

**Immediate local feedback** with server reconciliation:

```
[User Input] → [Immediate Local Update] → [User sees instant response]
            ↓
       [Send to Server] → [Server Process] → [Reconcile if needed]
```

### Implementation

#### Step 1: Input Queue

```typescript
// client/src/network/InputPrediction.ts

interface PendingInput {
  sequence: number;
  timestamp: number;
  angle: number;
  boosting: boolean;
}

export class InputPrediction {
  private pendingInputs: PendingInput[] = [];
  private sequence = 0;
  private lastServerSequence = 0;
  
  // Called on every input
  recordInput(angle: number, boosting: boolean): PendingInput {
    const input: PendingInput = {
      sequence: ++this.sequence,
      timestamp: Date.now(),
      angle,
      boosting,
    };
    
    this.pendingInputs.push(input);
    
    // Keep only last 60 inputs (1 second at 60fps)
    if (this.pendingInputs.length > 60) {
      this.pendingInputs.shift();
    }
    
    return input;
  }
  
  // Called when server state arrives
  reconcile(serverSequence: number, serverAngle: number, serverX: number, serverY: number): {
    shouldSnap: boolean;
    replayInputs: PendingInput[];
  } {
    // Remove acknowledged inputs
    this.pendingInputs = this.pendingInputs.filter(
      input => input.sequence > serverSequence
    );
    
    this.lastServerSequence = serverSequence;
    
    // Check if local prediction diverged significantly
    const localAngle = this.pendingInputs[0]?.angle ?? serverAngle;
    const angleDiff = Math.abs(normalizeAngle(localAngle - serverAngle));
    
    // If difference is small (<5°), keep smooth local version
    // If large (collision, lag), snap to server
    const shouldSnap = angleDiff > 5 || this.pendingInputs.length === 0;
    
    return {
      shouldSnap,
      replayInputs: shouldSnap ? this.pendingInputs : [],
    };
  }
}
```

#### Step 2: Immediate Visual Update

```typescript
// client/src/scenes/GameScene.ts

handleLocalMovement(): void {
  // ... existing input detection ...
  
  // IMMEDIATE local update (before sending to server)
  if (this.lantern) {
    // Smooth rotation toward target
    const currentAngle = this.localAngle;
    let angleDiff = targetAngle - currentAngle;
    
    // Normalize to -180 to 180
    while (angleDiff > 180) angleDiff -= 360;
    while (angleDiff < -180) angleDiff += 360;
    
    // Apply turn rate limit
    const maxTurn = GAME_CONFIG.PLAYER.TURN_SPEED * (delta / 1000);
    const turn = Math.max(-maxTurn, Math.min(maxTurn, angleDiff));
    
    this.localAngle += turn;
    
    // Update visual immediately
    this.lantern.setRotation(Phaser.Math.DegToRad(this.localAngle + 90));
  }
  
  // Record and send to server
  const input = this.inputPrediction.recordInput(targetAngle, this.isBoosting);
  
  this.socket.emit('input', {
    sequence: input.sequence,
    targetAngle: input.angle,
    boosting: input.boosting,
  });
}
```

#### Step 3: Server Reconciliation

```typescript
// When server state arrives
handleServerState(state: GameState): void {
  const myState = state.players.get(this.playerId);
  if (!myState) return;
  
  const { shouldSnap, replayInputs } = this.inputPrediction.reconcile(
    state.lastProcessedInput,
    myState.angle,
    myState.x,
    myState.y
  );
  
  if (shouldSnap) {
    // Significant divergence - snap to server position
    this.localAngle = myState.angle;
    this.localX = myState.x;
    this.localY = myState.y;
    
    // Replay unacknowledged inputs
    for (const input of replayInputs) {
      this.applyInput(input);
    }
  }
  // If !shouldSnap, keep smooth local prediction
}
```

### Expected Results

| Metric | Before | After |
|--------|--------|-------|
| Perceived input lag | 100-150ms | <16ms |
| Turn responsiveness | "Heavy" | Instant |
| Mobile experience | Frustrating | Smooth |

---

## 3. Rendering Performance (Texture Atlases)

### Problem

Current rendering:
- Individual SVG → PNG conversion per frame
- Separate draw call per sprite
- 150+ food items = 150+ draw calls

**GPU bottleneck on mobile devices.**

### Solution

**Texture Atlas:** Pack all sprites into one image, one draw call.

### Implementation

#### Step 1: Convert SVGs to PNGs

```bash
# Using Inkscape CLI or similar
inkscape lantern.svg --export-type=png --export-width=128 -o lantern.png
inkscape ghost.svg --export-type=png --export-width=64 -o ghost.png
inkscape devil-mask.svg --export-type=png --export-width=128 -o devil-mask.png
```

#### Step 2: Create Texture Atlas

Using **TexturePacker** or **free-tex-packer**:

```bash
npx free-tex-packer-cli \
  --input client/public/assets/sprites \
  --output client/public/assets/atlas \
  --name toro \
  --format phaser3
```

Outputs:
- `toro.png` - Combined texture
- `toro.json` - Frame definitions

#### Step 3: Update Phaser Code

```typescript
// Preload
preload(): void {
  this.load.atlas('toro', 'assets/atlas/toro.png', 'assets/atlas/toro.json');
}

// Usage
create(): void {
  // Instead of: this.add.image(x, y, 'lantern')
  this.lantern = this.add.sprite(x, y, 'toro', 'lantern');
  
  // Food sprites
  const ghost = this.add.sprite(x, y, 'toro', 'ghost');
  
  // Other players
  const enemy = this.add.sprite(x, y, 'toro', 'devil-mask');
}
```

#### Step 4: Multiple Resolutions (Retina Support)

```typescript
// Auto-select atlas based on device pixel ratio
const dpr = window.devicePixelRatio || 1;
const atlasName = dpr >= 2 ? 'toro@2x' : 'toro';

this.load.atlas('toro', `assets/atlas/${atlasName}.png`, `assets/atlas/${atlasName}.json`);
```

### Expected Results

| Metric | Before | After |
|--------|--------|-------|
| Draw calls | 200+ | 10-20 |
| GPU load | High | Low |
| Mobile FPS | 30-45 | 60 |
| Memory | Higher (many textures) | Lower (one atlas) |

---

## 4. Memory Management (Object Pooling)

### Problem

Creating/destroying objects triggers garbage collection:
```
Frame 1: Create 5 food sprites
Frame 2: Destroy 3 food sprites  → GC triggered → 50ms stutter
Frame 3: Create 2 food sprites
```

**Micro-stuttering** every few seconds.

### Solution

**Object Pooling:** Pre-create objects, reuse them.

### Implementation

#### Step 1: Create Pool Class

```typescript
// client/src/utils/ObjectPool.ts

export class SpritePool {
  private pool: Phaser.GameObjects.Sprite[] = [];
  private active: Set<Phaser.GameObjects.Sprite> = new Set();
  private scene: Phaser.Scene;
  private texture: string;
  private frame?: string;
  
  constructor(scene: Phaser.Scene, texture: string, frame?: string, initialSize = 100) {
    this.scene = scene;
    this.texture = texture;
    this.frame = frame;
    
    // Pre-create sprites
    for (let i = 0; i < initialSize; i++) {
      this.createSprite();
    }
  }
  
  private createSprite(): Phaser.GameObjects.Sprite {
    const sprite = this.scene.add.sprite(0, 0, this.texture, this.frame);
    sprite.setActive(false);
    sprite.setVisible(false);
    this.pool.push(sprite);
    return sprite;
  }
  
  acquire(x: number, y: number): Phaser.GameObjects.Sprite | null {
    // Find inactive sprite
    let sprite = this.pool.find(s => !this.active.has(s));
    
    // Expand pool if needed (with cap)
    if (!sprite && this.pool.length < 500) {
      sprite = this.createSprite();
    }
    
    if (!sprite) {
      console.warn('Pool exhausted');
      return null;
    }
    
    sprite.setPosition(x, y);
    sprite.setActive(true);
    sprite.setVisible(true);
    this.active.add(sprite);
    
    return sprite;
  }
  
  release(sprite: Phaser.GameObjects.Sprite): void {
    sprite.setActive(false);
    sprite.setVisible(false);
    this.active.delete(sprite);
  }
  
  releaseAll(): void {
    for (const sprite of this.active) {
      sprite.setActive(false);
      sprite.setVisible(false);
    }
    this.active.clear();
  }
  
  getActiveCount(): number {
    return this.active.size;
  }
}
```

#### Step 2: Use Pool for Food

```typescript
// client/src/scenes/GameScene.ts

private ghostPool: SpritePool;
private glowPool: SpritePool;

create(): void {
  // Initialize pools
  this.ghostPool = new SpritePool(this, 'toro', 'ghost', 200);
  this.glowPool = new SpritePool(this, 'toro', 'ghost-glow', 200);
}

updateFoodVisual(id: string, state: InterpolatedFood): void {
  let visual = this.foodVisuals.get(id);
  
  if (!visual) {
    const core = this.ghostPool.acquire(state.x, state.y);
    const glow = this.glowPool.acquire(state.x, state.y);
    
    if (!core || !glow) return; // Pool exhausted
    
    visual = { core, glow, phaseOffset: Math.random() * Math.PI * 2 };
    this.foodVisuals.set(id, visual);
  }
  
  // Update position...
}

removeFoodVisual(id: string): void {
  const visual = this.foodVisuals.get(id);
  if (visual) {
    this.ghostPool.release(visual.core);
    this.glowPool.release(visual.glow);
    this.foodVisuals.delete(id);
  }
}
```

#### Step 3: Pool for Body Segments

```typescript
private segmentPool: SpritePool;

create(): void {
  this.segmentPool = new SpritePool(this, 'toro', 'segment', 500);
}

// Use pool instead of creating/destroying segments
```

### Expected Results

| Metric | Before | After |
|--------|--------|-------|
| GC pauses | Every 5-10s | Rare |
| Frame drops | Frequent | Minimal |
| Memory churn | High | Low |
| Consistent FPS | No | Yes |

---

## 5. Viewport Interest Management

### Problem

Sending all entities to all players wastes bandwidth:
```
50 players × 150 food × 30 ticks = 225,000 updates/second
```

Most of this data is for off-screen entities players can't see.

### Solution

**Only send entities within player's viewport** (plus margin).

### Implementation

#### Server-Side Filtering

```typescript
// server/src/index.ts

function getVisibleEntities(
  player: ServerPlayerState,
  room: GameRoom
): { players: ServerPlayerState[]; food: Hitodama[] } {
  const viewportWidth = 1920;  // Assume max viewport
  const viewportHeight = 1080;
  const margin = 200;  // Buffer for interpolation
  
  const left = player.x - viewportWidth / 2 - margin;
  const right = player.x + viewportWidth / 2 + margin;
  const top = player.y - viewportHeight / 2 - margin;
  const bottom = player.y + viewportHeight / 2 + margin;
  
  // Use spatial grid for efficient lookup
  const visiblePlayers = room.playerGrid.getInRect(left, top, right, bottom);
  const visibleFood = room.foodGrid.getInRect(left, top, right, bottom);
  
  return { players: visiblePlayers, food: visibleFood };
}

// In game loop
function broadcastGameState(room: GameRoom): void {
  for (const player of room.players.values()) {
    if (!player.alive) continue;
    
    const { players, food } = getVisibleEntities(player, room);
    
    // Send personalized state to this player
    player.socket.emit('gameState', {
      tick: room.tick,
      players: players.map(p => serializePlayer(p)),
      food: food.map(f => serializeFood(f)),
      yourState: serializePlayer(player),
    });
  }
}
```

#### Spatial Grid Enhancement

```typescript
// Add rect query to SpatialGrid
getInRect(left: number, top: number, right: number, bottom: number): T[] {
  const results: T[] = [];
  
  const minCellX = Math.floor(left / this.cellSize);
  const maxCellX = Math.floor(right / this.cellSize);
  const minCellY = Math.floor(top / this.cellSize);
  const maxCellY = Math.floor(bottom / this.cellSize);
  
  for (let cx = minCellX; cx <= maxCellX; cx++) {
    for (let cy = minCellY; cy <= maxCellY; cy++) {
      const key = `${cx},${cy}`;
      const cell = this.cells.get(key);
      if (cell) {
        for (const item of cell) {
          // Actual bounds check
          if (item.x >= left && item.x <= right && 
              item.y >= top && item.y <= bottom) {
            results.push(item);
          }
        }
      }
    }
  }
  
  return results;
}
```

### Trade-offs

| Pros | Cons |
|------|------|
| ~70% bandwidth reduction | More CPU per player |
| Scales to 100+ players | Slightly more server code |
| Better mobile experience | Edge-case handling needed |

### Expected Results

| Scenario | Before | After |
|----------|--------|-------|
| 50 players, 150 food | 225K updates/s | ~50K updates/s |
| Bandwidth per player | 50 KB/s | 15 KB/s |
| Server can handle | 50 players | 200+ players |

---

## Implementation Priority

| Priority | Optimization | Impact | Effort |
|----------|--------------|--------|--------|
| 🔴 High | Object Pooling | Eliminates stuttering | Low |
| 🔴 High | Texture Atlas | 2x mobile FPS | Medium |
| 🟡 Medium | Client Prediction | Better feel | Medium |
| 🟡 Medium | Viewport Filtering | More players | Medium |
| 🟢 Low | Binary Protocol | More headroom | High |

### Recommended Order

1. **Object Pooling** (1-2 days) - Immediate stutter fix
2. **Texture Atlas** (1 day) - Mobile performance
3. **Client Prediction** (2-3 days) - Input feel
4. **Viewport Filtering** (2 days) - Scalability
5. **Binary Protocol** (3-5 days) - Future-proofing

---

## Success Metrics

After Phase 7 completion:

| Metric | Target |
|--------|--------|
| Mobile FPS | Stable 60fps |
| Input latency (perceived) | <20ms |
| Players per room | 50+ |
| Bandwidth per player | <15 KB/s |
| GC pauses | <1 per minute |
| Tick rate | 30 Hz |

---

## Files to Create/Modify

### New Files
- `shared/protocol.ts` - Binary encoding/decoding
- `client/src/utils/ObjectPool.ts` - Sprite pooling
- `client/src/network/InputPrediction.ts` - Client prediction

### Modified Files
- `server/src/index.ts` - Viewport filtering, binary protocol
- `client/src/scenes/GameScene.ts` - Pools, prediction, atlas
- `client/public/assets/` - Texture atlas

---

## Status

⏳ **Phase 7 In Progress**

| Task | Status |
|------|--------|
| Object Pooling | ⬜ Pending |
| Texture Atlas | ⬜ Pending |
| Client Prediction | ⬜ Pending |
| Viewport Filtering | ⬜ Pending |
| Binary Protocol | ⬜ Pending |

