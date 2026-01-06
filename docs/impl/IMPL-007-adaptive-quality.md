# IMPL-007: Adaptive Quality System

> Automatically adjust graphics quality based on device performance

**Priority:** 🟡 HIGH  
**Effort:** 1 day  
**Impact:** Consistent 60fps on all devices

---

## Problem

Low-end devices (budget phones, old laptops) struggle with:
- Many food sprites
- Particle effects
- Glow/bloom effects
- Full body segment rendering

Currently: Either game runs poorly on low-end, or looks bad on high-end.

---

## Solution

Automatically detect performance and adjust:
1. **Monitor FPS** over time
2. **Adjust quality** when FPS drops/rises
3. **Expose settings** for manual control

---

## Quality Levels

| Setting | LOW | MEDIUM | HIGH |
|---------|-----|--------|------|
| Max food sprites | 50 | 100 | 200 |
| Max segments per player | 30 | 75 | 150 |
| Particles enabled | ❌ | ✅ | ✅ |
| Collection effects | ❌ | Simple | Full |
| Glow/bloom | ❌ | ❌ | ✅ |
| Background effects | ❌ | ❌ | ✅ |
| Food animations | ❌ | Limited | Full |
| Shadow/depth | ❌ | ❌ | ✅ |

---

## Implementation Guide

### Step 1: Create QualityManager

Create `client/src/systems/QualityManager.ts`:

```typescript
export enum QualityLevel {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
}

export interface QualitySettings {
  maxFoodVisible: number;
  maxSegmentsPerPlayer: number;
  maxLocalSegments: number;
  particlesEnabled: boolean;
  collectionEffects: 'none' | 'simple' | 'full';
  glowEnabled: boolean;
  backgroundEffects: boolean;
  foodAnimations: boolean;
  shadowsEnabled: boolean;
}

const QUALITY_PRESETS: Record<QualityLevel, QualitySettings> = {
  [QualityLevel.LOW]: {
    maxFoodVisible: 50,
    maxSegmentsPerPlayer: 30,
    maxLocalSegments: 80,
    particlesEnabled: false,
    collectionEffects: 'none',
    glowEnabled: false,
    backgroundEffects: false,
    foodAnimations: false,
    shadowsEnabled: false,
  },
  [QualityLevel.MEDIUM]: {
    maxFoodVisible: 100,
    maxSegmentsPerPlayer: 75,
    maxLocalSegments: 120,
    particlesEnabled: true,
    collectionEffects: 'simple',
    glowEnabled: false,
    backgroundEffects: false,
    foodAnimations: true,
    shadowsEnabled: false,
  },
  [QualityLevel.HIGH]: {
    maxFoodVisible: 200,
    maxSegmentsPerPlayer: 150,
    maxLocalSegments: 200,
    particlesEnabled: true,
    collectionEffects: 'full',
    glowEnabled: true,
    backgroundEffects: true,
    foodAnimations: true,
    shadowsEnabled: true,
  },
};

export class QualityManager {
  private currentLevel: QualityLevel = QualityLevel.HIGH;
  private settings: QualitySettings = QUALITY_PRESETS[QualityLevel.HIGH];
  private fpsHistory: number[] = [];
  private autoAdjust: boolean = true;
  
  // FPS thresholds
  private readonly LOW_FPS_THRESHOLD = 35;
  private readonly HIGH_FPS_THRESHOLD = 55;
  private readonly HISTORY_SIZE = 120; // 2 seconds at 60fps
  
  // Prevent rapid changes
  private lastChangeTime = 0;
  private readonly CHANGE_COOLDOWN = 5000; // 5 seconds
  
  // Event callbacks
  private onQualityChange?: (level: QualityLevel, settings: QualitySettings) => void;
  
  constructor() {
    // Try to load saved preference
    const saved = localStorage.getItem('toro-quality');
    if (saved && saved in QualityLevel) {
      this.setQuality(saved as QualityLevel);
      this.autoAdjust = false; // Manual setting disables auto
    }
  }
  
  /**
   * Call every frame with current FPS
   */
  update(fps: number): void {
    this.fpsHistory.push(fps);
    
    if (this.fpsHistory.length > this.HISTORY_SIZE) {
      this.fpsHistory.shift();
    }
    
    // Only auto-adjust if enabled
    if (!this.autoAdjust) return;
    
    // Need enough samples
    if (this.fpsHistory.length < 60) return;
    
    // Check cooldown
    const now = Date.now();
    if (now - this.lastChangeTime < this.CHANGE_COOLDOWN) return;
    
    // Calculate average FPS
    const avgFps = this.fpsHistory.reduce((a, b) => a + b) / this.fpsHistory.length;
    
    // Adjust quality
    if (avgFps < this.LOW_FPS_THRESHOLD && this.currentLevel !== QualityLevel.LOW) {
      this.downgrade();
      this.lastChangeTime = now;
    } else if (avgFps > this.HIGH_FPS_THRESHOLD && this.currentLevel !== QualityLevel.HIGH) {
      // Only upgrade if consistently high
      const minFps = Math.min(...this.fpsHistory.slice(-60));
      if (minFps > 50) {
        this.upgrade();
        this.lastChangeTime = now;
      }
    }
  }
  
  private downgrade(): void {
    if (this.currentLevel === QualityLevel.HIGH) {
      this.setQuality(QualityLevel.MEDIUM);
    } else if (this.currentLevel === QualityLevel.MEDIUM) {
      this.setQuality(QualityLevel.LOW);
    }
    console.log(`[Quality] Downgraded to ${this.currentLevel} (FPS was low)`);
  }
  
  private upgrade(): void {
    if (this.currentLevel === QualityLevel.LOW) {
      this.setQuality(QualityLevel.MEDIUM);
    } else if (this.currentLevel === QualityLevel.MEDIUM) {
      this.setQuality(QualityLevel.HIGH);
    }
    console.log(`[Quality] Upgraded to ${this.currentLevel} (FPS is stable)`);
  }
  
  /**
   * Manually set quality level
   */
  setQuality(level: QualityLevel): void {
    this.currentLevel = level;
    this.settings = { ...QUALITY_PRESETS[level] };
    this.fpsHistory = []; // Reset history
    
    // Save preference
    localStorage.setItem('toro-quality', level);
    
    // Notify listeners
    this.onQualityChange?.(level, this.settings);
  }
  
  /**
   * Enable/disable auto quality adjustment
   */
  setAutoAdjust(enabled: boolean): void {
    this.autoAdjust = enabled;
    if (enabled) {
      localStorage.removeItem('toro-quality');
    }
  }
  
  /**
   * Register callback for quality changes
   */
  onChange(callback: (level: QualityLevel, settings: QualitySettings) => void): void {
    this.onQualityChange = callback;
  }
  
  /**
   * Get current settings
   */
  getSettings(): QualitySettings {
    return this.settings;
  }
  
  /**
   * Get current quality level
   */
  getLevel(): QualityLevel {
    return this.currentLevel;
  }
  
  /**
   * Check if auto-adjust is enabled
   */
  isAutoAdjust(): boolean {
    return this.autoAdjust;
  }
  
  /**
   * Get average FPS
   */
  getAverageFps(): number {
    if (this.fpsHistory.length === 0) return 60;
    return this.fpsHistory.reduce((a, b) => a + b) / this.fpsHistory.length;
  }
}
```

### Step 2: Integrate into GameScene

```typescript
import { QualityManager, QualityLevel, QualitySettings } from '../systems/QualityManager';

class GameScene extends Phaser.Scene {
  private qualityManager!: QualityManager;
  private currentQuality!: QualitySettings;
  
  create(): void {
    // ... existing code ...
    
    // Initialize quality manager
    this.qualityManager = new QualityManager();
    this.currentQuality = this.qualityManager.getSettings();
    
    // Listen for quality changes
    this.qualityManager.onChange((level, settings) => {
      this.currentQuality = settings;
      this.applyQualitySettings(settings);
    });
    
    // Apply initial settings
    this.applyQualitySettings(this.currentQuality);
  }
  
  update(time: number, delta: number): void {
    // Report FPS to quality manager
    const fps = this.game.loop.actualFps;
    this.qualityManager.update(fps);
    
    // ... rest of update ...
  }
  
  private applyQualitySettings(settings: QualitySettings): void {
    // Update food pool limit
    if (this.foodPool) {
      this.foodPool.setMaxVisible(settings.maxFoodVisible);
    }
    
    // Update segment limits
    if (this.localPlayerSegments) {
      this.localPlayerSegments.setMaxSegments(settings.maxLocalSegments);
    }
    
    // Toggle effects
    if (this.collectionEffect) {
      this.collectionEffect.setEnabled(settings.collectionEffects !== 'none');
      this.collectionEffect.setSimple(settings.collectionEffects === 'simple');
    }
    
    // Toggle bloom pipeline
    if (settings.glowEnabled) {
      this.cameras.main.setPostPipeline('BloomPipeline');
    } else {
      this.cameras.main.removePostPipeline('BloomPipeline');
    }
    
    console.log(`[Quality] Applied ${this.qualityManager.getLevel()} settings`);
  }
}
```

### Step 3: Update Effects to Respect Quality

```typescript
// In CollectionEffect.ts
class CollectionEffect {
  private enabled = true;
  private simple = false;
  
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }
  
  setSimple(simple: boolean): void {
    this.simple = simple;
  }
  
  play(x: number, y: number, isGolden: boolean): void {
    if (!this.enabled) return;
    
    if (this.simple) {
      this.playSimple(x, y, isGolden);
    } else {
      this.playFull(x, y, isGolden);
    }
  }
}
```

### Step 4: Update Food/Segment Rendering

```typescript
// In FoodPool.ts
class FoodPool {
  private maxVisible = 200;
  
  setMaxVisible(max: number): void {
    this.maxVisible = max;
  }
  
  syncWithServer(serverFood: Hitodama[]): void {
    // Only render up to maxVisible food
    const toRender = serverFood.slice(0, this.maxVisible);
    
    // ... rest of sync logic ...
  }
}

// In SegmentPool.ts
class SegmentPool {
  private maxSegments = 150;
  
  setMaxSegments(max: number): void {
    this.maxSegments = max;
  }
  
  updateSegments(segments: BodySegment[], isLocalPlayer: boolean): void {
    const max = isLocalPlayer ? this.maxSegments : this.maxSegments * 0.5;
    // ... use max for LOD ...
  }
}
```

### Step 5: Add Quality UI (Optional)

```typescript
// Simple quality toggle in settings
createQualityToggle(): void {
  const levels = [QualityLevel.LOW, QualityLevel.MEDIUM, QualityLevel.HIGH, 'auto'];
  let currentIndex = levels.indexOf(this.qualityManager.getLevel());
  
  const button = this.add.text(10, 60, `Quality: ${levels[currentIndex]}`, {
    fontSize: '14px',
    backgroundColor: '#333',
    padding: { x: 8, y: 4 },
  });
  
  button.setScrollFactor(0);
  button.setDepth(1000);
  button.setInteractive();
  
  button.on('pointerdown', () => {
    currentIndex = (currentIndex + 1) % levels.length;
    const level = levels[currentIndex];
    
    if (level === 'auto') {
      this.qualityManager.setAutoAdjust(true);
      button.setText('Quality: Auto');
    } else {
      this.qualityManager.setAutoAdjust(false);
      this.qualityManager.setQuality(level as QualityLevel);
      button.setText(`Quality: ${level}`);
    }
  });
}
```

---

## Testing Checklist

- [ ] Game detects low FPS and downgrades quality
- [ ] Game upgrades when FPS is consistently high
- [ ] Manual quality selection works
- [ ] Quality preference persists across sessions
- [ ] Low quality runs at 60fps on budget devices
- [ ] High quality looks good on powerful devices
- [ ] No visual glitches when quality changes

---

## Performance Verification

Test on various devices:
- iPhone SE (2016) → Should maintain 60fps on LOW
- iPhone 12 → Should run on MEDIUM or HIGH
- Budget Android → Should auto-detect LOW
- Desktop → Should run on HIGH

---

## AI Implementation Prompt

```
Implement adaptive quality system for Tōrō following docs/impl/IMPL-007-adaptive-quality.md.

Current state:
- No quality scaling
- Same settings for all devices
- Low-end devices have poor FPS

Tasks:
1. Create QualityManager with LOW/MEDIUM/HIGH presets
2. Monitor FPS and auto-adjust quality
3. Integrate into GameScene
4. Update FoodPool and SegmentPool to respect limits
5. Update effects to enable/disable based on quality
6. Add simple quality toggle UI
7. Persist quality preference to localStorage

Goal: Consistent 60fps on all devices by automatically reducing effects on low-end devices.
```


