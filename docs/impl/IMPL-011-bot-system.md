# IMPL-011: Bot System

## Overview

The Bot System provides intelligent AI opponents for Tōrō, ensuring engaging gameplay even when human players are scarce. Bots use a combination of **Finite State Machine (FSM)** for high-level decision making and **Steering Behaviors** for smooth, natural movement.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      BotManager                              │
│  - Bot lifecycle (create, remove, respawn)                  │
│  - Room population balancing                                 │
│  - Difficulty distribution                                   │
└─────────────────────┬───────────────────────────────────────┘
                      │ manages
                      ▼
┌─────────────────────────────────────────────────────────────┐
│                        BotAI                                 │
│  ┌─────────────────┐  ┌─────────────────────────────────┐  │
│  │  State Machine  │  │     Steering Behaviors          │  │
│  │  ─────────────  │  │  ─────────────────────────────  │  │
│  │  • FORAGING     │  │  • Seek (move towards target)   │  │
│  │  • HUNTING      │  │  • Flee (escape from threat)    │  │
│  │  • FLEEING      │  │  • Pursue (predict & intercept) │  │
│  │  • CIRCLING     │  │  • Wander (exploration)         │  │
│  │  • IDLE         │  │  • Wall avoidance               │  │
│  └─────────────────┘  │  • Body segment avoidance       │  │
│                       └─────────────────────────────────┘  │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              Assessment Systems                      │   │
│  │  • Threat assessment (who to flee from)             │   │
│  │  • Prey assessment (who to hunt)                    │   │
│  │  • Food selection (optimal foraging)                │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## Files

| File | Purpose |
|------|---------|
| `server/src/BotAI.ts` | Core AI logic with state machine and steering behaviors |
| `server/src/BotManager.ts` | Bot lifecycle, spawning, and room management |
| `server/src/index.ts` | Integration with game loop |

## Bot AI System

### State Machine

Bots transition between behavioral states based on environmental assessment:

```typescript
enum BotState {
  IDLE,       // Default/waiting state
  FORAGING,   // Collecting food (primary activity)
  HUNTING,    // Chasing smaller players
  FLEEING,    // Escaping from larger players
  CIRCLING,   // Advanced: circling prey to trap them
  BOOSTING,   // Speed burst for escape or catch
}
```

**State Transitions:**

```
                    ┌──────────────┐
                    │    IDLE      │
                    └──────┬───────┘
                           │ (start)
                           ▼
    ┌─────────────────────────────────────────┐
    │              FORAGING                    │◄─────────┐
    │  (default behavior - collect food)      │          │
    └─────────────┬───────────────┬───────────┘          │
                  │               │                       │
     threat detected    prey available                    │
     (danger > 0.7)     (size advantage)                  │
                  │               │                       │
                  ▼               ▼                       │
        ┌─────────────┐  ┌─────────────┐                 │
        │   FLEEING   │  │   HUNTING   │                 │
        │ (escape!)   │  │ (chase!)    │                 │
        └──────┬──────┘  └──────┬──────┘                 │
               │                │                         │
               │ (safe/timeout) │ (target lost/killed)   │
               └────────────────┴─────────────────────────┘
```

### Steering Behaviors

Smooth, natural movement using classic steering algorithms:

#### 1. **Seek** - Move towards a target
```typescript
seek(from: Vec2, to: Vec2): Vec2 {
  return normalize(subtract(to, from));
}
```

#### 2. **Flee** - Move away from a threat
```typescript
flee(from: Vec2, threat: Vec2): Vec2 {
  return normalize(subtract(from, threat));
}
```

#### 3. **Pursue** - Predict and intercept moving target
```typescript
pursue(self, target): Vec2 {
  // Predict where target will be based on their velocity
  const predictionTime = distance / speed * config.predictionTime;
  const futurePos = target.position + target.velocity * predictionTime;
  return seek(self, futurePos);
}
```

#### 4. **Wander** - Exploration with smooth direction changes
```typescript
wander(self): Vec2 {
  // Smoothly change wander angle
  this.wanderAngle += (random() - 0.5) * 0.5;
  
  // Project wander circle ahead of bot
  const ahead = self.position + forward * 100;
  const wanderTarget = ahead + fromAngle(wanderAngle) * 50;
  return seek(self, wanderTarget);
}
```

#### 5. **Obstacle Avoidance** - Walls and body segments
```typescript
avoidWalls(self): Vec2 {
  const steering = { x: 0, y: 0 };
  const margin = 150;
  
  if (self.x < margin) steering.x += (margin - self.x) / margin;
  if (self.x > worldWidth - margin) steering.x -= ...
  // ... similar for y
  
  return steering;
}
```

### Threat & Prey Assessment

Bots continuously evaluate nearby players:

**Threat Assessment:**
```typescript
danger = (proximityFactor * 0.4) +   // How close they are
         (sizeFactor * 0.3) +         // How much bigger they are
         (approachFactor * 0.3);      // Are they heading towards us?
```

**Prey Assessment:**
```typescript
score = (proximityScore * 0.4) +      // How close they are
        (valueScore * 0.3) +          // How big they are (reward)
        (advantageScore * 0.3);       // Our size advantage
```

## Difficulty Levels

Four difficulty levels with distinct characteristics:

| Config | Easy | Medium | Hard | Expert |
|--------|------|--------|------|--------|
| Reaction Time | 500ms | 300ms | 150ms | 80ms |
| Aim Accuracy | 60% | 75% | 90% | 97% |
| Aggression | 20% | 40% | 60% | 80% |
| Awareness Radius | 300px | 450px | 600px | 800px |
| Boost Willingness | 10% | 30% | 50% | 70% |
| Hunt Threshold | 10 segs | 6 segs | 4 segs | 3 segs |
| Size Advantage to Hunt | 2.0x | 1.5x | 1.3x | 1.15x |
| Prediction Time | 0.1s | 0.2s | 0.35s | 0.5s |
| Movement Noise | 30% | 20% | 10% | 5% |

**Difficulty Distribution (default):**
- Easy: 30%
- Medium: 40%
- Hard: 25%
- Expert: 5%

## Bot Manager

### Room Population Balancing

Automatically adjusts bot count based on human players:

```typescript
// Target formula
targetBotCount = max(
  minBotsPerRoom,
  min(maxBotsPerRoom, targetPlayersPerRoom - humanPlayerCount)
)

// Example with defaults (min=2, max=6, target=5):
// 0 humans → 5 bots
// 2 humans → 3 bots
// 4 humans → 2 bots (min)
// 6+ humans → 2 bots (min)
```

### Bot Names

Thematic Japanese-inspired names:

```typescript
const BOT_NAMES = [
  // Fire/Light: 'Akari', 'Hikari', 'Hotaru', 'Hinata'
  // Spirit/Ghost: 'Yūrei', 'Obake', 'Tamashī', 'Kage'
  // Nature: 'Sakura', 'Momiji', 'Kiri', 'Mizu', 'Tsuki'
  // Lantern: 'Chōchin', 'Tōrō', 'Andon', 'Bonbori'
  // Mystical: 'Kami', 'Oni', 'Tengu', 'Kitsune'
];

const BOT_TITLES = ['', 'Lord ', 'Lady ', '小 ', '大 ', '🔥 ', '👻 ', '🏮 '];
```

## Configuration

Environment variables for customization:

```bash
# Enable/disable bots (default: true)
BOTS_ENABLED=true

# Bots per room
MIN_BOTS_PER_ROOM=2
MAX_BOTS_PER_ROOM=6

# Target player count (humans + bots)
TARGET_PLAYERS=5
```

## Integration with Game Loop

Bots are processed each tick alongside human players:

```typescript
function gameLoop(): void {
  for (const room of rooms) {
    // 1. Balance bot count (every 5 seconds)
    if (tick % 100 === 0) {
      botManager.balanceRoomBots(room.id, humanCount);
    }
    
    // 2. Update bot AI (decision making)
    botManager.updateBotAI(room.id, playerViews, food, deltaMs);
    
    // 3. Update bot movement (same physics as players)
    for (const bot of roomBots) {
      updateBotMovement(bot, deltaS);
      updateBotPositionHistory(bot);
      bot.bodySegments = calculateBotBodySegments(bot);
      handleBotBoostDrop(room, bot, deltaS);
    }
    
    // 4. Check collisions (bots vs players, bots vs bots)
    checkBotCollisionsInRoom(room, roomBots);
    
    // 5. Food collection
    checkBotFoodCollisions(room, roomBots);
    
    // 6. Include bots in snapshot (appear as players to clients)
    const snapshot = buildGameSnapshotForRoom(room, roomBots);
  }
}
```

## Client Transparency

**Bots appear as regular players to clients.** The client code doesn't need any modifications - bots are included in the player snapshot with:
- Unique IDs (`bot-{roomId}-{counter}`)
- Display names (from BOT_NAMES)
- Full player state (position, angle, body segments, score, kills)

## Performance Considerations

1. **Spatial Awareness**: Bots use limited awareness radius to avoid checking all players/food
2. **Decision Throttling**: AI decisions run at `reactionTime` intervals, not every tick
3. **Body Segment Sampling**: When avoiding bodies, sample every Nth segment for performance
4. **Grid Integration**: Bots are inserted into the spatial grid for collision detection

## Future Enhancements

Potential improvements for future versions:

1. **Behavior Trees** - More complex decision making with conditions and decorators
2. **Learning** - Adjust difficulty based on player skill
3. **Personality Traits** - Risk-averse vs aggressive bots
4. **Team Bots** - Coordinated hunting packs
5. **Tutorial Bots** - Special easy bots for new players
6. **Boss Bots** - Rare powerful bots with unique behaviors

## Testing

To test bots locally:

```bash
# Start server with bots enabled (default)
npm run dev:server

# Disable bots for testing
BOTS_ENABLED=false npm run dev:server

# More bots for stress testing
MIN_BOTS_PER_ROOM=5 MAX_BOTS_PER_ROOM=10 npm run dev:server
```

## Debug Information

Press F3 in-game to see debug overlay. Bot-related stats:
- Other Players count (includes bots)
- Scoreboard shows bot names alongside human players

Bot deaths and respawns are logged to server console:
```
🤖 Bot created: Hikari (medium) in room SAGE-43
[SAGE-43] Bot Hikari died: head_collision (killed by Player1)
🤖 Bot respawned: Hikari
```

