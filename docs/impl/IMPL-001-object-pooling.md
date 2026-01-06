# IMPL-001: Object Pooling

> Eliminate GC stuttering by reusing game objects

**Priority:** 🔴 CRITICAL  
**Effort:** 2 days  
**Impact:** Eliminates frame drops from garbage collection

---

## Problem

Every frame, the game creates and destroys hundreds of objects:
- Food sprites (created when food spawns, destroyed when collected)
- Body segment sprites (created as players grow)
- Particle effects
- Temporary calculations

JavaScript's garbage collector pauses the game to clean up, causing **visible stuttering**.

---

## Solution

Create object pools that **reuse** objects instead of creating/destroying them.

---

## Implementation Guide

### Step 1: Create Generic Pool Class

Create `client/src/pools/Pool.ts`:

```typescript
export class Pool<T> {
  private available: T[] = [];
  private active: Set<T> = new Set();
  private factory: () => T;
  private reset: (item: T) => void;
  
  constructor(
    factory: () => T,
    reset: (item: T) => void,
    initialSize: number = 100
  ) {
    this.factory = factory;
    this.reset = reset;
    
    // Pre-allocate
    for (let i = 0; i < initialSize; i++) {
      this.available.push(factory());
    }
  }
  
  acquire(): T {
    let item: T;
    
    if (this.available.length > 0) {
      item = this.available.pop()!;
    } else {
      item = this.factory();
    }
    
    this.active.add(item);
    return item;
  }
  
  release(item: T): void {
    if (!this.active.has(item)) return;
    
    this.active.delete(item);
    this.reset(item);
    this.available.push(item);
  }
  
  releaseAll(): void {
    for (const item of this.active) {
      this.reset(item);
      this.available.push(item);
    }
    this.active.clear();
  }
  
  get activeCount(): number {
    return this.active.size;
  }
  
  get availableCount(): number {
    return this.available.length;
  }
}
```

### Step 2: Create Sprite Pool

Create `client/src/pools/SpritePool.ts`:

```typescript
import Phaser from 'phaser';
import { Pool } from './Pool';

export class SpritePool {
  private pool: Pool<Phaser.GameObjects.Sprite>;
  private scene: Phaser.Scene;
  
  constructor(
    scene: Phaser.Scene,
    textureKey: string,
    frame?: string | number,
    initialSize: number = 100
  ) {
    this.scene = scene;
    
    this.pool = new Pool<Phaser.GameObjects.Sprite>(
      // Factory: create new sprite
      () => {
        const sprite = scene.add.sprite(0, 0, textureKey, frame);
        sprite.setActive(false);
        sprite.setVisible(false);
        return sprite;
      },
      // Reset: hide and reset sprite
      (sprite) => {
        sprite.setActive(false);
        sprite.setVisible(false);
        sprite.setPosition(0, 0);
        sprite.setScale(1);
        sprite.setAlpha(1);
        sprite.setTint(0xffffff);
        sprite.setAngle(0);
      },
      initialSize
    );
  }
  
  acquire(x: number, y: number): Phaser.GameObjects.Sprite {
    const sprite = this.pool.acquire();
    sprite.setPosition(x, y);
    sprite.setActive(true);
    sprite.setVisible(true);
    return sprite;
  }
  
  release(sprite: Phaser.GameObjects.Sprite): void {
    this.pool.release(sprite);
  }
  
  releaseAll(): void {
    this.pool.releaseAll();
  }
}
```

### Step 3: Create Food Pool

Create `client/src/pools/FoodPool.ts`:

```typescript
import Phaser from 'phaser';
import { SpritePool } from './SpritePool';
import type { Hitodama } from '../../../shared/types';

interface FoodVisual {
  id: string;
  sprite: Phaser.GameObjects.Sprite;
  glowSprite?: Phaser.GameObjects.Sprite;
}

export class FoodPool {
  private corePool: SpritePool;
  private glowPool: SpritePool;
  private activeFood: Map<string, FoodVisual> = new Map();
  private scene: Phaser.Scene;
  
  constructor(scene: Phaser.Scene, maxFood: number = 200) {
    this.scene = scene;
    
    // When using texture atlas: 'toro', 'ghost'
    // Before atlas: 'ghost'
    this.corePool = new SpritePool(scene, 'ghost', undefined, maxFood);
    this.glowPool = new SpritePool(scene, 'ghost', undefined, maxFood);
  }
  
  spawn(food: Hitodama): void {
    if (this.activeFood.has(food.id)) return;
    
    const sprite = this.corePool.acquire(food.x, food.y);
    sprite.setScale(food.radius / 20); // Adjust based on your sprite size
    
    // Tint based on value (golden vs normal)
    const isGolden = food.value > 1;
    sprite.setTint(isGolden ? 0xffaa00 : 0x44ffcc);
    
    // Optional: Add glow sprite behind
    let glowSprite: Phaser.GameObjects.Sprite | undefined;
    if (isGolden) {
      glowSprite = this.glowPool.acquire(food.x, food.y);
      glowSprite.setScale(sprite.scale * 1.5);
      glowSprite.setAlpha(0.3);
      glowSprite.setTint(0xffaa00);
      glowSprite.setDepth(sprite.depth - 1);
    }
    
    this.activeFood.set(food.id, { id: food.id, sprite, glowSprite });
  }
  
  update(food: Hitodama): void {
    const visual = this.activeFood.get(food.id);
    if (!visual) {
      this.spawn(food);
      return;
    }
    
    visual.sprite.setPosition(food.x, food.y);
    if (visual.glowSprite) {
      visual.glowSprite.setPosition(food.x, food.y);
    }
  }
  
  remove(foodId: string): void {
    const visual = this.activeFood.get(foodId);
    if (!visual) return;
    
    this.corePool.release(visual.sprite);
    if (visual.glowSprite) {
      this.glowPool.release(visual.glowSprite);
    }
    this.activeFood.delete(foodId);
  }
  
  syncWithServer(serverFood: Hitodama[]): void {
    const serverIds = new Set(serverFood.map(f => f.id));
    
    // Remove food that no longer exists
    for (const [id] of this.activeFood) {
      if (!serverIds.has(id)) {
        this.remove(id);
      }
    }
    
    // Update or spawn food
    for (const food of serverFood) {
      this.update(food);
    }
  }
  
  clear(): void {
    for (const [id] of this.activeFood) {
      this.remove(id);
    }
  }
}
```

### Step 4: Create Body Segment Pool

Create `client/src/pools/SegmentPool.ts`:

```typescript
import Phaser from 'phaser';
import { SpritePool } from './SpritePool';
import type { BodySegment } from '../../../shared/types';

export class SegmentPool {
  private pool: SpritePool;
  private activeSegments: Phaser.GameObjects.Sprite[] = [];
  private scene: Phaser.Scene;
  
  constructor(scene: Phaser.Scene, maxSegments: number = 500) {
    this.scene = scene;
    this.pool = new SpritePool(scene, 'ghost', undefined, maxSegments);
  }
  
  updateSegments(
    segments: BodySegment[],
    isLocalPlayer: boolean,
    maxVisualSegments: number = 150
  ): void {
    // Release old segments
    for (const sprite of this.activeSegments) {
      this.pool.release(sprite);
    }
    this.activeSegments = [];
    
    // LOD: Only render up to maxVisualSegments
    const step = segments.length > maxVisualSegments 
      ? segments.length / maxVisualSegments 
      : 1;
    
    for (let i = 0; i < segments.length && this.activeSegments.length < maxVisualSegments; i += step) {
      const idx = Math.floor(i);
      const segment = segments[idx];
      
      const sprite = this.pool.acquire(segment.x, segment.y);
      
      // Calculate visual properties based on position in body
      const progress = idx / segments.length;
      const scale = 0.5 - progress * 0.3; // Larger at head, smaller at tail
      const alpha = 0.9 - progress * 0.5; // Fade toward tail
      
      sprite.setScale(scale);
      sprite.setAlpha(alpha);
      
      // Color based on player
      const tint = isLocalPlayer ? 0x44ffcc : 0xff6666;
      sprite.setTint(tint);
      
      this.activeSegments.push(sprite);
    }
  }
  
  clear(): void {
    for (const sprite of this.activeSegments) {
      this.pool.release(sprite);
    }
    this.activeSegments = [];
  }
}
```

### Step 5: Integrate into GameScene

Modify `client/src/scenes/GameScene.ts`:

```typescript
import { FoodPool } from '../pools/FoodPool';
import { SegmentPool } from '../pools/SegmentPool';

// In GameScene class:
private foodPool!: FoodPool;
private localPlayerSegments!: SegmentPool;
private otherPlayerSegments: Map<string, SegmentPool> = new Map();

create(): void {
  // ... existing code ...
  
  // Initialize pools
  this.foodPool = new FoodPool(this, 300);
  this.localPlayerSegments = new SegmentPool(this, 500);
}

// Replace food rendering with pool
private renderFood(foodItems: Hitodama[]): void {
  this.foodPool.syncWithServer(foodItems);
}

// Replace segment rendering with pool
private renderPlayerBody(playerId: string, segments: BodySegment[], isLocal: boolean): void {
  let pool: SegmentPool;
  
  if (isLocal) {
    pool = this.localPlayerSegments;
  } else {
    if (!this.otherPlayerSegments.has(playerId)) {
      this.otherPlayerSegments.set(playerId, new SegmentPool(this, 200));
    }
    pool = this.otherPlayerSegments.get(playerId)!;
  }
  
  pool.updateSegments(segments, isLocal);
}

// Clean up when player leaves
private removePlayer(playerId: string): void {
  const pool = this.otherPlayerSegments.get(playerId);
  if (pool) {
    pool.clear();
    this.otherPlayerSegments.delete(playerId);
  }
}
```

---

## Testing Checklist

- [ ] No visible stuttering when many food items spawn
- [ ] No stuttering during large death drops (100+ food)
- [ ] Smooth rendering when player has 200+ body segments
- [ ] Memory usage stays stable over 10+ minutes of play
- [ ] Pool counts remain reasonable (not growing indefinitely)

---

## Performance Verification

Add to your debug display:
```typescript
console.log('Food pool:', this.foodPool.activeCount, '/', this.foodPool.totalCount);
console.log('Segment pool:', this.localPlayerSegments.activeCount);
```

Before pooling: GC pauses of 10-50ms every few seconds
After pooling: No GC pauses during normal gameplay

---

## AI Implementation Prompt

```
Implement object pooling for Tōrō game following docs/impl/IMPL-001-object-pooling.md.

Current state:
- GameScene.ts creates/destroys sprites each frame
- Food uses individual sprite creation in updateFood()
- Body segments created in renderOtherPlayer() and renderLocalPlayer()

Tasks:
1. Create Pool.ts generic pool class
2. Create SpritePool.ts for Phaser sprites
3. Create FoodPool.ts for food items
4. Create SegmentPool.ts for body segments
5. Integrate pools into GameScene.ts
6. Test that no GC stuttering occurs

Focus on maintaining the existing visual appearance while eliminating object allocation.
```


