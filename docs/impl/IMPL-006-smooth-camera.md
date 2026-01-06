# IMPL-006: Smooth Camera System

> Camera with lookahead, smooth follow, and dynamic zoom

**Priority:** 🟡 HIGH  
**Effort:** 1 day  
**Impact:** Dramatically improves "game feel" — camera feels floaty, not robotic

---

## Problem

Current camera:
- Rigidly follows player position
- No lookahead (can't see where you're going)
- Fixed zoom regardless of player size
- Feels mechanical and unpolished

---

## Solution

Professional camera with:
1. **Smooth follow** with velocity-based easing
2. **Lookahead** toward movement direction
3. **Dynamic zoom** based on player size
4. **Gentle bob** for ambient motion

---

## Implementation Guide

### Step 1: Create SmoothCamera Class

Create `client/src/systems/SmoothCamera.ts`:

```typescript
import Phaser from 'phaser';

interface CameraConfig {
  // How fast camera catches up (0-1, lower = smoother)
  followSpeed: number;
  // How far ahead to look based on movement
  lookaheadDistance: number;
  // How fast lookahead adjusts
  lookaheadSpeed: number;
  // Zoom range
  minZoom: number;
  maxZoom: number;
  // Size thresholds for zoom
  minSizeForZoom: number;
  maxSizeForZoom: number;
}

const DEFAULT_CONFIG: CameraConfig = {
  followSpeed: 0.08,
  lookaheadDistance: 120,
  lookaheadSpeed: 0.05,
  minZoom: 0.7,
  maxZoom: 1.1,
  minSizeForZoom: 5,
  maxSizeForZoom: 200,
};

export class SmoothCamera {
  private camera: Phaser.Cameras.Scene2D.Camera;
  private config: CameraConfig;
  
  // Current camera state
  private currentX = 0;
  private currentY = 0;
  private currentZoom = 1.0;
  
  // Target state
  private targetX = 0;
  private targetY = 0;
  private targetZoom = 1.0;
  
  // Velocity for damping
  private velocityX = 0;
  private velocityY = 0;
  
  // Lookahead
  private lookaheadX = 0;
  private lookaheadY = 0;
  
  constructor(camera: Phaser.Cameras.Scene2D.Camera, config?: Partial<CameraConfig>) {
    this.camera = camera;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }
  
  /**
   * Update camera position and zoom
   * Call this every frame with player state
   */
  update(
    playerX: number,
    playerY: number,
    playerAngle: number,
    playerSpeed: number,
    playerSize: number, // Body segment count
    deltaTime: number
  ): void {
    // Calculate lookahead point
    const speedFactor = Math.min(playerSpeed / 200, 1); // Normalize speed
    const targetLookaheadX = Math.cos(playerAngle) * this.config.lookaheadDistance * speedFactor;
    const targetLookaheadY = Math.sin(playerAngle) * this.config.lookaheadDistance * speedFactor;
    
    // Smooth lookahead transition
    this.lookaheadX += (targetLookaheadX - this.lookaheadX) * this.config.lookaheadSpeed;
    this.lookaheadY += (targetLookaheadY - this.lookaheadY) * this.config.lookaheadSpeed;
    
    // Target is player position + lookahead
    this.targetX = playerX + this.lookaheadX;
    this.targetY = playerY + this.lookaheadY;
    
    // Smooth follow with velocity damping
    const dx = this.targetX - this.currentX;
    const dy = this.targetY - this.currentY;
    
    this.velocityX += dx * this.config.followSpeed;
    this.velocityY += dy * this.config.followSpeed;
    
    // Apply damping
    this.velocityX *= 0.85;
    this.velocityY *= 0.85;
    
    this.currentX += this.velocityX;
    this.currentY += this.velocityY;
    
    // Calculate target zoom based on player size
    this.updateZoom(playerSize);
    
    // Apply to camera
    this.camera.setScroll(
      this.currentX - this.camera.width / 2,
      this.currentY - this.camera.height / 2
    );
    this.camera.setZoom(this.currentZoom);
  }
  
  /**
   * Calculate zoom based on player size
   * Larger players = zoom out (see more)
   * Smaller players = zoom in (precision)
   */
  private updateZoom(playerSize: number): void {
    const { minZoom, maxZoom, minSizeForZoom, maxSizeForZoom } = this.config;
    
    // Normalize size to 0-1 range
    const normalizedSize = Math.min(
      1,
      Math.max(0, (playerSize - minSizeForZoom) / (maxSizeForZoom - minSizeForZoom))
    );
    
    // Larger = lower zoom (zoom out)
    this.targetZoom = maxZoom - normalizedSize * (maxZoom - minZoom);
    
    // Smooth zoom transition
    const zoomSpeed = 0.03;
    this.currentZoom += (this.targetZoom - this.currentZoom) * zoomSpeed;
  }
  
  /**
   * Snap camera to position (no smoothing)
   * Use on spawn/respawn
   */
  snapTo(x: number, y: number, zoom?: number): void {
    this.currentX = x;
    this.currentY = y;
    this.targetX = x;
    this.targetY = y;
    this.velocityX = 0;
    this.velocityY = 0;
    this.lookaheadX = 0;
    this.lookaheadY = 0;
    
    if (zoom !== undefined) {
      this.currentZoom = zoom;
      this.targetZoom = zoom;
    }
    
    this.camera.setScroll(
      this.currentX - this.camera.width / 2,
      this.currentY - this.camera.height / 2
    );
    this.camera.setZoom(this.currentZoom);
  }
  
  /**
   * Add screen shake
   */
  shake(intensity: number = 0.01, duration: number = 200): void {
    this.camera.shake(duration, intensity);
  }
  
  /**
   * Flash the screen (on death, etc.)
   */
  flash(color: number = 0xffffff, duration: number = 200): void {
    this.camera.flash(duration, 
      (color >> 16) & 0xff,
      (color >> 8) & 0xff,
      color & 0xff
    );
  }
  
  /**
   * Get current camera position
   */
  getPosition(): { x: number; y: number } {
    return { x: this.currentX, y: this.currentY };
  }
  
  /**
   * Get current zoom
   */
  getZoom(): number {
    return this.currentZoom;
  }
}
```

### Step 2: Integrate into GameScene

Modify `client/src/scenes/GameScene.ts`:

```typescript
import { SmoothCamera } from '../systems/SmoothCamera';

class GameScene extends Phaser.Scene {
  private smoothCamera!: SmoothCamera;
  
  create(): void {
    // ... existing code ...
    
    // Set up world bounds and camera bounds
    this.cameras.main.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    
    // Initialize smooth camera
    this.smoothCamera = new SmoothCamera(this.cameras.main, {
      followSpeed: 0.08,
      lookaheadDistance: 100,
      lookaheadSpeed: 0.06,
      minZoom: 0.65,
      maxZoom: 1.1,
      minSizeForZoom: 3,
      maxSizeForZoom: 150,
    });
    
    // ... rest of create ...
  }
  
  update(time: number, delta: number): void {
    // ... existing update logic ...
    
    // Update camera
    if (this.localPlayer && this.localPlayer.alive) {
      this.smoothCamera.update(
        this.localPlayer.x,
        this.localPlayer.y,
        this.localPlayer.angle,
        this.localPlayer.speed,
        this.localPlayer.bodySegments.length,
        delta / 1000
      );
    }
  }
  
  private onPlayerSpawn(player: PlayerState): void {
    // Snap camera to spawn position
    this.smoothCamera.snapTo(player.x, player.y, 1.0);
  }
  
  private onPlayerDeath(): void {
    // Screen effects handled by DeathEffect
    // Camera shake is already called there
  }
}
```

### Step 3: Boost Zoom Effect (Optional)

Add extra zoom-out when boosting for better forward visibility:

```typescript
// In SmoothCamera.update()
update(
  playerX: number,
  playerY: number,
  playerAngle: number,
  playerSpeed: number,
  playerSize: number,
  deltaTime: number,
  isBoosting: boolean = false  // Add this parameter
): void {
  // ... existing code ...
  
  // Extra zoom out when boosting
  if (isBoosting) {
    this.targetZoom *= 0.95; // 5% more zoom out
  }
  
  // Clamp zoom
  this.targetZoom = Math.max(this.config.minZoom, Math.min(this.config.maxZoom, this.targetZoom));
  
  // ... rest of update ...
}
```

### Step 4: Camera Bounds Warning (Optional)

Add visual warning when near world edge:

```typescript
// In GameScene
private edgeWarningGraphics!: Phaser.GameObjects.Graphics;

create(): void {
  // ... existing code ...
  
  this.edgeWarningGraphics = this.add.graphics();
  this.edgeWarningGraphics.setDepth(1000);
  this.edgeWarningGraphics.setScrollFactor(0);
}

update(time: number, delta: number): void {
  // ... existing code ...
  
  this.updateEdgeWarning();
}

private updateEdgeWarning(): void {
  this.edgeWarningGraphics.clear();
  
  if (!this.localPlayer) return;
  
  const margin = 200; // Distance from edge to start warning
  const { x, y } = this.localPlayer;
  
  let alpha = 0;
  
  // Check proximity to each edge
  if (x < margin) alpha = Math.max(alpha, 1 - x / margin);
  if (x > WORLD_WIDTH - margin) alpha = Math.max(alpha, 1 - (WORLD_WIDTH - x) / margin);
  if (y < margin) alpha = Math.max(alpha, 1 - y / margin);
  if (y > WORLD_HEIGHT - margin) alpha = Math.max(alpha, 1 - (WORLD_HEIGHT - y) / margin);
  
  if (alpha > 0) {
    // Draw red vignette
    const width = this.cameras.main.width;
    const height = this.cameras.main.height;
    
    this.edgeWarningGraphics.fillStyle(0xff0000, alpha * 0.3);
    this.edgeWarningGraphics.fillRect(0, 0, width, 50); // Top
    this.edgeWarningGraphics.fillRect(0, height - 50, width, 50); // Bottom
    this.edgeWarningGraphics.fillRect(0, 0, 50, height); // Left
    this.edgeWarningGraphics.fillRect(width - 50, 0, 50, height); // Right
  }
}
```

---

## Tuning Guide

| Parameter | Range | Effect |
|-----------|-------|--------|
| followSpeed | 0.03-0.15 | Lower = smoother, mushier; Higher = tighter, snappier |
| lookaheadDistance | 50-200 | How far ahead camera looks |
| lookaheadSpeed | 0.02-0.1 | How fast lookahead adjusts |
| minZoom | 0.5-0.8 | Zoom out limit for large players |
| maxZoom | 1.0-1.3 | Zoom in limit for small players |

**Recommended starting values:**
- Casual/relaxed: followSpeed=0.06, lookahead=150
- Competitive/tight: followSpeed=0.12, lookahead=80

---

## Testing Checklist

- [ ] Camera follows player smoothly (no jitter)
- [ ] Lookahead points in movement direction
- [ ] Zoom adjusts based on player size
- [ ] Camera snaps correctly on spawn
- [ ] Screen shake works for death effects
- [ ] Edge warning appears near world border
- [ ] Camera stays within world bounds

---

## AI Implementation Prompt

```
Implement smooth camera system for Tōrō following docs/impl/IMPL-006-smooth-camera.md.

Current state:
- Camera likely uses basic Phaser follow
- No lookahead or dynamic zoom
- Feels rigid and mechanical

Tasks:
1. Create SmoothCamera class with follow, lookahead, and zoom
2. Integrate into GameScene update loop
3. Add snapTo for spawn/respawn
4. Connect screen shake to death effects
5. Add optional edge warning vignette
6. Tune parameters for comfortable feel

Goal: Camera should feel "floaty" and smooth like slither.io.
Player should be able to see ahead in their movement direction.
```

