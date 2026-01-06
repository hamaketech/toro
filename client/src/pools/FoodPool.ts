import Phaser from 'phaser';
import { ImagePool } from './SpritePool';

/**
 * Food visual data stored for each active food item
 */
interface FoodVisual {
  id: string;
  glow: Phaser.GameObjects.Image;
  core: Phaser.GameObjects.Image;
  container: Phaser.GameObjects.Container;
  phaseOffset: number;
  isGolden: boolean;
}

/**
 * Food state from server
 */
interface FoodState {
  x: number;
  y: number;
  value: number;
  radius?: number;
}

/**
 * Pool-based food rendering system
 * Eliminates GC by reusing Image objects for food sprites
 */
export class FoodPool {
  private scene: Phaser.Scene;
  private activeFood: Map<string, FoodVisual> = new Map();
  
  // Pools for food sprites
  private glowPool: ImagePool;
  private corePool: ImagePool;
  
  // Container pool (using standard approach)
  private containerPool: Phaser.GameObjects.Container[] = [];
  private activeContainers: Set<Phaser.GameObjects.Container> = new Set();
  
  // Settings
  private maxVisible: number;
  private textureKey: string;
  private frameKey: string;
  
  // Colors
  private readonly NORMAL_GLOW_COLOR = 0x44ffcc;
  private readonly NORMAL_CORE_COLOR = 0xccffee;
  private readonly GOLDEN_GLOW_COLOR = 0xffaa00;
  private readonly GOLDEN_CORE_COLOR = 0xffdd44;
  
  constructor(
    scene: Phaser.Scene, 
    maxFood: number = 200,
    textureKey: string = 'toro',
    frameKey: string = 'ghost'
  ) {
    this.scene = scene;
    this.maxVisible = maxFood;
    this.textureKey = textureKey;
    this.frameKey = frameKey;
    
    // Initialize pools
    // Each food needs 2 images (glow + core), so pool size = maxFood * 2
    this.glowPool = new ImagePool(scene, textureKey, frameKey, maxFood);
    this.corePool = new ImagePool(scene, textureKey, frameKey, maxFood);
    
    // Pre-create containers
    for (let i = 0; i < Math.min(maxFood, 100); i++) {
      const container = scene.add.container(0, 0);
      container.setActive(false);
      container.setVisible(false);
      this.containerPool.push(container);
    }
  }
  
  /**
   * Acquire a container from pool
   */
  private acquireContainer(x: number, y: number): Phaser.GameObjects.Container {
    let container: Phaser.GameObjects.Container;
    
    if (this.containerPool.length > 0) {
      container = this.containerPool.pop()!;
    } else {
      container = this.scene.add.container(0, 0);
    }
    
    container.setPosition(x, y);
    container.setActive(true);
    container.setVisible(true);
    this.activeContainers.add(container);
    return container;
  }
  
  /**
   * Release a container back to pool
   */
  private releaseContainer(container: Phaser.GameObjects.Container): void {
    if (!this.activeContainers.has(container)) return;
    
    this.activeContainers.delete(container);
    container.setActive(false);
    container.setVisible(false);
    container.removeAll(false); // Don't destroy children (we pool those separately)
    container.setPosition(0, 0);
    this.containerPool.push(container);
  }
  
  /**
   * Spawn a new food visual
   */
  spawn(id: string, state: FoodState): FoodVisual | null {
    if (this.activeFood.has(id)) {
      return this.activeFood.get(id)!;
    }
    
    if (this.activeFood.size >= this.maxVisible) {
      return null;
    }
    
    const isGolden = state.value > 1;
    const sizeMultiplier = isGolden ? 1.3 : 1;
    
    // Get container
    const container = this.acquireContainer(state.x, state.y);
    container.setDepth(isGolden ? 15 : 10);
    
    // Get glow image from pool
    const glow = this.glowPool.acquire(0, 0);
    glow.setScale(1.4 * sizeMultiplier);
    glow.setAlpha(isGolden ? 0.5 : 0.35);
    glow.setTint(isGolden ? this.GOLDEN_GLOW_COLOR : this.NORMAL_GLOW_COLOR);
    
    // Get core image from pool  
    const core = this.corePool.acquire(0, 0);
    core.setScale(0.8 * sizeMultiplier);
    core.setTint(isGolden ? this.GOLDEN_CORE_COLOR : this.NORMAL_CORE_COLOR);
    
    container.add([glow, core]);
    
    const phaseOffset = Math.random() * Math.PI * 2;
    
    const visual: FoodVisual = {
      id,
      glow,
      core,
      container,
      phaseOffset,
      isGolden,
    };
    
    this.activeFood.set(id, visual);
    return visual;
  }
  
  /**
   * Update a food visual's position and animation
   */
  update(
    id: string, 
    state: FoodState, 
    animTime: number,
    playerX: number,
    playerY: number,
    animationDistance: number = 600
  ): void {
    let visual = this.activeFood.get(id);
    
    if (!visual) {
      visual = this.spawn(id, state);
      if (!visual) return; // Hit max limit
    }
    
    const { container, glow, core, phaseOffset, isGolden } = visual;
    
    // Update position
    container.setPosition(state.x, state.y);
    
    // Calculate distance for animation LOD
    const dx = state.x - playerX;
    const dy = state.y - playerY;
    const distToPlayer = Math.sqrt(dx * dx + dy * dy);
    const shouldAnimate = distToPlayer < animationDistance || isGolden;
    
    if (shouldAnimate) {
      // Floating animation
      const floatY = Math.sin(animTime * 2.5 + phaseOffset) * 4;
      container.y = state.y + floatY;
      
      // Pulse animation
      const pulse = 1 + Math.sin(animTime * 2.5 + phaseOffset) * 0.2;
      const sizeMultiplier = isGolden ? 1.3 : 1;
      glow.setScale(1.4 * sizeMultiplier * pulse);
      
      // Glow intensity
      const glowAlpha = (isGolden ? 0.5 : 0.35) * (0.8 + Math.sin(animTime * 3 + phaseOffset) * 0.2);
      glow.setAlpha(glowAlpha);
    }
  }
  
  /**
   * Remove a food visual and return sprites to pool
   */
  remove(id: string): void {
    const visual = this.activeFood.get(id);
    if (!visual) return;
    
    // Release sprites back to pools
    this.glowPool.release(visual.glow);
    this.corePool.release(visual.core);
    this.releaseContainer(visual.container);
    
    this.activeFood.delete(id);
  }
  
  /**
   * Sync pool with server state
   * Removes food not in server list, updates/creates food that is
   */
  syncWithServer(
    serverFood: Map<string, FoodState> | Array<[string, FoodState]>,
    animTime: number,
    playerX: number,
    playerY: number,
    viewportBounds: { left: number; right: number; top: number; bottom: number },
    animationDistance: number = 600
  ): void {
    // Convert to Map if array
    const foodMap = serverFood instanceof Map 
      ? serverFood 
      : new Map(serverFood);
    
    const serverIds = new Set(foodMap.keys());
    
    // Remove food that no longer exists on server
    for (const [id] of this.activeFood) {
      if (!serverIds.has(id)) {
        this.remove(id);
      }
    }
    
    // Separate golden and normal food for priority rendering
    const goldenFood: Array<[string, FoodState]> = [];
    const normalFood: Array<[string, FoodState]> = [];
    
    for (const [id, state] of foodMap) {
      // Viewport culling
      if (state.x < viewportBounds.left || state.x > viewportBounds.right ||
          state.y < viewportBounds.top || state.y > viewportBounds.bottom) {
        // Remove if it was visible before
        if (this.activeFood.has(id)) {
          this.remove(id);
        }
        continue;
      }
      
      if (state.value > 1) {
        goldenFood.push([id, state]);
      } else {
        normalFood.push([id, state]);
      }
    }
    
    // Update/create visible food (golden first, up to max)
    let count = 0;
    
    for (const [id, state] of goldenFood) {
      if (count >= this.maxVisible) break;
      this.update(id, state, animTime, playerX, playerY, animationDistance);
      count++;
    }
    
    for (const [id, state] of normalFood) {
      if (count >= this.maxVisible) break;
      this.update(id, state, animTime, playerX, playerY, animationDistance);
      count++;
    }
  }
  
  /**
   * Set maximum visible food
   */
  setMaxVisible(max: number): void {
    this.maxVisible = max;
  }
  
  /**
   * Get current active food count
   */
  get activeCount(): number {
    return this.activeFood.size;
  }
  
  /**
   * Get pool statistics
   */
  getStats(): { active: number; pooled: number; total: number } {
    return {
      active: this.activeFood.size,
      pooled: this.glowPool.totalCount - this.glowPool.activeCount,
      total: this.glowPool.totalCount,
    };
  }
  
  /**
   * Clear all food visuals
   */
  clear(): void {
    for (const [id] of this.activeFood) {
      this.remove(id);
    }
  }
  
  /**
   * Destroy the pool completely
   */
  destroy(): void {
    this.clear();
    this.glowPool.destroy();
    this.corePool.destroy();
    
    for (const container of this.containerPool) {
      container.destroy();
    }
    this.containerPool = [];
  }
}

