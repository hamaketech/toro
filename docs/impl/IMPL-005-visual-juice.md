# IMPL-005: Visual Juice System

> Particles, popups, and effects that make actions satisfying

**Priority:** 🟡 HIGH  
**Effort:** 2 days  
**Impact:** Transforms "functional" into "feels like a real game"

---

## Problem

Current state:
- Food disappears instantly when collected (no feedback)
- Players just vanish on death (anticlimactic)
- No score popups (growth feels abstract)
- No visual distinction for kills vs deaths

---

## Solution

Add "juice" — visual and audio feedback that makes every action feel impactful:

1. **Score Popups** - Floating "+1" numbers on food collection
2. **Collection Particles** - Sparkle burst when eating
3. **Death Explosion** - Dramatic particle burst + screen shake
4. **Kill Notification** - Center-screen "You eliminated X!"
5. **Boost Trail** - Visual indicator of speed

---

## Implementation Guide

### Step 1: Score Popup System

Create `client/src/effects/ScorePopup.ts`:

```typescript
import Phaser from 'phaser';

interface PopupConfig {
  x: number;
  y: number;
  value: number;
  isGolden: boolean;
}

export class ScorePopupManager {
  private scene: Phaser.Scene;
  private pool: Phaser.GameObjects.Text[] = [];
  private poolSize = 50;
  
  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.initPool();
  }
  
  private initPool(): void {
    for (let i = 0; i < this.poolSize; i++) {
      const text = this.scene.add.text(0, 0, '', {
        fontSize: '20px',
        fontFamily: 'Arial Black, Arial',
        color: '#44ffcc',
        stroke: '#000000',
        strokeThickness: 4,
      });
      text.setOrigin(0.5);
      text.setDepth(500);
      text.setVisible(false);
      this.pool.push(text);
    }
  }
  
  show(config: PopupConfig): void {
    // Find available text from pool
    const text = this.pool.find(t => !t.visible);
    if (!text) return;
    
    // Configure appearance
    text.setText(`+${config.value}`);
    text.setPosition(config.x, config.y);
    text.setVisible(true);
    text.setAlpha(1);
    text.setScale(config.isGolden ? 1.5 : 1);
    text.setColor(config.isGolden ? '#FFD700' : '#44FFCC');
    
    // Animate
    this.scene.tweens.add({
      targets: text,
      y: config.y - 50,
      alpha: 0,
      scale: text.scale * 0.5,
      duration: 800,
      ease: 'Quad.easeOut',
      onComplete: () => {
        text.setVisible(false);
      }
    });
  }
  
  // Bulk show for death drops
  showMultiple(items: PopupConfig[], delay: number = 50): void {
    items.forEach((config, index) => {
      this.scene.time.delayedCall(index * delay, () => {
        this.show(config);
      });
    });
  }
}
```

### Step 2: Collection Particle Effect

Create `client/src/effects/CollectionEffect.ts`:

```typescript
import Phaser from 'phaser';

export class CollectionEffect {
  private scene: Phaser.Scene;
  private emitters: Phaser.GameObjects.Particles.ParticleEmitter[] = [];
  
  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }
  
  play(x: number, y: number, isGolden: boolean): void {
    // Create particle config
    const color = isGolden ? 0xFFD700 : 0x44FFCC;
    const quantity = isGolden ? 12 : 6;
    const speed = isGolden ? 150 : 100;
    
    // Using Phaser 3.60+ particle API
    const particles = this.scene.add.particles(x, y, 'toro', {
      frame: 'ghost', // Use small particle frame from atlas
      speed: { min: speed * 0.5, max: speed },
      scale: { start: 0.3, end: 0 },
      alpha: { start: 1, end: 0 },
      lifespan: 400,
      quantity: quantity,
      angle: { min: 0, max: 360 },
      tint: color,
      blendMode: 'ADD',
      emitting: false,
    });
    
    // Emit once
    particles.explode(quantity);
    
    // Auto-cleanup
    this.scene.time.delayedCall(500, () => {
      particles.destroy();
    });
  }
  
  // Simpler version without particle emitter (fallback)
  playSimple(x: number, y: number, isGolden: boolean): void {
    const count = isGolden ? 8 : 4;
    const color = isGolden ? 0xFFD700 : 0x44FFCC;
    
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      const speed = 50 + Math.random() * 50;
      
      const particle = this.scene.add.circle(x, y, 3, color);
      particle.setAlpha(0.8);
      particle.setDepth(400);
      
      this.scene.tweens.add({
        targets: particle,
        x: x + Math.cos(angle) * speed,
        y: y + Math.sin(angle) * speed,
        alpha: 0,
        scale: 0.5,
        duration: 400,
        ease: 'Quad.easeOut',
        onComplete: () => particle.destroy()
      });
    }
  }
}
```

### Step 3: Death Explosion Effect

Create `client/src/effects/DeathEffect.ts`:

```typescript
import Phaser from 'phaser';

export class DeathEffect {
  private scene: Phaser.Scene;
  
  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }
  
  play(x: number, y: number, bodyLength: number, isLocalPlayer: boolean): void {
    // Scale intensity based on player size
    const intensity = Math.min(1 + bodyLength / 50, 3);
    
    // 1. Screen shake (stronger for local player death)
    if (isLocalPlayer) {
      this.scene.cameras.main.shake(300, 0.015 * intensity);
    } else {
      // Smaller shake for watching others die
      this.scene.cameras.main.shake(150, 0.005 * intensity);
    }
    
    // 2. Screen flash (local player only)
    if (isLocalPlayer) {
      const flash = this.scene.add.rectangle(
        this.scene.cameras.main.centerX,
        this.scene.cameras.main.centerY,
        this.scene.cameras.main.width * 2,
        this.scene.cameras.main.height * 2,
        0xff0000,
        0.3
      );
      flash.setScrollFactor(0);
      flash.setDepth(2000);
      
      this.scene.tweens.add({
        targets: flash,
        alpha: 0,
        duration: 300,
        onComplete: () => flash.destroy()
      });
    }
    
    // 3. Particle explosion
    const particleCount = Math.min(30 + bodyLength, 100);
    
    const particles = this.scene.add.particles(x, y, 'toro', {
      frame: 'ghost',
      speed: { min: 100, max: 300 * intensity },
      scale: { start: 0.8, end: 0.1 },
      alpha: { start: 1, end: 0 },
      lifespan: 1000,
      quantity: particleCount,
      angle: { min: 0, max: 360 },
      tint: [0x44FFCC, 0xFFD700, 0xFFFFFF],
      blendMode: 'ADD',
      emitting: false,
    });
    
    particles.explode(particleCount);
    
    // 4. Shockwave ring (for large players)
    if (bodyLength > 20) {
      const ring = this.scene.add.circle(x, y, 10, 0xffffff, 0);
      ring.setStrokeStyle(3, 0x44FFCC, 0.8);
      ring.setDepth(399);
      
      this.scene.tweens.add({
        targets: ring,
        radius: 150 * intensity,
        alpha: 0,
        duration: 500,
        ease: 'Quad.easeOut',
        onComplete: () => ring.destroy()
      });
    }
    
    // Cleanup particles
    this.scene.time.delayedCall(1200, () => {
      particles.destroy();
    });
  }
}
```

### Step 4: Kill Notification

Create `client/src/effects/KillNotification.ts`:

```typescript
import Phaser from 'phaser';

export class KillNotification {
  private scene: Phaser.Scene;
  private container: Phaser.GameObjects.Container | null = null;
  
  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }
  
  showKill(victimName: string): void {
    // Remove existing notification
    if (this.container) {
      this.container.destroy();
    }
    
    const centerX = this.scene.cameras.main.centerX;
    const centerY = this.scene.cameras.main.centerY - 100;
    
    // Create container for notification
    this.container = this.scene.add.container(centerX, centerY);
    this.container.setScrollFactor(0);
    this.container.setDepth(1000);
    
    // Skull emoji or icon
    const icon = this.scene.add.text(0, 0, '☠️', {
      fontSize: '48px',
    }).setOrigin(0.5);
    
    // Kill text
    const text = this.scene.add.text(0, 50, `You eliminated ${victimName}!`, {
      fontSize: '28px',
      fontFamily: 'Arial Black, Arial',
      color: '#FFD700',
      stroke: '#000000',
      strokeThickness: 4,
    }).setOrigin(0.5);
    
    this.container.add([icon, text]);
    
    // Animate in
    this.container.setAlpha(0);
    this.container.setScale(0.5);
    
    this.scene.tweens.add({
      targets: this.container,
      alpha: 1,
      scale: 1,
      duration: 200,
      ease: 'Back.easeOut',
      onComplete: () => {
        // Hold then fade out
        this.scene.time.delayedCall(1500, () => {
          if (this.container) {
            this.scene.tweens.add({
              targets: this.container,
              alpha: 0,
              y: centerY - 50,
              duration: 300,
              onComplete: () => {
                this.container?.destroy();
                this.container = null;
              }
            });
          }
        });
      }
    });
  }
  
  showDeath(killerName?: string): void {
    const centerX = this.scene.cameras.main.centerX;
    const centerY = this.scene.cameras.main.centerY;
    
    const message = killerName 
      ? `Eliminated by ${killerName}` 
      : 'You died!';
    
    const text = this.scene.add.text(centerX, centerY - 50, message, {
      fontSize: '36px',
      fontFamily: 'Arial Black, Arial',
      color: '#FF4444',
      stroke: '#000000',
      strokeThickness: 5,
    }).setOrigin(0.5);
    
    text.setScrollFactor(0);
    text.setDepth(1001);
    text.setAlpha(0);
    
    this.scene.tweens.add({
      targets: text,
      alpha: 1,
      duration: 200,
      yoyo: true,
      hold: 2000,
      onComplete: () => text.destroy()
    });
  }
}
```

### Step 5: Integrate into GameScene

```typescript
import { ScorePopupManager } from '../effects/ScorePopup';
import { CollectionEffect } from '../effects/CollectionEffect';
import { DeathEffect } from '../effects/DeathEffect';
import { KillNotification } from '../effects/KillNotification';

class GameScene extends Phaser.Scene {
  private scorePopups!: ScorePopupManager;
  private collectionEffect!: CollectionEffect;
  private deathEffect!: DeathEffect;
  private killNotification!: KillNotification;
  
  create(): void {
    // ... existing code ...
    
    // Initialize effects
    this.scorePopups = new ScorePopupManager(this);
    this.collectionEffect = new CollectionEffect(this);
    this.deathEffect = new DeathEffect(this);
    this.killNotification = new KillNotification(this);
    
    // Listen for events
    this.socket.on('foodCollected', (foodId: string, playerId: string) => {
      const food = this.getFoodById(foodId);
      if (food && playerId === this.playerId) {
        // Show popup and particles for local player
        this.scorePopups.show({
          x: food.x,
          y: food.y,
          value: food.value,
          isGolden: food.value > 1,
        });
        this.collectionEffect.play(food.x, food.y, food.value > 1);
      }
    });
    
    this.socket.on('playerDied', (event: DeathEvent) => {
      const isLocalPlayer = event.playerId === this.playerId;
      const isLocalKiller = event.killerId === this.playerId;
      
      // Play death explosion
      this.deathEffect.play(
        event.x,
        event.y,
        event.foodDropped,
        isLocalPlayer
      );
      
      // Show notifications
      if (isLocalPlayer) {
        this.killNotification.showDeath(event.killerName);
      } else if (isLocalKiller) {
        this.killNotification.showKill(event.killerName || 'Unknown');
      }
    });
  }
}
```

---

## Performance Considerations

- Use object pooling for score popups (included in implementation)
- Limit particle count based on device capability
- Disable particles on low quality setting (IMPL-007)
- Use simple circle particles as fallback

---

## Testing Checklist

- [ ] Score popups appear on food collection
- [ ] Golden food has larger, yellow popups
- [ ] Collection particles burst from food position
- [ ] Death explosion plays with screen shake
- [ ] Kill notification appears when you eliminate someone
- [ ] Death notification shows killer name
- [ ] Effects don't cause frame drops on mobile
- [ ] Effects are pooled/reused properly

---

## AI Implementation Prompt

```
Implement visual juice system for Tōrō following docs/impl/IMPL-005-visual-juice.md.

Current state:
- Food just disappears when collected
- Players vanish on death
- No visual feedback for any actions

Tasks:
1. Create ScorePopupManager with object pooling
2. Create CollectionEffect for food collection particles
3. Create DeathEffect with explosion and screen shake
4. Create KillNotification for kill/death messages
5. Integrate all effects into GameScene
6. Connect to existing socket events (foodCollected, playerDied)

Focus on making actions feel satisfying and impactful.
Use Phaser tweens and particles.
Pool objects to avoid GC issues.
```

