/**
 * BotManager.ts - Bot Lifecycle Management for Tōrō
 * 
 * Manages the creation, updating, and removal of AI bots within game rooms.
 * Provides configuration for bot count, difficulty distribution, and names.
 */

import { BotAI, BotDifficulty, AIPlayerView, AIFoodView } from './BotAI';
import type { PlayerInput, Hitodama, BodySegment } from '../../shared/types';
import { GAME_CONSTANTS } from '../../shared/types';

// =============================================================================
// BOT NAMES
// =============================================================================

/** Thematic Japanese-inspired bot names */
const BOT_NAMES = [
  // Fire/Light themed
  'Akari', 'Hikari', 'Hotaru', 'Kasumi', 'Hinata', 'Kaede',
  // Spirit/Ghost themed  
  'Yūrei', 'Obake', 'Tamashī', 'Kage', 'Maboroshi', 'Hanabi',
  // Nature themed
  'Sakura', 'Momiji', 'Kiri', 'Mizu', 'Tsuki', 'Hoshi',
  // Lantern themed
  'Chōchin', 'Tōrō', 'Andon', 'Bonbori',
  // Color themed (for river of souls)
  'Aoi', 'Kurenai', 'Murasaki', 'Shiroi', 'Kuroi',
  // Emotion themed
  'Kanashimi', 'Yorokobi', 'Odayaka', 'Shizuka',
  // Other mystical
  'Kami', 'Oni', 'Tengu', 'Kitsune', 'Tanuki', 'Ryū',
];

/** Optional titles/prefixes for variety */
const BOT_TITLES = ['', '', '', 'Lord ', 'Lady ', '小 ', '大 ', '古 ', '🔥 ', '👻 ', '🏮 '];

// =============================================================================
// CONFIGURATION
// =============================================================================

export interface BotManagerConfig {
  /** Minimum number of bots per room */
  minBotsPerRoom: number;
  /** Maximum number of bots per room */
  maxBotsPerRoom: number;
  /** Target total players (humans + bots) per room */
  targetPlayersPerRoom: number;
  /** Difficulty distribution weights */
  difficultyWeights: Record<BotDifficulty, number>;
  /** Whether bots respawn automatically */
  autoRespawn: boolean;
  /** Respawn delay in ms */
  respawnDelay: number;
}

const DEFAULT_CONFIG: BotManagerConfig = {
  minBotsPerRoom: 2,
  maxBotsPerRoom: 8,
  targetPlayersPerRoom: 6,
  difficultyWeights: {
    easy: 0.3,
    medium: 0.4,
    hard: 0.25,
    expert: 0.05,
  },
  autoRespawn: true,
  respawnDelay: 3000,
};

// =============================================================================
// BOT STATE
// =============================================================================

export interface BotState {
  id: string;
  name: string;
  ai: BotAI;
  difficulty: BotDifficulty;
  // Position and movement
  x: number;
  y: number;
  angle: number;
  speed: number;
  currentAngle: number;
  targetAngle: number;
  currentSpeed: number;
  // Game state
  score: number;
  kills: number;
  alive: boolean;
  bodySegments: BodySegment[];
  targetLength: number;
  // Movement tracking
  positionHistory: Array<{ x: number; y: number; timestamp: number }>;
  boostDropAccumulator: number;
  // Input
  input: PlayerInput;
  lastProcessedInput: number;
  // Respawn
  respawnTime: number;
}

// =============================================================================
// BOT MANAGER CLASS
// =============================================================================

export class BotManager {
  private readonly config: BotManagerConfig;
  private readonly worldWidth: number;
  private readonly worldHeight: number;
  private bots: Map<string, BotState> = new Map();
  private botIdCounter: number = 0;
  private usedNames: Set<string> = new Set();
  
  constructor(
    worldWidth: number,
    worldHeight: number,
    config: Partial<BotManagerConfig> = {}
  ) {
    this.worldWidth = worldWidth;
    this.worldHeight = worldHeight;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }
  
  // ===========================================================================
  // BOT LIFECYCLE
  // ===========================================================================
  
  /**
   * Create a new bot and add it to the room
   */
  createBot(roomId: string): BotState {
    const id = `bot-${roomId}-${this.botIdCounter++}`;
    const name = this.generateBotName();
    const difficulty = this.selectDifficulty();
    
    const startX = this.worldWidth / 2 + (Math.random() - 0.5) * 2000;
    const startY = this.worldHeight / 2 + (Math.random() - 0.5) * 2000;
    const startAngle = Math.random() * Math.PI * 2;
    
    const ai = new BotAI(id, difficulty, this.worldWidth, this.worldHeight);
    
    const bot: BotState = {
      id,
      name,
      ai,
      difficulty,
      x: startX,
      y: startY,
      angle: startAngle,
      speed: 0,
      currentAngle: startAngle,
      targetAngle: startAngle,
      currentSpeed: 0,
      score: 0,
      kills: 0,
      alive: true,
      bodySegments: [],
      targetLength: GAME_CONSTANTS.STARTING_BODY_LENGTH,
      positionHistory: this.initializePositionHistory(startX, startY, startAngle),
      boostDropAccumulator: 0,
      input: {
        sequence: 0,
        mouseX: 0,
        mouseY: 0,
        boosting: false,
        timestamp: Date.now(),
      },
      lastProcessedInput: 0,
      respawnTime: 0,
    };
    
    this.bots.set(id, bot);
    console.log(`🤖 Bot created: ${name} (${difficulty}) in room ${roomId}`);
    
    return bot;
  }
  
  /**
   * Remove a bot
   */
  removeBot(botId: string): boolean {
    const bot = this.bots.get(botId);
    if (bot) {
      this.usedNames.delete(bot.name);
      this.bots.delete(botId);
      console.log(`🤖 Bot removed: ${bot.name}`);
      return true;
    }
    return false;
  }
  
  /**
   * Get a bot by ID
   */
  getBot(botId: string): BotState | undefined {
    return this.bots.get(botId);
  }
  
  /**
   * Get all bots
   */
  getAllBots(): Map<string, BotState> {
    return this.bots;
  }
  
  /**
   * Get bots for a specific room (by ID prefix)
   */
  getBotsForRoom(roomId: string): BotState[] {
    return Array.from(this.bots.values()).filter(
      bot => bot.id.startsWith(`bot-${roomId}-`)
    );
  }
  
  /**
   * Check if an ID belongs to a bot
   */
  isBot(id: string): boolean {
    return id.startsWith('bot-');
  }
  
  // ===========================================================================
  // BOT AI UPDATE
  // ===========================================================================
  
  /**
   * Update all bots' AI - call this every tick
   */
  updateBotAI(
    roomId: string,
    allPlayers: Map<string, AIPlayerView>,
    food: Map<string, Hitodama>,
    deltaMs: number
  ): void {
    const roomBots = this.getBotsForRoom(roomId);
    
    for (const bot of roomBots) {
      if (!bot.alive) continue;
      
      // Convert bot to AIPlayerView
      const selfView: AIPlayerView = {
        id: bot.id,
        x: bot.x,
        y: bot.y,
        angle: bot.angle,
        speed: bot.speed,
        bodyLength: bot.bodySegments.length,
        bodySegments: bot.bodySegments,
        alive: bot.alive,
      };
      
      // Get nearby players (including other bots)
      const nearbyPlayers = this.getNearbyPlayers(bot, allPlayers, 800);
      
      // Get nearby food
      const nearbyFood = this.getNearbyFood(bot, food, 600);
      
      // Run AI update
      const aiOutput = bot.ai.update(selfView, nearbyPlayers, nearbyFood, deltaMs);
      
      // Apply AI output to bot input
      bot.input = {
        sequence: bot.input.sequence + 1,
        mouseX: aiOutput.mouseX,
        mouseY: aiOutput.mouseY,
        boosting: aiOutput.boosting,
        timestamp: Date.now(),
      };
    }
  }
  
  /**
   * Check for bot respawns
   */
  checkRespawns(): BotState[] {
    const respawned: BotState[] = [];
    const now = Date.now();
    
    for (const bot of this.bots.values()) {
      if (!bot.alive && bot.respawnTime > 0 && now >= bot.respawnTime) {
        this.respawnBot(bot);
        respawned.push(bot);
      }
    }
    
    return respawned;
  }
  
  private respawnBot(bot: BotState): void {
    bot.x = this.worldWidth / 2 + (Math.random() - 0.5) * 2000;
    bot.y = this.worldHeight / 2 + (Math.random() - 0.5) * 2000;
    bot.angle = Math.random() * Math.PI * 2;
    bot.currentAngle = bot.angle;
    bot.targetAngle = bot.angle;
    bot.currentSpeed = 0;
    bot.speed = 0;
    bot.alive = true;
    bot.score = 0;
    bot.targetLength = GAME_CONSTANTS.STARTING_BODY_LENGTH;
    bot.bodySegments = [];
    bot.respawnTime = 0;
    bot.boostDropAccumulator = 0;
    bot.positionHistory = this.initializePositionHistory(bot.x, bot.y, bot.angle);
    
    console.log(`🤖 Bot respawned: ${bot.name}`);
  }
  
  /**
   * Mark a bot as dead
   */
  killBot(bot: BotState): void {
    bot.alive = false;
    bot.respawnTime = this.config.autoRespawn ? Date.now() + this.config.respawnDelay : 0;
    bot.bodySegments = [];
    bot.targetLength = 0;
    bot.positionHistory = [];
  }
  
  // ===========================================================================
  // ROOM POPULATION MANAGEMENT
  // ===========================================================================
  
  /**
   * Ensure room has adequate bot population
   * Call this when players join/leave
   */
  balanceRoomBots(roomId: string, humanPlayerCount: number): { added: BotState[]; removed: string[] } {
    const currentBots = this.getBotsForRoom(roomId);
    
    const added: BotState[] = [];
    const removed: string[] = [];
    
    // Calculate target bot count
    let targetBotCount = Math.max(
      this.config.minBotsPerRoom,
      Math.min(
        this.config.maxBotsPerRoom,
        this.config.targetPlayersPerRoom - humanPlayerCount
      )
    );
    
    // If room is very populated, reduce bots
    if (humanPlayerCount >= this.config.targetPlayersPerRoom) {
      targetBotCount = this.config.minBotsPerRoom;
    }
    
    const currentBotCount = currentBots.length;
    
    // Add bots if needed
    if (currentBotCount < targetBotCount) {
      const toAdd = targetBotCount - currentBotCount;
      for (let i = 0; i < toAdd; i++) {
        added.push(this.createBot(roomId));
      }
    }
    
    // Remove bots if too many (prefer removing dead/low-score bots)
    if (currentBotCount > targetBotCount) {
      const toRemove = currentBotCount - targetBotCount;
      const sortedBots = [...currentBots].sort((a, b) => {
        // Dead bots first
        if (!a.alive && b.alive) return -1;
        if (a.alive && !b.alive) return 1;
        // Then by score (lowest first)
        return a.score - b.score;
      });
      
      for (let i = 0; i < toRemove && i < sortedBots.length; i++) {
        removed.push(sortedBots[i].id);
        this.removeBot(sortedBots[i].id);
      }
    }
    
    return { added, removed };
  }
  
  // ===========================================================================
  // UTILITY FUNCTIONS
  // ===========================================================================
  
  private generateBotName(): string {
    // Try to get unused name
    for (let attempt = 0; attempt < 50; attempt++) {
      const title = BOT_TITLES[Math.floor(Math.random() * BOT_TITLES.length)];
      const name = BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)];
      const fullName = `${title}${name}`;
      
      if (!this.usedNames.has(fullName)) {
        this.usedNames.add(fullName);
        return fullName;
      }
    }
    
    // Fallback with number
    const name = BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)];
    const num = Math.floor(Math.random() * 100);
    return `${name}${num}`;
  }
  
  private selectDifficulty(): BotDifficulty {
    const weights = this.config.difficultyWeights;
    const total = Object.values(weights).reduce((sum, w) => sum + w, 0);
    let random = Math.random() * total;
    
    for (const [difficulty, weight] of Object.entries(weights) as [BotDifficulty, number][]) {
      random -= weight;
      if (random <= 0) {
        return difficulty;
      }
    }
    
    return 'medium'; // Default fallback
  }
  
  private initializePositionHistory(
    x: number,
    y: number,
    angle: number
  ): Array<{ x: number; y: number; timestamp: number }> {
    const history: Array<{ x: number; y: number; timestamp: number }> = [];
    const historyLength = GAME_CONSTANTS.STARTING_BODY_LENGTH * GAME_CONSTANTS.BODY_SEGMENT_SPACING * 2;
    
    for (let i = 0; i < historyLength; i++) {
      history.push({
        x: x - Math.cos(angle) * i * 0.5,
        y: y - Math.sin(angle) * i * 0.5,
        timestamp: Date.now() - i,
      });
    }
    
    return history;
  }
  
  private getNearbyPlayers(
    bot: BotState,
    allPlayers: Map<string, AIPlayerView>,
    radius: number
  ): AIPlayerView[] {
    const nearby: AIPlayerView[] = [];
    const radiusSq = radius * radius;
    
    for (const player of allPlayers.values()) {
      if (player.id === bot.id) continue;
      
      const dx = player.x - bot.x;
      const dy = player.y - bot.y;
      const distSq = dx * dx + dy * dy;
      
      if (distSq <= radiusSq) {
        nearby.push(player);
      }
    }
    
    // Also include other bots
    for (const otherBot of this.bots.values()) {
      if (otherBot.id === bot.id || !otherBot.alive) continue;
      
      const dx = otherBot.x - bot.x;
      const dy = otherBot.y - bot.y;
      const distSq = dx * dx + dy * dy;
      
      if (distSq <= radiusSq) {
        nearby.push({
          id: otherBot.id,
          x: otherBot.x,
          y: otherBot.y,
          angle: otherBot.angle,
          speed: otherBot.speed,
          bodyLength: otherBot.bodySegments.length,
          bodySegments: otherBot.bodySegments,
          alive: otherBot.alive,
        });
      }
    }
    
    return nearby;
  }
  
  private getNearbyFood(
    bot: BotState,
    food: Map<string, Hitodama>,
    radius: number
  ): AIFoodView[] {
    const nearby: AIFoodView[] = [];
    const radiusSq = radius * radius;
    
    for (const item of food.values()) {
      const dx = item.x - bot.x;
      const dy = item.y - bot.y;
      const distSq = dx * dx + dy * dy;
      
      if (distSq <= radiusSq) {
        nearby.push({
          id: item.id,
          x: item.x,
          y: item.y,
          value: item.value,
        });
      }
    }
    
    return nearby;
  }
  
  // ===========================================================================
  // STATISTICS
  // ===========================================================================
  
  getStats(): {
    totalBots: number;
    aliveBots: number;
    byDifficulty: Record<BotDifficulty, number>;
  } {
    const stats = {
      totalBots: this.bots.size,
      aliveBots: 0,
      byDifficulty: {
        easy: 0,
        medium: 0,
        hard: 0,
        expert: 0,
      } as Record<BotDifficulty, number>,
    };
    
    for (const bot of this.bots.values()) {
      if (bot.alive) stats.aliveBots++;
      stats.byDifficulty[bot.difficulty]++;
    }
    
    return stats;
  }
}

