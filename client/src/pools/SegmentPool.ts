import Phaser from 'phaser';
import { ArcPool } from './SpritePool';

/**
 * Body segment visual data
 */
interface SegmentVisual {
  glow: Phaser.GameObjects.Arc;
  core: Phaser.GameObjects.Arc;
  phaseOffset: number;
  // Smoothed position for interpolation
  currentX: number;
  currentY: number;
  velX: number;
  velY: number;
}

/**
 * Server segment data
 */
interface SegmentData {
  x: number;
  y: number;
}

/**
 * Pool-based body segment rendering system
 * Eliminates GC by reusing Arc objects for segment visuals
 */
export class SegmentPool {
  private scene: Phaser.Scene;
  
  // Arc pools for glow and core
  private glowPool: ArcPool;
  private corePool: ArcPool;
  
  // Active segment visuals
  private activeSegments: SegmentVisual[] = [];
  
  // Settings
  private maxSegments: number;
  private baseDepth: number;
  
  // Colors (set externally for local vs remote players)
  private glowColorHead: number = 0xaaddff;
  private glowColorTail: number = 0x4488cc;
  private coreColorHead: number = 0xddeeff;
  private coreColorTail: number = 0x88bbdd;
  
  constructor(
    scene: Phaser.Scene,
    maxSegments: number = 200,
    baseDepth: number = 50
  ) {
    this.scene = scene;
    this.maxSegments = maxSegments;
    this.baseDepth = baseDepth;
    
    // Initialize pools (each segment needs glow + core)
    this.glowPool = new ArcPool(scene, maxSegments);
    this.corePool = new ArcPool(scene, maxSegments);
  }
  
  /**
   * Set colors for this pool (local player vs enemy)
   */
  setColors(
    glowHead: number,
    glowTail: number,
    coreHead: number,
    coreTail: number
  ): void {
    this.glowColorHead = glowHead;
    this.glowColorTail = glowTail;
    this.coreColorHead = coreHead;
    this.coreColorTail = coreTail;
  }
  
  /**
   * Set maximum segments to render
   */
  setMaxSegments(max: number): void {
    this.maxSegments = max;
  }
  
  /**
   * Calculate visual segment indices for LOD
   * Returns indices of segments to actually render
   */
  private getVisualSegmentIndices(totalSegments: number, maxVisual: number): number[] {
    if (totalSegments <= maxVisual) {
      return Array.from({ length: totalSegments }, (_, i) => i);
    }
    
    const indices: number[] = [];
    const step = (totalSegments - 1) / (maxVisual - 1);
    
    for (let i = 0; i < maxVisual; i++) {
      indices.push(Math.round(i * step));
    }
    
    return indices;
  }
  
  /**
   * Linear interpolation for colors
   */
  private lerpColor(colorA: number, colorB: number, t: number): number {
    const rA = (colorA >> 16) & 0xff;
    const gA = (colorA >> 8) & 0xff;
    const bA = colorA & 0xff;
    
    const rB = (colorB >> 16) & 0xff;
    const gB = (colorB >> 8) & 0xff;
    const bB = colorB & 0xff;
    
    const r = Math.round(rA + (rB - rA) * t);
    const g = Math.round(gA + (gB - gA) * t);
    const b = Math.round(bA + (bB - bA) * t);
    
    return (r << 16) | (g << 8) | b;
  }
  
  /**
   * Update body segments
   * @param segments Server segment data
   * @param headX Head position X (for smooth following)
   * @param headY Head position Y
   * @param animTime Animation time
   * @param config Visual configuration
   */
  updateSegments(
    segments: SegmentData[],
    headX: number,
    headY: number,
    animTime: number,
    config: {
      radiusMax: number;
      radiusMin: number;
      opacityMax: number;
      opacityMin: number;
      glowMultiplier: number;
      pulseAmount: number;
      pulseSpeed: number;
      wobbleAmplitude: number;
      wobbleSpeed: number;
      smoothFollow?: boolean;
    }
  ): void {
    const totalSegments = segments.length;
    const visualIndices = this.getVisualSegmentIndices(totalSegments, this.maxSegments);
    const visualCount = visualIndices.length;
    
    // Ensure we have enough segment visuals
    while (this.activeSegments.length < visualCount) {
      const phaseOffset = Math.random() * Math.PI * 2;
      
      const glow = this.glowPool.acquire(0, 0, 10, this.glowColorHead, 0.5);
      const core = this.corePool.acquire(0, 0, 5, this.coreColorHead, 1);
      
      const index = this.activeSegments.length;
      glow.setDepth(this.baseDepth - index);
      core.setDepth(this.baseDepth + 1 - index);
      
      this.activeSegments.push({
        glow,
        core,
        phaseOffset,
        currentX: headX,
        currentY: headY,
        velX: 0,
        velY: 0,
      });
    }
    
    // Release excess segment visuals
    while (this.activeSegments.length > visualCount) {
      const removed = this.activeSegments.pop();
      if (removed) {
        this.glowPool.release(removed.glow);
        this.corePool.release(removed.core);
      }
    }
    
    // Update visible segments
    let prevX = headX;
    let prevY = headY;
    
    for (let vi = 0; vi < visualCount; vi++) {
      const actualIndex = visualIndices[vi];
      const visual = this.activeSegments[vi];
      const serverSeg = segments[actualIndex];
      
      if (!serverSeg) continue;
      
      // Target position
      let targetX = serverSeg.x;
      let targetY = serverSeg.y;
      
      // Smooth following (optional)
      if (config.smoothFollow !== false) {
        const followSpeed = 0.25;
        visual.velX += (targetX - visual.currentX) * followSpeed;
        visual.velY += (targetY - visual.currentY) * followSpeed;
        visual.velX *= 0.8;
        visual.velY *= 0.8;
        visual.currentX += visual.velX;
        visual.currentY += visual.velY;
        targetX = visual.currentX;
        targetY = visual.currentY;
      }
      
      // Calculate wobble based on perpendicular to movement direction
      const dx = targetX - prevX;
      const dy = targetY - prevY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      
      let wobbleX = 0;
      let wobbleY = 0;
      if (dist > 0.1) {
        const perpX = -dy / dist;
        const perpY = dx / dist;
        const wobble = Math.sin(animTime * config.wobbleSpeed + visual.phaseOffset + vi * 0.3) * config.wobbleAmplitude;
        wobbleX = perpX * wobble;
        wobbleY = perpY * wobble;
      }
      
      // Final position with wobble
      const finalX = targetX + wobbleX;
      const finalY = targetY + wobbleY;
      
      // Calculate progress (0 = head, 1 = tail)
      const progress = totalSegments > 1 ? actualIndex / (totalSegments - 1) : 0;
      
      // Calculate visual properties based on progress
      const easeRadius = 1 - Math.pow(progress, 0.7);
      const radius = config.radiusMin + (config.radiusMax - config.radiusMin) * easeRadius;
      
      const easeOpacity = Math.pow(progress, 0.5);
      const opacity = config.opacityMax - (config.opacityMax - config.opacityMin) * easeOpacity;
      
      // Pulse animation
      const pulse = 1 + Math.sin(animTime * config.pulseSpeed + visual.phaseOffset) * config.pulseAmount;
      const pulseRadius = radius * pulse;
      
      // Color interpolation
      const glowColor = this.lerpColor(this.glowColorHead, this.glowColorTail, progress);
      const coreColor = this.lerpColor(this.coreColorHead, this.coreColorTail, progress);
      
      // Update glow
      visual.glow.setPosition(finalX, finalY);
      visual.glow.setRadius(pulseRadius * config.glowMultiplier);
      visual.glow.setFillStyle(glowColor, opacity * 0.5);
      
      // Update core
      visual.core.setPosition(finalX, finalY);
      visual.core.setRadius(pulseRadius);
      visual.core.setFillStyle(coreColor, opacity);
      
      prevX = targetX;
      prevY = targetY;
    }
  }
  
  /**
   * Get number of active segments
   */
  get activeCount(): number {
    return this.activeSegments.length;
  }
  
  /**
   * Get pool statistics
   */
  getStats(): { active: number; pooled: number; total: number } {
    return {
      active: this.activeSegments.length,
      pooled: this.glowPool.totalCount - this.glowPool.activeCount,
      total: this.glowPool.totalCount,
    };
  }
  
  /**
   * Clear all segments
   */
  clear(): void {
    for (const visual of this.activeSegments) {
      this.glowPool.release(visual.glow);
      this.corePool.release(visual.core);
    }
    this.activeSegments = [];
  }
  
  /**
   * Destroy the pool completely
   */
  destroy(): void {
    this.clear();
    this.glowPool.destroy();
    this.corePool.destroy();
  }
}

/**
 * Manager for multiple player segment pools
 * Handles creating/destroying pools for remote players
 */
export class PlayerSegmentManager {
  private scene: Phaser.Scene;
  private localPool: SegmentPool;
  private remotePools: Map<string, SegmentPool> = new Map();
  
  private maxLocalSegments: number;
  private maxRemoteSegments: number;
  
  constructor(
    scene: Phaser.Scene,
    maxLocalSegments: number = 150,
    maxRemoteSegments: number = 80
  ) {
    this.scene = scene;
    this.maxLocalSegments = maxLocalSegments;
    this.maxRemoteSegments = maxRemoteSegments;
    
    // Create local player pool
    this.localPool = new SegmentPool(scene, maxLocalSegments, 50);
  }
  
  /**
   * Set colors for local player
   */
  setLocalColors(glowHead: number, glowTail: number, coreHead: number, coreTail: number): void {
    this.localPool.setColors(glowHead, glowTail, coreHead, coreTail);
  }
  
  /**
   * Get or create pool for a remote player
   */
  getRemotePool(playerId: string): SegmentPool {
    let pool = this.remotePools.get(playerId);
    if (!pool) {
      pool = new SegmentPool(this.scene, this.maxRemoteSegments, 30);
      this.remotePools.set(playerId, pool);
    }
    return pool;
  }
  
  /**
   * Get local player pool
   */
  getLocalPool(): SegmentPool {
    return this.localPool;
  }
  
  /**
   * Remove pool for a player that left
   */
  removePlayer(playerId: string): void {
    const pool = this.remotePools.get(playerId);
    if (pool) {
      pool.destroy();
      this.remotePools.delete(playerId);
    }
  }
  
  /**
   * Set max segments for quality scaling
   */
  setMaxSegments(local: number, remote: number): void {
    this.maxLocalSegments = local;
    this.maxRemoteSegments = remote;
    this.localPool.setMaxSegments(local);
    for (const pool of this.remotePools.values()) {
      pool.setMaxSegments(remote);
    }
  }
  
  /**
   * Get statistics for all pools
   */
  getStats(): { local: ReturnType<SegmentPool['getStats']>; remoteCount: number } {
    return {
      local: this.localPool.getStats(),
      remoteCount: this.remotePools.size,
    };
  }
  
  /**
   * Clear all pools
   */
  clear(): void {
    this.localPool.clear();
    for (const pool of this.remotePools.values()) {
      pool.clear();
    }
  }
  
  /**
   * Destroy all pools
   */
  destroy(): void {
    this.localPool.destroy();
    for (const pool of this.remotePools.values()) {
      pool.destroy();
    }
    this.remotePools.clear();
  }
}

