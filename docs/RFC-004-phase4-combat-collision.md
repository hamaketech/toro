# RFC-004: Phase 4 - Combat & Collision System

## Overview

This document details the implementation of Phase 4 - Combat & Collision for Tōrō (The River of Souls). This phase adds the core combat mechanics: collision detection, death handling, respawn system, and scoreboard.

## Status: ✅ Complete

## Implementation Summary

### 1. Collision Detection (Server-Side)

All collision detection is performed on the server for authority and anti-cheat purposes.

#### Head vs Enemy Body
- Player's head (lantern) collides with another player's body segments
- Uses circle-circle collision with configurable hitbox radius
- **Result**: The player whose head touched the body dies

```typescript
// Head vs Body collision check
for (const segment of other.bodySegments) {
  const segDist = distance(player.x, player.y, segment.x, segment.y);
  if (segDist < PLAYER_CONFIG.RADIUS + GAME_CONSTANTS.BODY_SEGMENT_HITBOX) {
    // Player dies
    deaths.push({ player, cause: 'head_collision', killer: other });
  }
}
```

#### Head vs Head Collision
- Two player heads collide with each other
- Configurable behavior: both die OR smaller one dies
- Size determined by body segment count

```typescript
// Head vs Head collision
const headDist = distance(player.x, player.y, other.x, other.y);
if (headDist < PLAYER_CONFIG.RADIUS * 2) {
  if (GAME_CONSTANTS.HEAD_COLLISION_BOTH_DIE) {
    // Both players die
  } else {
    // Smaller player dies (based on body length)
    const playerSize = player.bodySegments.length;
    const otherSize = other.bodySegments.length;
    // Smaller or equal size dies
  }
}
```

#### World Border Collision
- Player dies when touching the world boundary
- Small margin before the hard edge to trigger death
- Visual warning on client when approaching border

```typescript
function isAtWorldBorder(player: ServerPlayerState): boolean {
  const margin = PLAYER_CONFIG.RADIUS * 0.5;
  return (
    player.x <= margin ||
    player.x >= WORLD_WIDTH - margin ||
    player.y <= margin ||
    player.y >= WORLD_HEIGHT - margin
  );
}
```

### 2. Death Handling

#### Death Event System
New shared types for death events:

```typescript
type DeathCause = 
  | 'head_collision'    // Hit another's body
  | 'head_to_head'      // Head-on collision
  | 'world_border'      // Hit world boundary
  | 'disconnect';       // Player disconnected

interface DeathEvent {
  playerId: string;
  cause: DeathCause;
  killerId?: string;
  x: number;
  y: number;
  score: number;
  foodDropped: number;
}
```

#### Death Processing
On death:
1. Mark player as dead (`alive = false`)
2. Award kill to killer (if applicable)
3. Drop all body segments as food
4. Drop bonus food at head position
5. Clear player's body segments
6. Emit death event to all clients

```typescript
function killPlayer(player, cause, killer): void {
  player.alive = false;
  player.respawnTime = Date.now() + GAME_CONSTANTS.RESPAWN_DELAY;
  
  // Award kill
  if (killer) killer.kills++;
  
  // Drop body segments as food
  for (const segment of player.bodySegments) {
    spawnFood(segment.x, segment.y, DEATH_DROP_VALUE);
  }
  
  // Emit event
  io.emit('playerDied', deathEvent);
}
```

### 3. Respawn System

#### Automatic Respawn Timer
- Players automatically respawn after `RESPAWN_DELAY` (2 seconds default)
- Server checks for pending respawns each game tick

#### Respawn Process
1. Reset position to random location in center area
2. Reset all stats (score, kills preserved)
3. Initialize fresh body (starting length)
4. Emit respawn event to clients

```typescript
function respawnPlayer(player): void {
  player.x = WORLD_WIDTH / 2 + (Math.random() - 0.5) * 600;
  player.y = WORLD_HEIGHT / 2 + (Math.random() - 0.5) * 600;
  player.alive = true;
  player.score = 0;
  player.targetLength = STARTING_BODY_LENGTH;
  // ... initialize position history
  
  io.emit('playerRespawned', player.id);
}
```

### 4. Scoreboard System

#### Server-Side Scoreboard
- Built each tick from all players
- Sorted by score (descending)
- Limited to top N players (`SCOREBOARD_SIZE = 5`)

```typescript
interface ScoreboardEntry {
  id: string;
  score: number;
  kills: number;
  bodyLength: number;
}

function buildScoreboard(): ScoreboardEntry[] {
  const entries = players.map(p => ({
    id: p.id,
    score: p.score,
    kills: p.kills,
    bodyLength: p.bodySegments.length,
  }));
  return entries.sort((a, b) => b.score - a.score).slice(0, SCOREBOARD_SIZE);
}
```

#### Client-Side Scoreboard UI
- Fixed position in top-right corner
- Semi-transparent dark background
- Highlights local player's entry
- Shows rank medals (👑🥈🥉)

### 5. Client-Side Death Experience

#### Death Overlay
When the local player dies:
1. Hide the lantern and body segments
2. Display death overlay with:
   - "YOU DIED" message
   - Cause of death
   - Final score
   - Respawn instructions

#### Death Explosion Effect
- Particle system spawns on any player death
- Particles burst outward from death location
- Gradual fade and shrink
- Colors match the game's ethereal theme

```typescript
interface DeathParticle {
  x, y: number;      // Position
  vx, vy: number;    // Velocity
  size: number;      // Radius
  alpha: number;     // Opacity
  life: number;      // Remaining lifetime (0-1)
  color: number;     // Particle color
}
```

#### Border Warning
- Lantern core pulses red when near world border
- Provides visual feedback before death

### 6. New Game Constants

```typescript
export const GAME_CONSTANTS = {
  // ... existing constants ...
  
  /** Death drop value multiplier */
  DEATH_DROP_VALUE: 2,
  /** Body segment hitbox radius */
  BODY_SEGMENT_HITBOX: 10,
  /** Respawn delay in milliseconds */
  RESPAWN_DELAY: 2000,
  /** Head-to-head: both die if true, smaller dies if false */
  HEAD_COLLISION_BOTH_DIE: false,
  /** Number of players on scoreboard */
  SCOREBOARD_SIZE: 5,
};
```

## Socket Events

### New Server-to-Client Events

| Event | Payload | Description |
|-------|---------|-------------|
| `playerDied` | `DeathEvent` | Player died - spawn explosion effect |
| `playerRespawned` | `playerId: string` | Player respawned - hide death overlay |

### New Client-to-Server Events

| Event | Payload | Description |
|-------|---------|-------------|
| `requestRespawn` | none | Request manual respawn (optional) |

## State Changes

### PlayerState Extensions

```typescript
interface PlayerState {
  // ... existing fields ...
  alive: boolean;    // Whether player is alive
  kills: number;     // Number of kills
}
```

### GameSnapshot Extensions

```typescript
interface GameSnapshot {
  // ... existing fields ...
  scoreboard: ScoreboardEntry[];  // Top players
}
```

## Testing Checklist

- [x] Player dies when head touches another player's body
- [x] Player dies when touching world border
- [x] Head-to-head collision kills smaller player (or both if equal/configured)
- [x] Death drops all body segments as food
- [x] Death explosion effect displays at death location
- [x] Death overlay shows cause and score
- [x] Player automatically respawns after delay
- [x] Respawn resets position and stats
- [x] Scoreboard updates in real-time
- [x] Scoreboard highlights local player
- [x] Kill count increments for killer
- [x] Dead players cannot send input
- [x] Border warning visual when near edge

## Files Modified

- `shared/types.ts` - Added death types, scoreboard types, new constants
- `server/src/index.ts` - Collision detection, death handling, respawn, scoreboard
- `client/src/network/SnapshotInterpolation.ts` - Added `alive`, `kills`, scoreboard access
- `client/src/scenes/GameScene.ts` - Death overlay, explosion effects, scoreboard UI, border warning

## Next Phase

**Phase 5: Juice & Polish**
- Fog of War masking (visibility radius)
- Glow/Bloom shader effects
- Class selection screen
- Sound effects
- Enhanced visual polish

