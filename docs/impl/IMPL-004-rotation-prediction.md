# IMPL-004: Client-Side Rotation Prediction

> Instant rotation response while keeping position server-authoritative

**Priority:** 🟡 HIGH  
**Effort:** 2 days  
**Impact:** ~90% reduction in perceived input latency

---

## Problem

Current flow:
1. Player moves mouse → Client sends input to server
2. Server processes input → Sends back new angle
3. Client receives and renders → 100-150ms total delay

This makes the game feel "sluggish" and "unresponsive".

---

## Solution

**Predict rotation only**, not position:
- Client immediately rotates player head toward mouse
- Server remains authoritative for position
- Smoothly blend when server confirms different angle

This gives instant feedback without complex position reconciliation that causes mobile jitter.

---

## Why Rotation-Only?

All 5 AI models agreed:
- Full position prediction causes desync and jitter
- Rotation prediction gives 90% of the "instant feel"
- Much simpler to implement and debug
- No reconciliation "snapping" issues

---

## Implementation Guide

### Step 1: Update ClientPrediction Class

Modify `client/src/network/ClientPrediction.ts`:

```typescript
export class ClientPrediction {
  // Predicted angle (client-side)
  private predictedAngle = 0;
  
  // Server-confirmed angle
  private serverAngle = 0;
  
  // Blending parameters
  private readonly BLEND_SPEED = 0.15;
  private readonly MAX_ANGLE_ERROR = Math.PI / 4; // 45 degrees
  
  // Input tracking
  private lastInput: PlayerInput | null = null;
  
  /**
   * Called every frame on client
   * Returns the angle to render (predicted)
   */
  update(
    deltaTime: number,
    mouseX: number,
    mouseY: number,
    currentSpeed: number
  ): number {
    // Calculate target angle from mouse
    const distance = Math.sqrt(mouseX * mouseX + mouseY * mouseY);
    
    if (distance > 0.05) {
      const targetAngle = Math.atan2(mouseY, mouseX);
      
      // Apply turn rate limit (must match server TURN_SPEED)
      const turnSpeed = 4; // radians per second
      const maxTurn = turnSpeed * deltaTime;
      
      const angleDiff = this.wrapAngle(targetAngle - this.predictedAngle);
      
      if (Math.abs(angleDiff) <= maxTurn) {
        this.predictedAngle = targetAngle;
      } else if (angleDiff > 0) {
        this.predictedAngle += maxTurn;
      } else {
        this.predictedAngle -= maxTurn;
      }
      
      this.predictedAngle = this.wrapAngle(this.predictedAngle);
    }
    
    return this.predictedAngle;
  }
  
  /**
   * Called when server state arrives
   * Smoothly corrects if prediction was wrong
   */
  onServerUpdate(serverAngle: number): void {
    this.serverAngle = serverAngle;
    
    // Calculate error
    const error = this.wrapAngle(this.serverAngle - this.predictedAngle);
    
    if (Math.abs(error) > this.MAX_ANGLE_ERROR) {
      // Large error - snap to server
      this.predictedAngle = this.serverAngle;
    } else if (Math.abs(error) > 0.01) {
      // Small error - blend gradually
      this.predictedAngle += error * this.BLEND_SPEED;
      this.predictedAngle = this.wrapAngle(this.predictedAngle);
    }
  }
  
  /**
   * Get current predicted angle
   */
  getPredictedAngle(): number {
    return this.predictedAngle;
  }
  
  /**
   * Sync with server state (e.g., on spawn/respawn)
   */
  syncWithServer(angle: number): void {
    this.predictedAngle = angle;
    this.serverAngle = angle;
  }
  
  private wrapAngle(angle: number): number {
    while (angle > Math.PI) angle -= Math.PI * 2;
    while (angle < -Math.PI) angle += Math.PI * 2;
    return angle;
  }
}
```

### Step 2: Integrate into GameScene

Modify `client/src/scenes/GameScene.ts`:

```typescript
import { ClientPrediction } from '../network/ClientPrediction';

class GameScene extends Phaser.Scene {
  private prediction!: ClientPrediction;
  private lastMouseX = 0;
  private lastMouseY = 0;
  
  create(): void {
    // ... existing code ...
    
    this.prediction = new ClientPrediction();
  }
  
  update(time: number, delta: number): void {
    const deltaTime = delta / 1000;
    
    // Get normalized mouse position relative to center
    const centerX = this.cameras.main.width / 2;
    const centerY = this.cameras.main.height / 2;
    const mouseWorldX = this.input.activePointer.worldX;
    const mouseWorldY = this.input.activePointer.worldY;
    
    // If we have a local player position, calculate relative mouse
    if (this.localPlayer) {
      this.lastMouseX = (mouseWorldX - this.localPlayer.x) / 300; // Normalize
      this.lastMouseY = (mouseWorldY - this.localPlayer.y) / 300;
      
      // Clamp to -1 to 1
      const mag = Math.sqrt(this.lastMouseX ** 2 + this.lastMouseY ** 2);
      if (mag > 1) {
        this.lastMouseX /= mag;
        this.lastMouseY /= mag;
      }
    }
    
    // Update prediction
    const predictedAngle = this.prediction.update(
      deltaTime,
      this.lastMouseX,
      this.lastMouseY,
      this.localPlayer?.speed || 0
    );
    
    // Render local player with PREDICTED angle
    if (this.localPlayerHead) {
      this.localPlayerHead.setRotation(predictedAngle);
    }
    
    // ... rest of update ...
  }
  
  private onGameState(snapshot: GameSnapshot): void {
    // ... existing code ...
    
    // Update prediction with server state
    const localPlayerState = snapshot.players[this.playerId];
    if (localPlayerState) {
      this.prediction.onServerUpdate(localPlayerState.angle);
      
      // Position uses server value (interpolated)
      // But we already rendered rotation from prediction
    }
  }
  
  private onRespawn(): void {
    // ... existing code ...
    
    // Sync prediction with server
    if (this.localPlayer) {
      this.prediction.syncWithServer(this.localPlayer.angle);
    }
  }
}
```

### Step 3: Visual Separation of Head and Body

For extra polish, rotate ONLY the head sprite immediately, while body follows server position:

```typescript
private renderLocalPlayer(player: PlayerState): void {
  // Head uses predicted rotation
  this.localPlayerHead.setRotation(this.prediction.getPredictedAngle());
  
  // Head position uses interpolated server position
  this.localPlayerHead.setPosition(player.x, player.y);
  
  // Body segments use server positions (already interpolated)
  this.renderBodySegments(player.bodySegments);
}
```

### Step 4: Handle Edge Cases

```typescript
// On disconnect/reconnect
private onReconnect(): void {
  // Reset prediction state
  this.prediction = new ClientPrediction();
}

// On death
private onDeath(): void {
  // Keep prediction, will be synced on respawn
}

// On spawn
private onSpawn(player: PlayerState): void {
  this.prediction.syncWithServer(player.angle);
}
```

---

## Tuning Parameters

| Parameter | Value | Effect |
|-----------|-------|--------|
| BLEND_SPEED | 0.15 | How fast to correct errors (higher = faster snap) |
| MAX_ANGLE_ERROR | π/4 | When to snap vs blend (45° threshold) |
| Turn rate | 4 rad/s | Must match server (PLAYER_CONFIG.TURN_SPEED) |

---

## Testing Checklist

- [ ] Player rotates instantly when moving mouse
- [ ] No visible "snapping" or jitter on stable connection
- [ ] Rotation feels smooth, not robotic
- [ ] Rotation matches server within ~100ms
- [ ] Works on mobile (touch to rotate)
- [ ] No desync after playing for 5+ minutes
- [ ] Respawn correctly resets prediction

---

## What This Does NOT Do

- ❌ Predict position (server authoritative)
- ❌ Predict speed/velocity
- ❌ Complex reconciliation
- ❌ Input replay

This keeps the implementation simple and avoids the jitter issues that full prediction causes.

---

## AI Implementation Prompt

```
Implement client-side rotation prediction for Tōrō following docs/impl/IMPL-004-rotation-prediction.md.

Current state:
- ClientPrediction.ts exists but may not be used
- Player rotation waits for server response (100ms+ delay)
- No local prediction of any kind

Tasks:
1. Update ClientPrediction class with rotation-only prediction
2. Integrate into GameScene update loop
3. Apply predicted angle to player head sprite immediately
4. Blend with server angle when state arrives
5. Handle respawn/death edge cases

IMPORTANT: Do NOT predict position. Only predict rotation/angle.
The goal is instant rotation feedback while position stays server-authoritative.
```

