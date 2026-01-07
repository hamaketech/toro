/**
 * BotAI.ts - Intelligent Bot AI for Tōrō
 * 
 * Implements a behavior-based AI system with:
 * - Finite State Machine for high-level decision making
 * - Steering behaviors for smooth movement
 * - Spatial awareness and risk assessment
 * - Configurable difficulty levels
 */

import type { BodySegment } from '../../shared/types';
import { GAME_CONSTANTS } from '../../shared/types';

// =============================================================================
// TYPES & INTERFACES
// =============================================================================

/** Bot difficulty affects reaction time, accuracy, and aggression */
export type BotDifficulty = 'easy' | 'medium' | 'hard' | 'expert';

/** Bot behavioral states */
export enum BotState {
  IDLE = 'IDLE',
  FORAGING = 'FORAGING',       // Collecting food
  HUNTING = 'HUNTING',         // Chasing smaller players
  FLEEING = 'FLEEING',         // Running from larger players
  CIRCLING = 'CIRCLING',       // Circling prey to trap them
  BOOSTING = 'BOOSTING',       // Speed burst to escape or catch
}

/** 2D Vector for physics calculations */
export interface Vec2 {
  x: number;
  y: number;
}

/** Simplified player data for AI decisions */
export interface AIPlayerView {
  id: string;
  x: number;
  y: number;
  angle: number;
  speed: number;
  bodyLength: number;
  bodySegments: BodySegment[];
  alive: boolean;
}

/** Food data for AI */
export interface AIFoodView {
  id: string;
  x: number;
  y: number;
  value: number;
}

/** Configuration per difficulty level */
export interface DifficultyConfig {
  /** Reaction delay in ms (how fast bot updates decisions) */
  reactionTime: number;
  /** How accurately bot aims (0-1, 1 = perfect) */
  aimAccuracy: number;
  /** How aggressively bot hunts other players (0-1) */
  aggression: number;
  /** Distance at which bot notices threats */
  awarenessRadius: number;
  /** How likely to use boost (0-1) */
  boostWillingness: number;
  /** Minimum body length before hunting */
  huntThreshold: number;
  /** Size advantage needed to hunt (1.5 = 50% larger) */
  sizeAdvantageToHunt: number;
  /** Size disadvantage to trigger fleeing */
  sizeDisadvantageToFlee: number;
  /** How far ahead bot predicts movement */
  predictionTime: number;
  /** Randomness in movement (adds human-like imperfection) */
  movementNoise: number;
}

// =============================================================================
// DIFFICULTY CONFIGURATIONS
// =============================================================================

export const DIFFICULTY_CONFIGS: Record<BotDifficulty, DifficultyConfig> = {
  easy: {
    reactionTime: 500,
    aimAccuracy: 0.6,
    aggression: 0.2,
    awarenessRadius: 300,
    boostWillingness: 0.1,
    huntThreshold: 10,
    sizeAdvantageToHunt: 2.0,
    sizeDisadvantageToFlee: 0.7,
    predictionTime: 0.1,
    movementNoise: 0.3,
  },
  medium: {
    reactionTime: 300,
    aimAccuracy: 0.75,
    aggression: 0.4,
    awarenessRadius: 450,
    boostWillingness: 0.3,
    huntThreshold: 6,
    sizeAdvantageToHunt: 1.5,
    sizeDisadvantageToFlee: 0.6,
    predictionTime: 0.2,
    movementNoise: 0.2,
  },
  hard: {
    reactionTime: 150,
    aimAccuracy: 0.9,
    aggression: 0.6,
    awarenessRadius: 600,
    boostWillingness: 0.5,
    huntThreshold: 4,
    sizeAdvantageToHunt: 1.3,
    sizeDisadvantageToFlee: 0.5,
    predictionTime: 0.35,
    movementNoise: 0.1,
  },
  expert: {
    reactionTime: 80,
    aimAccuracy: 0.97,
    aggression: 0.8,
    awarenessRadius: 800,
    boostWillingness: 0.7,
    huntThreshold: 3,
    sizeAdvantageToHunt: 1.15,
    sizeDisadvantageToFlee: 0.4,
    predictionTime: 0.5,
    movementNoise: 0.05,
  },
};

// =============================================================================
// VECTOR MATH UTILITIES
// =============================================================================

const Vec = {
  create: (x: number, y: number): Vec2 => ({ x, y }),
  
  add: (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y }),
  
  sub: (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y }),
  
  scale: (v: Vec2, s: number): Vec2 => ({ x: v.x * s, y: v.y * s }),
  
  length: (v: Vec2): number => Math.sqrt(v.x * v.x + v.y * v.y),
  
  lengthSq: (v: Vec2): number => v.x * v.x + v.y * v.y,
  
  normalize: (v: Vec2): Vec2 => {
    const len = Vec.length(v);
    if (len === 0) return { x: 0, y: 0 };
    return { x: v.x / len, y: v.y / len };
  },
  
  distance: (a: Vec2, b: Vec2): number => Vec.length(Vec.sub(b, a)),
  
  distanceSq: (a: Vec2, b: Vec2): number => Vec.lengthSq(Vec.sub(b, a)),
  
  dot: (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y,
  
  rotate: (v: Vec2, angle: number): Vec2 => {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    return { x: v.x * cos - v.y * sin, y: v.x * sin + v.y * cos };
  },
  
  fromAngle: (angle: number): Vec2 => ({ x: Math.cos(angle), y: Math.sin(angle) }),
  
  toAngle: (v: Vec2): number => Math.atan2(v.y, v.x),
  
  lerp: (a: Vec2, b: Vec2, t: number): Vec2 => ({
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  }),
  
  clampLength: (v: Vec2, maxLen: number): Vec2 => {
    const len = Vec.length(v);
    if (len <= maxLen) return v;
    return Vec.scale(v, maxLen / len);
  },
};

// =============================================================================
// BOT AI CLASS
// =============================================================================

export class BotAI {
  readonly id: string;
  readonly difficulty: BotDifficulty;
  readonly config: DifficultyConfig;
  
  // State machine
  private state: BotState = BotState.FORAGING;
  private stateTimer: number = 0;
  private lastDecisionTime: number = 0;
  
  // Targets
  private targetFood: AIFoodView | null = null;
  private targetPlayer: AIPlayerView | null = null;
  private fleeFrom: AIPlayerView | null = null;
  
  // Steering
  private wanderAngle: number = 0;
  private stuckCounter: number = 0;
  private lastPosition: Vec2 = { x: 0, y: 0 };
  
  // World bounds
  private readonly worldWidth: number;
  private readonly worldHeight: number;
  private readonly worldMargin: number = 150;
  
  constructor(
    id: string,
    difficulty: BotDifficulty,
    worldWidth: number,
    worldHeight: number
  ) {
    this.id = id;
    this.difficulty = difficulty;
    this.config = DIFFICULTY_CONFIGS[difficulty];
    this.worldWidth = worldWidth;
    this.worldHeight = worldHeight;
    this.wanderAngle = Math.random() * Math.PI * 2;
  }
  
  // ===========================================================================
  // MAIN UPDATE - Called every tick
  // ===========================================================================
  
  /**
   * Main AI update - returns input values for the bot
   */
  update(
    self: AIPlayerView,
    nearbyPlayers: AIPlayerView[],
    nearbyFood: AIFoodView[],
    deltaMs: number
  ): { mouseX: number; mouseY: number; boosting: boolean } {
    const now = Date.now();
    
    // Check if it's time to make a new decision
    if (now - this.lastDecisionTime >= this.config.reactionTime) {
      this.lastDecisionTime = now;
      this.makeDecision(self, nearbyPlayers, nearbyFood);
    }
    
    // Update state timer
    this.stateTimer += deltaMs;
    
    // Check if stuck
    this.checkIfStuck(self);
    
    // Calculate steering based on current state
    const steering = this.calculateSteering(self, nearbyPlayers, nearbyFood);
    
    // Add noise for human-like imperfection
    const noise = this.config.movementNoise;
    steering.x += (Math.random() - 0.5) * noise * 2;
    steering.y += (Math.random() - 0.5) * noise * 2;
    
    // Clamp to valid input range
    const length = Vec.length(steering);
    if (length > 1) {
      steering.x /= length;
      steering.y /= length;
    }
    
    // Determine if should boost
    const shouldBoost = this.shouldBoost(self, nearbyPlayers);
    
    return {
      mouseX: steering.x,
      mouseY: steering.y,
      boosting: shouldBoost,
    };
  }
  
  // ===========================================================================
  // DECISION MAKING
  // ===========================================================================
  
  private makeDecision(
    self: AIPlayerView,
    nearbyPlayers: AIPlayerView[],
    nearbyFood: AIFoodView[]
  ): void {
    // Assess threats and opportunities
    const threats = this.assessThreats(self, nearbyPlayers);
    const prey = this.assessPrey(self, nearbyPlayers);
    
    // State transitions based on priority
    
    // Priority 1: Flee from immediate danger
    if (threats.length > 0 && threats[0].danger > 0.7) {
      this.transitionTo(BotState.FLEEING);
      this.fleeFrom = threats[0].player;
      this.targetPlayer = null;
      return;
    }
    
    // Priority 2: Hunt if we have the advantage and are aggressive
    if (
      prey.length > 0 &&
      self.bodyLength >= this.config.huntThreshold &&
      Math.random() < this.config.aggression
    ) {
      // Check if best prey is worth hunting
      const bestPrey = prey[0];
      if (bestPrey.score > 0.5) {
        this.transitionTo(BotState.HUNTING);
        this.targetPlayer = bestPrey.player;
        this.fleeFrom = null;
        return;
      }
    }
    
    // Priority 3: Forage for food
    this.transitionTo(BotState.FORAGING);
    this.targetFood = this.selectBestFood(self, nearbyFood);
    this.targetPlayer = null;
    this.fleeFrom = null;
  }
  
  private transitionTo(newState: BotState): void {
    if (this.state !== newState) {
      this.state = newState;
      this.stateTimer = 0;
    }
  }
  
  // ===========================================================================
  // THREAT & PREY ASSESSMENT
  // ===========================================================================
  
  private assessThreats(
    self: AIPlayerView,
    players: AIPlayerView[]
  ): Array<{ player: AIPlayerView; danger: number }> {
    const threats: Array<{ player: AIPlayerView; danger: number }> = [];
    
    for (const player of players) {
      if (player.id === self.id || !player.alive) continue;
      
      const distance = Vec.distance(self, player);
      if (distance > this.config.awarenessRadius) continue;
      
      // Calculate size ratio (them / us)
      const sizeRatio = (player.bodyLength + 1) / (self.bodyLength + 1);
      
      // Only consider as threat if they're bigger
      if (sizeRatio > this.config.sizeDisadvantageToFlee) {
        // Danger increases with size advantage and proximity
        const proximityFactor = 1 - (distance / this.config.awarenessRadius);
        const sizeFactor = Math.min(sizeRatio - 1, 1); // Cap at 100% size advantage
        
        // Check if they're heading towards us
        const toUs = Vec.normalize(Vec.sub(self, player));
        const theirDir = Vec.fromAngle(player.angle);
        const approachFactor = Math.max(0, Vec.dot(toUs, theirDir));
        
        const danger = (proximityFactor * 0.4 + sizeFactor * 0.3 + approachFactor * 0.3);
        threats.push({ player, danger });
      }
    }
    
    // Sort by danger level
    return threats.sort((a, b) => b.danger - a.danger);
  }
  
  private assessPrey(
    self: AIPlayerView,
    players: AIPlayerView[]
  ): Array<{ player: AIPlayerView; score: number }> {
    const prey: Array<{ player: AIPlayerView; score: number }> = [];
    
    for (const player of players) {
      if (player.id === self.id || !player.alive) continue;
      
      const distance = Vec.distance(self, player);
      if (distance > this.config.awarenessRadius * 1.5) continue;
      
      // Calculate size ratio (us / them)
      const sizeRatio = (self.bodyLength + 1) / (player.bodyLength + 1);
      
      // Only consider as prey if we're bigger enough
      if (sizeRatio >= this.config.sizeAdvantageToHunt) {
        // Score based on value (their size) and ease (proximity, our advantage)
        const proximityScore = 1 - (distance / (this.config.awarenessRadius * 1.5));
        const valueScore = Math.min(player.bodyLength / 10, 1); // Bigger = more valuable
        const advantageScore = Math.min((sizeRatio - 1) / 0.5, 1);
        
        const score = proximityScore * 0.4 + valueScore * 0.3 + advantageScore * 0.3;
        prey.push({ player, score });
      }
    }
    
    return prey.sort((a, b) => b.score - a.score);
  }
  
  // ===========================================================================
  // FOOD SELECTION
  // ===========================================================================
  
  private selectBestFood(
    self: AIPlayerView,
    food: AIFoodView[]
  ): AIFoodView | null {
    if (food.length === 0) return null;
    
    let bestFood: AIFoodView | null = null;
    let bestScore = -Infinity;
    
    for (const f of food) {
      const distance = Vec.distance(self, f);
      
      // Skip food too far away
      if (distance > this.config.awarenessRadius * 2) continue;
      
      // Score: value / distance (prefer closer and more valuable)
      const score = (f.value * 2) / (distance + 50);
      
      // Bonus for golden food (value > 1)
      const goldenBonus = f.value > 1 ? 1.5 : 1;
      
      const finalScore = score * goldenBonus;
      
      if (finalScore > bestScore) {
        bestScore = finalScore;
        bestFood = f;
      }
    }
    
    return bestFood;
  }
  
  // ===========================================================================
  // STEERING BEHAVIORS
  // ===========================================================================
  
  private calculateSteering(
    self: AIPlayerView,
    players: AIPlayerView[],
    food: AIFoodView[]
  ): Vec2 {
    let steering: Vec2 = { x: 0, y: 0 };
    
    switch (this.state) {
      case BotState.FORAGING:
        steering = this.steerForaging(self, food);
        break;
      case BotState.HUNTING:
        steering = this.steerHunting(self);
        break;
      case BotState.FLEEING:
        steering = this.steerFleeing(self);
        break;
      case BotState.CIRCLING:
        steering = this.steerCircling(self);
        break;
      default:
        steering = this.steerWander(self);
    }
    
    // Always add wall avoidance
    const wallAvoidance = this.avoidWalls(self);
    steering = Vec.add(steering, Vec.scale(wallAvoidance, 2)); // Strong wall avoidance
    
    // Add body segment avoidance for nearby players
    const bodyAvoidance = this.avoidBodies(self, players);
    steering = Vec.add(steering, Vec.scale(bodyAvoidance, 1.5));
    
    return steering;
  }
  
  // --- Foraging Behavior ---
  private steerForaging(self: AIPlayerView, food: AIFoodView[]): Vec2 {
    if (this.targetFood) {
      // Check if target still exists
      const stillExists = food.some(f => f.id === this.targetFood!.id);
      if (!stillExists) {
        this.targetFood = this.selectBestFood(self, food);
      }
    }
    
    if (this.targetFood) {
      return this.seek(self, this.targetFood);
    }
    
    // No food target, wander
    return this.steerWander(self);
  }
  
  // --- Hunting Behavior ---
  private steerHunting(self: AIPlayerView): Vec2 {
    if (!this.targetPlayer || !this.targetPlayer.alive) {
      this.transitionTo(BotState.FORAGING);
      return this.steerWander(self);
    }
    
    // Use pursuit (predict where they'll be)
    return this.pursue(self, this.targetPlayer);
  }
  
  // --- Fleeing Behavior ---
  private steerFleeing(self: AIPlayerView): Vec2 {
    if (!this.fleeFrom || !this.fleeFrom.alive) {
      this.transitionTo(BotState.FORAGING);
      return this.steerWander(self);
    }
    
    // Time-limited fleeing to avoid getting stuck
    if (this.stateTimer > 5000) {
      this.transitionTo(BotState.FORAGING);
      return this.steerWander(self);
    }
    
    return this.flee(self, this.fleeFrom);
  }
  
  // --- Circling Behavior (trap prey) ---
  private steerCircling(self: AIPlayerView): Vec2 {
    if (!this.targetPlayer) return this.steerWander(self);
    
    // Calculate perpendicular direction to target
    const toTarget = Vec.sub(this.targetPlayer, self);
    const perpendicular = Vec.normalize({ x: -toTarget.y, y: toTarget.x });
    
    // Add slight approach
    const approach = Vec.normalize(toTarget);
    
    return Vec.add(Vec.scale(perpendicular, 0.8), Vec.scale(approach, 0.2));
  }
  
  // --- Wander Behavior ---
  private steerWander(self: AIPlayerView): Vec2 {
    // Smoothly change wander angle
    this.wanderAngle += (Math.random() - 0.5) * 0.5;
    
    const wanderDir = Vec.fromAngle(this.wanderAngle);
    
    // Project wander circle ahead
    const ahead = Vec.add(self, Vec.scale(Vec.fromAngle(self.angle), 100));
    const wanderTarget = Vec.add(ahead, Vec.scale(wanderDir, 50));
    
    return this.seek(self, wanderTarget);
  }
  
  // ===========================================================================
  // CORE STEERING FUNCTIONS
  // ===========================================================================
  
  /** Seek: Steer towards a target */
  private seek(from: Vec2, to: Vec2): Vec2 {
    const desired = Vec.normalize(Vec.sub(to, from));
    
    // Apply aim accuracy (add error for lower difficulties)
    if (this.config.aimAccuracy < 1) {
      const error = (1 - this.config.aimAccuracy) * Math.PI * 0.25;
      const errorAngle = (Math.random() - 0.5) * error;
      return Vec.rotate(desired, errorAngle);
    }
    
    return desired;
  }
  
  /** Flee: Steer away from a target */
  private flee(from: Vec2, threat: Vec2): Vec2 {
    const desired = Vec.normalize(Vec.sub(from, threat));
    return desired;
  }
  
  /** Pursue: Predict where target will be and steer there */
  private pursue(self: AIPlayerView, target: AIPlayerView): Vec2 {
    // Predict future position
    const distance = Vec.distance(self, target);
    const predictionTime = (distance / 200) * this.config.predictionTime;
    
    const futurePos: Vec2 = {
      x: target.x + Math.cos(target.angle) * target.speed * predictionTime,
      y: target.y + Math.sin(target.angle) * target.speed * predictionTime,
    };
    
    return this.seek(self, futurePos);
  }
  
  /** Evade: Predict where threat will be and flee from there (used for advanced fleeing) */
  protected evade(self: AIPlayerView, threat: AIPlayerView): Vec2 {
    const distance = Vec.distance(self, threat);
    const predictionTime = (distance / 200) * this.config.predictionTime;
    
    const futurePos: Vec2 = {
      x: threat.x + Math.cos(threat.angle) * threat.speed * predictionTime,
      y: threat.y + Math.sin(threat.angle) * threat.speed * predictionTime,
    };
    
    return this.flee(self, futurePos);
  }
  
  // ===========================================================================
  // OBSTACLE AVOIDANCE
  // ===========================================================================
  
  /** Avoid world boundaries */
  private avoidWalls(self: AIPlayerView): Vec2 {
    const steering: Vec2 = { x: 0, y: 0 };
    const margin = this.worldMargin;
    const strength = 1.5;
    
    // Left wall
    if (self.x < margin) {
      steering.x += (margin - self.x) / margin * strength;
    }
    // Right wall
    if (self.x > this.worldWidth - margin) {
      steering.x -= (self.x - (this.worldWidth - margin)) / margin * strength;
    }
    // Top wall
    if (self.y < margin) {
      steering.y += (margin - self.y) / margin * strength;
    }
    // Bottom wall
    if (self.y > this.worldHeight - margin) {
      steering.y -= (self.y - (this.worldHeight - margin)) / margin * strength;
    }
    
    return steering;
  }
  
  /** Avoid other players' body segments */
  private avoidBodies(self: AIPlayerView, players: AIPlayerView[]): Vec2 {
    const steering: Vec2 = { x: 0, y: 0 };
    const avoidRadius = 60;
    
    for (const player of players) {
      if (player.id === self.id) continue;
      
      // Check head collision
      const headDist = Vec.distance(self, player);
      if (headDist < avoidRadius) {
        const away = Vec.normalize(Vec.sub(self, player));
        const urgency = 1 - (headDist / avoidRadius);
        steering.x += away.x * urgency;
        steering.y += away.y * urgency;
      }
      
      // Check body segments (sample a few for performance)
      const sampleRate = Math.max(1, Math.floor(player.bodySegments.length / 10));
      for (let i = 0; i < player.bodySegments.length; i += sampleRate) {
        const seg = player.bodySegments[i];
        const dist = Vec.distance(self, seg);
        
        if (dist < avoidRadius) {
          const away = Vec.normalize(Vec.sub(self, seg));
          const urgency = 1 - (dist / avoidRadius);
          steering.x += away.x * urgency * 0.5;
          steering.y += away.y * urgency * 0.5;
        }
      }
    }
    
    return steering;
  }
  
  // ===========================================================================
  // BOOST DECISION
  // ===========================================================================
  
  private shouldBoost(self: AIPlayerView, _players: AIPlayerView[]): boolean {
    // Don't boost if body is too small
    if (self.bodyLength <= GAME_CONSTANTS.MIN_BODY_LENGTH + 2) {
      return false;
    }
    
    // Boost when fleeing from immediate danger
    if (this.state === BotState.FLEEING && this.fleeFrom) {
      const distance = Vec.distance(self, this.fleeFrom);
      if (distance < 150 && Math.random() < this.config.boostWillingness) {
        return true;
      }
    }
    
    // Boost when closing in on prey
    if (this.state === BotState.HUNTING && this.targetPlayer) {
      const distance = Vec.distance(self, this.targetPlayer);
      if (distance < 200 && distance > 50 && Math.random() < this.config.boostWillingness * 0.7) {
        return true;
      }
    }
    
    return false;
  }
  
  // ===========================================================================
  // UTILITY
  // ===========================================================================
  
  private checkIfStuck(self: AIPlayerView): void {
    const moved = Vec.distance(self, this.lastPosition);
    
    if (moved < 5) {
      this.stuckCounter++;
      if (this.stuckCounter > 20) {
        // Force wander in new direction
        this.wanderAngle = Math.random() * Math.PI * 2;
        this.stuckCounter = 0;
      }
    } else {
      this.stuckCounter = 0;
    }
    
    this.lastPosition = { x: self.x, y: self.y };
  }
  
  // Public getters for debugging
  getState(): BotState {
    return this.state;
  }
  
  getTarget(): { food: AIFoodView | null; player: AIPlayerView | null; fleeFrom: AIPlayerView | null } {
    return {
      food: this.targetFood,
      player: this.targetPlayer,
      fleeFrom: this.fleeFrom,
    };
  }
}

