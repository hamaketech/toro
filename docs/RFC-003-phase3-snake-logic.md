# RFC-003: Phase 3 - Snake Logic (The Procession)

**Status:** Implemented ✅  
**Author:** Development Team  
**Created:** 2026-01-02  
**Phase:** 3 - The Snake Logic (The Hard Part)  
**Depends On:** RFC-002 (Phase 2 Multiplayer Movement)

---

## 1. Summary

Phase 3 implements the core snake-like mechanics that define Tōrō gameplay:
1. **Body Segments (The Procession)** - Spirits that follow the Lantern head
2. **Food System (Hitodama)** - Collectible souls that grow the procession
3. **Magnetic Pull** - Food is attracted to nearby players
4. **Boost Drop** - Boosting drops body segments as food (risk/reward)

---

## 2. Design Goals

From the guideline:
- Body follows the head using **position history trail buffering**
- Food (Hitodama) has **magnetic pull** toward the Lantern
- Collecting food increases **score + body length**
- Boosting **drops mass** as pellets (shrink to speed up)

---

## 3. Technical Architecture

### 3.1 Position History System

```
Head Position History (Ring Buffer)
┌────────────────────────────────────────────────────────┐
│ [0]  [1]  [2]  [3]  [4]  [5]  [6]  [7]  [8]  ...       │
│  ●────●────●────●────●────●────●────●────●            │
│ NOW                                              PAST  │
└────────────────────────────────────────────────────────┘
                    ↓
              Walk along trail
              Place segment every 25px
                    ↓
┌────────────────────────────────────────────────────────┐
│        Body Segments (Derived from History)            │
│    🏮 ─── 👻 ─── 👻 ─── 👻 ─── 👻                      │
│   HEAD    [0]    [1]    [2]    [3]                     │
└────────────────────────────────────────────────────────┘
```

### 3.2 Food Magnetism

```
          ┌─────────────────────────────────────┐
          │      MAGNET_RADIUS (100px)          │
          │                                     │
          │         ┌───────────────┐           │
          │         │  Pull Zone    │           │
          │         │               │           │
          │         │    🏮 Player  │           │
          │         │               │           │
          │    ✨───┼───────────────┘           │
          │   Food  │                           │
          │         │                           │
          └─────────┼───────────────────────────┘
                    │
         Pull strength = (1 - dist/radius)²
         Quadratic falloff for smooth feel
```

### 3.3 Boost Drop Mechanic

```
Normal Movement:
  🏮 ─── 👻 ─── 👻 ─── 👻 ─── 👻
  No mass loss

Boosting (SPACE / Click):
  🏮 ─── 👻 ─── 👻 ─── 👻        ✨ (dropped)
  Speed +50%, drops 2 segments/sec as food pellets
  
  The tail shrinks, pellets spawn at tail position
  Other players can collect your dropped pellets!
```

---

## 4. Implementation Details

### 4.1 Shared Constants (`shared/types.ts`)

```typescript
export const GAME_CONSTANTS = {
  // Body segment configuration
  BODY_SEGMENT_SPACING: 25,      // Pixels between segments
  POSITION_HISTORY_RESOLUTION: 2, // History points per spacing
  
  // Food configuration
  FOOD_MAGNET_RADIUS: 100,       // Pull range in pixels
  FOOD_MAGNET_STRENGTH: 150,     // Pull speed at max
  FOOD_BASE_VALUE: 1,            // Score per food
  FOOD_RADIUS: 8,                // Visual size
  GROWTH_PER_FOOD: 1,            // Body growth per food value
  
  // Boost configuration
  BOOST_DROP_RATE: 2,            // Segments lost per second
  MIN_BODY_LENGTH: 0,            // Can't shrink below this
  STARTING_BODY_LENGTH: 3,       // Initial body segments
  
  // World configuration
  MAX_FOOD_COUNT: 200,           // Max food in world
  FOOD_SPAWN_RATE: 3,            // Spawn per tick when below max
  DROPPED_PELLET_VALUE: 1,       // Value of dropped segments
};
```

### 4.2 Server Position History

```typescript
interface PositionRecord {
  x: number;
  y: number;
  timestamp: number;
}

interface ServerPlayerState {
  // ... existing fields
  positionHistory: PositionRecord[];  // Ring buffer
  boostDropAccumulator: number;       // Fractional drops
}

function updatePositionHistory(player) {
  // Add current position to front
  player.positionHistory.unshift({
    x: player.x,
    y: player.y,
    timestamp: Date.now(),
  });
  
  // Trim to needed length
  const maxLength = player.targetLength * SEGMENT_SPACING * RESOLUTION;
  while (player.positionHistory.length > maxLength) {
    player.positionHistory.pop();
  }
}
```

### 4.3 Body Segment Calculation

```typescript
function calculateBodySegments(player): BodySegment[] {
  const segments = [];
  let distanceAccumulated = 0;
  let segmentIndex = 0;
  
  // Walk the position history
  for (let i = 1; i < history.length; i++) {
    const prev = history[i - 1];
    const curr = history[i];
    
    // Calculate distance of this history segment
    const dx = prev.x - curr.x;
    const dy = prev.y - curr.y;
    const segDist = Math.sqrt(dx*dx + dy*dy);
    
    distanceAccumulated += segDist;
    
    // Place a segment every SPACING pixels
    while (distanceAccumulated >= SPACING && segmentIndex < targetLength) {
      // Interpolate position along the segment
      const overshoot = distanceAccumulated - SPACING;
      const t = overshoot / segDist;
      
      segments.push({
        x: curr.x + dx * t,
        y: curr.y + dy * t,
      });
      
      distanceAccumulated -= SPACING;
      segmentIndex++;
    }
  }
  
  return segments;
}
```

### 4.4 Food Magnetism

```typescript
function updateFoodMagnetism(deltaS: number) {
  for (const player of players) {
    for (const food of foods) {
      const dx = player.x - food.x;
      const dy = player.y - food.y;
      const dist = Math.sqrt(dx*dx + dy*dy);
      
      if (dist < MAGNET_RADIUS && dist > 0) {
        // Quadratic falloff for smooth feel
        const pullFactor = 1 - (dist / MAGNET_RADIUS);
        const pullStrength = MAGNET_STRENGTH * pullFactor * pullFactor;
        
        // Move food toward player
        food.x += (dx / dist) * pullStrength * deltaS;
        food.y += (dy / dist) * pullStrength * deltaS;
      }
    }
  }
}
```

### 4.5 Boost Drop

```typescript
function handleBoostDrop(player, deltaS) {
  if (!player.input.boosting || player.targetLength <= MIN_LENGTH) {
    return;
  }
  
  // Accumulate fractional drops
  player.boostDropAccumulator += BOOST_DROP_RATE * deltaS;
  
  // Drop segment when accumulator reaches 1
  while (player.boostDropAccumulator >= 1 && player.targetLength > MIN_LENGTH) {
    player.boostDropAccumulator -= 1;
    player.targetLength--;
    
    // Spawn food at tail position
    const tail = player.bodySegments[player.bodySegments.length - 1];
    if (tail) {
      spawnFood(tail.x, tail.y, DROPPED_PELLET_VALUE);
    }
  }
}
```

---

## 5. Client Rendering

### 5.1 Body Segment Opacity Gradient

Segments fade from head to tail for visual depth:

```typescript
function calculateSegmentOpacity(index, totalSegments) {
  if (totalSegments <= 1) return 1;
  const t = index / (totalSegments - 1);
  return lerp(1.0, 0.4, t);  // 100% → 40% opacity
}
```

### 5.2 Food Pulse Animation

Food items pulse gently to feel alive:

```typescript
function updateFoodVisual(food, time) {
  const pulse = 1 + Math.sin(time * 2 + food.x * 0.01) * 0.15;
  food.glow.setScale(pulse);
  food.core.setScale(pulse * 0.9);
}
```

---

## 6. Updated Types

### PlayerState
```typescript
interface PlayerState {
  // ... existing fields
  bodySegments: BodySegment[];  // Array of {x, y}
  targetLength: number;         // NEW: target body length
}
```

### GameSnapshot
```typescript
interface GameSnapshot {
  players: Record<string, PlayerState>;
  food: FoodState;              // NEW: all food items
  serverTime: number;
  tick: number;
}

interface FoodState {
  items: Hitodama[];
}

interface Hitodama {
  id: string;
  x: number;
  y: number;
  value: number;
  radius: number;
}
```

### New Event
```typescript
// Sent when food is collected (for sound effects)
foodCollected: (foodId: string, playerId: string) => void;
```

---

## 7. Visual Configuration

New config values in `client/src/config.ts`:

```typescript
BODY: {
  SEGMENT_RADIUS: 12,
  SEGMENT_GLOW_RADIUS: 18,
  TAIL_OPACITY_MIN: 0.4,
},

FOOD: {
  GLOW_MULTIPLIER: 1.8,
  PULSE_SPEED: 2,
  PULSE_AMOUNT: 0.15,
},

COLORS: {
  // Local player body
  SPIRIT_GLOW: 0x88ccff,
  SPIRIT_CORE: 0xaaddff,
  // Other player body
  OTHER_SPIRIT_GLOW: 0xff8888,
  OTHER_SPIRIT_CORE: 0xffbbbb,
  // Food
  HITODAMA_GLOW: 0x66ffcc,
  HITODAMA_CORE: 0xaaffee,
}
```

---

## 8. Verification Checklist

### ✅ Completed

- [x] Position history tracks head movement
- [x] Body segments calculated from history trail
- [x] Segments spaced at 25px intervals
- [x] Body grows when eating food
- [x] Food spawns randomly in world
- [x] Food respawns when count is low
- [x] Food has magnetic pull toward players
- [x] Quadratic falloff for smooth magnetism
- [x] Boosting drops body segments as food
- [x] Dropped segments spawn at tail position
- [x] Body segments render with opacity gradient
- [x] Food renders with pulse animation
- [x] Food collection updates score
- [x] Body segments interpolate smoothly
- [x] Food interpolates for smooth movement
- [x] Disconnect drops all segments as food

### 🔲 Deferred to Phase 4

- [ ] Head vs Body collision (death)
- [ ] World boundary death
- [ ] Head vs Head collision
- [ ] Death explosion (drop all food)
- [ ] Scoreboard

---

## 9. Testing Scenarios

### Scenario 1: Body Growth
1. Start game (3 starting segments)
2. Collect food items
3. Verify body grows with each collection
4. Verify score increases

### Scenario 2: Magnetic Pull
1. Move near food items
2. Verify they drift toward you
3. Closer food should pull faster
4. Food outside radius should not move

### Scenario 3: Boost Drop
1. Collect some food to grow body
2. Hold Space to boost
3. Verify body shrinks
4. Verify pellets appear at tail
5. Verify other players can collect dropped pellets

### Scenario 4: Multiplayer
1. Open two browser tabs
2. Verify both players see each other's body segments
3. Verify segments interpolate smoothly
4. Verify food state is synchronized

---

## 10. Performance Notes

- Position history is capped to prevent memory growth
- Food count is limited to 200 items
- Body segment calculation is O(history_length)
- Food iteration is O(players × food_count)

For 10 players with 50 segments each and 200 food items:
- History: ~100 positions × 10 players = 1000 records
- Food checks: 10 × 200 = 2000 distance calculations per tick

This is well within acceptable bounds for a 20Hz tick rate.

---

## 11. Next Steps (Phase 4)

1. Head vs Body collision detection
2. World boundary collision (instant death)
3. Head vs Head collision (both die or smaller dies)
4. Death state handling
5. Death explosion (drop all body as high-value food)
6. Scoreboard UI

---

*End of RFC-003*

