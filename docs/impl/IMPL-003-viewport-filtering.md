# IMPL-003: Server-Side Viewport Filtering

> Only send entities that players can see

**Priority:** 🔴 CRITICAL  
**Effort:** 2 days  
**Impact:** 4x player capacity, 70% bandwidth reduction

---

## Problem

Currently, the server sends ALL entities to ALL players:
- 50 players × 200 food items = 10,000 food updates per tick
- 50 players × 50 other players × 100 segments = 250,000 segment positions

Most of this data is for entities **outside the player's viewport** — completely wasted bandwidth.

---

## Solution

Filter game state **per-client** based on their viewport. Only send:
- Entities within their visible area (+ margin)
- Compressed/simplified data for entities at the edge

---

## Implementation Guide

### Step 1: Define Viewport Constants

Add to `server/src/index.ts`:

```typescript
const VIEWPORT_CONFIG = {
  // Base viewport size (will be scaled by player's actual viewport)
  BASE_WIDTH: 1920,
  BASE_HEIGHT: 1080,
  
  // Extra margin around viewport (catch fast-moving entities)
  MARGIN: 400,
  
  // Interest zones for priority filtering
  ZONES: {
    CRITICAL: 300,   // Always full detail
    HIGH: 800,       // Full detail, every tick
    MEDIUM: 1500,    // Reduced detail, every 2 ticks
    LOW: 2500,       // Heads only, every 4 ticks
  },
  
  // Maximum entities per category to send
  LIMITS: {
    FOOD: 100,           // Max food items
    OTHER_PLAYERS: 20,   // Max other players with full body
    SEGMENTS_PER_PLAYER: 50, // Max segments per remote player
  }
};
```

### Step 2: Track Player Viewport

Update `ServerPlayerState` interface:

```typescript
interface ServerPlayerState extends PlayerState {
  // ... existing fields ...
  
  /** Client's reported viewport size */
  viewportWidth: number;
  viewportHeight: number;
  
  /** Last tick data was sent for this entity (for rate limiting) */
  lastSentTick: number;
}
```

Add viewport reporting from client:

```typescript
// In ClientToServerEvents
export interface ClientToServerEvents {
  playerInput: (input: PlayerInput) => void;
  updateViewport: (width: number, height: number) => void;
  // ... other events
}

// Server handler
socket.on('updateViewport', (width: number, height: number) => {
  const player = room.players.get(playerId);
  if (player) {
    player.viewportWidth = Math.min(width, 3840); // Cap at 4K
    player.viewportHeight = Math.min(height, 2160);
  }
});
```

### Step 3: Create Viewport Filter

Create `server/src/network/ViewportFilter.ts`:

```typescript
import type { ServerPlayerState, Hitodama, GameSnapshot, PlayerState } from '../types';

interface FilteredSnapshot {
  players: Record<string, PlayerState>;
  food: { items: Hitodama[] };
  scoreboard: ScoreboardEntry[];
  serverTime: number;
  tick: number;
}

export class ViewportFilter {
  private currentTick = 0;
  
  setTick(tick: number): void {
    this.currentTick = tick;
  }
  
  filterForPlayer(
    player: ServerPlayerState,
    allPlayers: Map<string, ServerPlayerState>,
    allFood: Map<string, Hitodama>,
    scoreboard: ScoreboardEntry[]
  ): FilteredSnapshot {
    const viewportHalfW = (player.viewportWidth || 1920) / 2 + VIEWPORT_CONFIG.MARGIN;
    const viewportHalfH = (player.viewportHeight || 1080) / 2 + VIEWPORT_CONFIG.MARGIN;
    
    // Filter players
    const filteredPlayers: Record<string, PlayerState> = {};
    
    // Always include self with full detail
    filteredPlayers[player.id] = this.toPlayerState(player, true);
    
    // Filter other players by distance
    const otherPlayers: Array<{ player: ServerPlayerState; distance: number }> = [];
    
    for (const [id, other] of allPlayers) {
      if (id === player.id || !other.alive || !other.hasJoined) continue;
      
      const dx = other.x - player.x;
      const dy = other.y - player.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      
      // Skip if completely outside extended viewport
      if (Math.abs(dx) > viewportHalfW + 500 || Math.abs(dy) > viewportHalfH + 500) {
        continue;
      }
      
      otherPlayers.push({ player: other, distance });
    }
    
    // Sort by distance (closest first)
    otherPlayers.sort((a, b) => a.distance - b.distance);
    
    // Include closest players with varying detail
    let includedPlayers = 0;
    for (const { player: other, distance } of otherPlayers) {
      if (includedPlayers >= VIEWPORT_CONFIG.LIMITS.OTHER_PLAYERS) break;
      
      // Determine detail level based on distance
      const zone = this.getZone(distance);
      
      // Rate limit based on zone
      if (!this.shouldSendThisTick(zone, other.lastSentTick)) {
        // Use last known state or skip
        continue;
      }
      
      other.lastSentTick = this.currentTick;
      
      // Include with appropriate detail
      filteredPlayers[other.id] = this.toPlayerState(other, false, zone);
      includedPlayers++;
    }
    
    // Filter food
    const filteredFood: Hitodama[] = [];
    
    for (const food of allFood.values()) {
      const dx = food.x - player.x;
      const dy = food.y - player.y;
      
      // Within viewport?
      if (Math.abs(dx) <= viewportHalfW && Math.abs(dy) <= viewportHalfH) {
        filteredFood.push(food);
        
        if (filteredFood.length >= VIEWPORT_CONFIG.LIMITS.FOOD) break;
      }
    }
    
    // Sort food by value (golden first) and distance
    filteredFood.sort((a, b) => {
      if (b.value !== a.value) return b.value - a.value;
      const distA = Math.abs(a.x - player.x) + Math.abs(a.y - player.y);
      const distB = Math.abs(b.x - player.x) + Math.abs(b.y - player.y);
      return distA - distB;
    });
    
    return {
      players: filteredPlayers,
      food: { items: filteredFood },
      scoreboard,
      serverTime: Date.now(),
      tick: this.currentTick,
    };
  }
  
  private getZone(distance: number): 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' {
    if (distance < VIEWPORT_CONFIG.ZONES.CRITICAL) return 'CRITICAL';
    if (distance < VIEWPORT_CONFIG.ZONES.HIGH) return 'HIGH';
    if (distance < VIEWPORT_CONFIG.ZONES.MEDIUM) return 'MEDIUM';
    return 'LOW';
  }
  
  private shouldSendThisTick(zone: string, lastSentTick: number): boolean {
    const ticksSince = this.currentTick - lastSentTick;
    
    switch (zone) {
      case 'CRITICAL':
      case 'HIGH':
        return true; // Every tick
      case 'MEDIUM':
        return ticksSince >= 2; // Every 2 ticks
      case 'LOW':
        return ticksSince >= 4; // Every 4 ticks
      default:
        return true;
    }
  }
  
  private toPlayerState(
    player: ServerPlayerState,
    isLocalPlayer: boolean,
    zone: string = 'CRITICAL'
  ): PlayerState {
    let bodySegments = player.bodySegments;
    
    // Limit segments for remote players based on zone
    if (!isLocalPlayer) {
      const maxSegments = zone === 'LOW' ? 0 : // Just head for far players
                         zone === 'MEDIUM' ? 20 :
                         VIEWPORT_CONFIG.LIMITS.SEGMENTS_PER_PLAYER;
      
      if (bodySegments.length > maxSegments) {
        // Sample segments instead of just truncating
        const step = bodySegments.length / maxSegments;
        const sampled = [];
        for (let i = 0; i < bodySegments.length && sampled.length < maxSegments; i += step) {
          sampled.push(bodySegments[Math.floor(i)]);
        }
        bodySegments = sampled;
      }
    }
    
    return {
      id: player.id,
      name: player.name,
      x: player.x,
      y: player.y,
      angle: player.angle,
      speed: player.speed,
      score: player.score,
      bodySegments,
      targetLength: player.targetLength,
      lastProcessedInput: player.lastProcessedInput,
      alive: player.alive,
      kills: player.kills,
    };
  }
}
```

### Step 4: Integrate into Game Loop

Modify `server/src/index.ts`:

```typescript
import { ViewportFilter } from './network/ViewportFilter';

// Create filter instance per room or global
const viewportFilter = new ViewportFilter();

function gameLoop(): void {
  const deltaMs = 1000 / TICK_RATE;
  const deltaS = deltaMs / 1000;
  
  for (const room of roomManager.getAllRooms()) {
    const tick = room.incrementTick();
    viewportFilter.setTick(tick);
    
    // ... existing game logic ...
    
    // Build scoreboard once
    const scoreboard = buildScoreboardForRoom(room);
    
    // Send filtered state to each player
    for (const player of room.players.values()) {
      if (!player.hasJoined) continue;
      
      const filteredSnapshot = viewportFilter.filterForPlayer(
        player,
        room.players,
        room.food,
        scoreboard
      );
      
      player.socket.emit('gameState', filteredSnapshot);
    }
  }
}
```

### Step 5: Client Reports Viewport

Add to `client/src/scenes/GameScene.ts`:

```typescript
create(): void {
  // ... existing code ...
  
  // Report viewport size to server
  this.reportViewport();
  
  // Update on resize
  this.scale.on('resize', () => {
    this.reportViewport();
  });
}

private reportViewport(): void {
  const width = this.cameras.main.width;
  const height = this.cameras.main.height;
  this.socket.emit('updateViewport', width, height);
}
```

### Step 6: Handle Missing Entities Gracefully

Update client to handle entities appearing/disappearing as viewport moves:

```typescript
// When rendering other players
private renderOtherPlayers(players: Record<string, PlayerState>): void {
  const serverPlayerIds = new Set(Object.keys(players));
  
  // Remove players no longer in view
  for (const [id, visual] of this.otherPlayerVisuals) {
    if (!serverPlayerIds.has(id)) {
      // Fade out instead of instant remove
      this.tweens.add({
        targets: visual.sprite,
        alpha: 0,
        duration: 200,
        onComplete: () => this.removePlayerVisual(id)
      });
    }
  }
  
  // Update or create visible players
  for (const [id, player] of Object.entries(players)) {
    if (id === this.playerId) continue;
    this.updateOrCreatePlayerVisual(id, player);
  }
}
```

---

## Expected Results

### Bandwidth Reduction

| Scenario | Before | After |
|----------|--------|-------|
| 10 players | 50 KB/s | 15 KB/s |
| 30 players | 150 KB/s | 25 KB/s |
| 50 players | 250 KB/s | 35 KB/s |

### Server CPU

| Scenario | Before | After |
|----------|--------|-------|
| Snapshot build time | O(n²) | O(n) |
| 50 players tick | 30ms | 10ms |

---

## Testing Checklist

- [ ] Players appear smoothly when entering viewport
- [ ] Players fade out when leaving viewport
- [ ] Close players have full body segments
- [ ] Far players have reduced/no segments
- [ ] Food only appears within viewport
- [ ] No "teleporting" when entities re-enter view
- [ ] Bandwidth reduced by 60%+
- [ ] Server tick time reduced

---

## AI Implementation Prompt

```
Implement server-side viewport filtering for Tōrō game following docs/impl/IMPL-003-viewport-filtering.md.

Current state:
- Server sends full game state to all players in buildGameSnapshotForRoom()
- All food and all player segments sent every tick
- No per-client filtering

Tasks:
1. Add viewport tracking to ServerPlayerState
2. Create ViewportFilter class with distance-based filtering
3. Add updateViewport socket event from client
4. Modify game loop to send filtered snapshots per-player
5. Update client to handle entities entering/leaving view
6. Implement interest zones (CRITICAL, HIGH, MEDIUM, LOW)

Goal: Reduce bandwidth by 70% while maintaining smooth gameplay.
Filter should prioritize nearby entities and high-value targets.
```


