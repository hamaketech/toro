import express from 'express';
import { createServer } from 'http';
import { Server, Socket } from 'socket.io';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import type { 
  ServerToClientEvents, 
  ClientToServerEvents, 
  PlayerInput, 
  PlayerState, 
  GameSnapshot,
  InitialGameState,
  Hitodama,
  BodySegment,
  DeathEvent,
  DeathCause,
  ScoreboardEntry,
  JoinOptions,
} from '../../shared/types';
import { GAME_CONSTANTS } from '../../shared/types';

// =============================================================================
// SERVER CONFIGURATION
// =============================================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = parseInt(process.env.PORT || '3001', 10);
const NODE_ENV = process.env.NODE_ENV || 'development';
const TICK_RATE = 20;

const WORLD_WIDTH = 6000;
const WORLD_HEIGHT = 6000;

const PLAYER_CONFIG = {
  RADIUS: 20,
  BASE_SPEED: 200,
  TURN_SPEED: 4,
  BOOST_MULTIPLIER: 1.5,
};

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

interface PositionRecord {
  x: number;
  y: number;
  timestamp: number;
}

interface ServerPlayerState extends PlayerState {
  input: PlayerInput;
  currentAngle: number;
  targetAngle: number;
  currentSpeed: number;
  positionHistory: PositionRecord[];
  boostDropAccumulator: number;
  /** Socket reference for this player */
  socket: GameSocket;
  /** Time when player can respawn (0 if alive) */
  respawnTime: number;
  /** Whether player has officially joined (set name) */
  hasJoined: boolean;
}

// =============================================================================
// GAME STATE
// =============================================================================

const players: Map<string, ServerPlayerState> = new Map();
const food: Map<string, Hitodama> = new Map();
let currentTick = 0;
let foodIdCounter = 0;

// =============================================================================
// EXPRESS + SOCKET.IO SETUP
// =============================================================================

const app = express();
const httpServer = createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

// =============================================================================
// STATIC FILE SERVING (Production)
// =============================================================================

if (NODE_ENV === 'production') {
  // Serve the built client from client/dist
  const clientDistPath = join(__dirname, '../../client/dist');
  const clientPublicPath = join(__dirname, '../../client/public');
  
  // Serve static assets
  app.use(express.static(clientDistPath));
  app.use('/images', express.static(join(clientPublicPath, 'images')));
  
  // SPA fallback - serve index.html for all non-API routes
  app.get('*', (req, res, next) => {
    // Skip API routes and socket.io
    if (req.path.startsWith('/api') || req.path.startsWith('/socket.io')) {
      return next();
    }
    res.sendFile(join(clientDistPath, 'index.html'));
  });
  
  console.log('📦 Production mode: Serving static files from client/dist');
}

// Health check / status endpoint
app.get('/api/status', (_req, res) => {
  res.json({ 
    status: 'ok', 
    players: players.size,
    food: food.size,
    tick: currentTick,
    uptime: process.uptime(),
    env: NODE_ENV,
  });
});

// =============================================================================
// FOOD SYSTEM
// =============================================================================

function generateFoodId(): string {
  return `food_${++foodIdCounter}`;
}

// Food spawning configuration
const FOOD_CONFIG = {
  CLUSTER_CHANCE: 0.15,       // 15% chance to spawn a cluster instead of single food
  CLUSTER_SIZE_MIN: 3,
  CLUSTER_SIZE_MAX: 6,
  CLUSTER_SPREAD: 80,         // How spread out cluster food is
  GOLDEN_CHANCE: 0.05,        // 5% chance for golden (high value) food
  GOLDEN_MULTIPLIER: 3,       // Golden food worth 3x
  EDGE_BIAS: 0.3,             // 30% chance to spawn near edges
  EDGE_MARGIN: 400,           // Distance from edge for edge spawns
  PLAYER_AVOIDANCE_RADIUS: 300, // Try not to spawn within this radius of players
  SPAWN_RATE_PER_PLAYER: 0.5, // Extra spawn rate per active player
  BURST_CHANCE: 0.02,         // 2% chance per tick for a food burst event
  BURST_SIZE: 8,              // How many food in a burst
};

let tickCounter = 0;

function spawnFood(x?: number, y?: number, value?: number): Hitodama {
  const id = generateFoodId();
  const padding = 50;
  
  // Determine if this is golden food (only for natural spawns)
  const isGolden = value === undefined && Math.random() < FOOD_CONFIG.GOLDEN_CHANCE;
  const foodValue = value ?? (isGolden ? GAME_CONSTANTS.FOOD_BASE_VALUE * FOOD_CONFIG.GOLDEN_MULTIPLIER : GAME_CONSTANTS.FOOD_BASE_VALUE);
  
  const hitodama: Hitodama = {
    id,
    x: x ?? padding + Math.random() * (WORLD_WIDTH - padding * 2),
    y: y ?? padding + Math.random() * (WORLD_HEIGHT - padding * 2),
    value: foodValue,
    radius: isGolden ? GAME_CONSTANTS.FOOD_RADIUS * 1.3 : GAME_CONSTANTS.FOOD_RADIUS,
  };
  
  food.set(id, hitodama);
  return hitodama;
}

function findSpawnLocation(): { x: number; y: number } {
  const padding = 50;
  
  // Edge bias - sometimes spawn near edges to encourage exploration
  if (Math.random() < FOOD_CONFIG.EDGE_BIAS) {
    const edge = Math.floor(Math.random() * 4);
    switch (edge) {
      case 0: // Top
        return { 
          x: padding + Math.random() * (WORLD_WIDTH - padding * 2),
          y: padding + Math.random() * FOOD_CONFIG.EDGE_MARGIN
        };
      case 1: // Bottom
        return { 
          x: padding + Math.random() * (WORLD_WIDTH - padding * 2),
          y: WORLD_HEIGHT - padding - Math.random() * FOOD_CONFIG.EDGE_MARGIN
        };
      case 2: // Left
        return { 
          x: padding + Math.random() * FOOD_CONFIG.EDGE_MARGIN,
          y: padding + Math.random() * (WORLD_HEIGHT - padding * 2)
        };
      case 3: // Right
        return { 
          x: WORLD_WIDTH - padding - Math.random() * FOOD_CONFIG.EDGE_MARGIN,
          y: padding + Math.random() * (WORLD_HEIGHT - padding * 2)
        };
    }
  }
  
  // Try to spawn away from players (3 attempts)
  for (let attempt = 0; attempt < 3; attempt++) {
    const x = padding + Math.random() * (WORLD_WIDTH - padding * 2);
    const y = padding + Math.random() * (WORLD_HEIGHT - padding * 2);
    
    let tooClose = false;
    for (const player of players.values()) {
      if (!player.alive) continue;
      const dx = player.x - x;
      const dy = player.y - y;
      if (Math.sqrt(dx * dx + dy * dy) < FOOD_CONFIG.PLAYER_AVOIDANCE_RADIUS) {
        tooClose = true;
        break;
      }
    }
    
    if (!tooClose) {
      return { x, y };
    }
  }
  
  // Fallback to random location
  return {
    x: padding + Math.random() * (WORLD_WIDTH - padding * 2),
    y: padding + Math.random() * (WORLD_HEIGHT - padding * 2)
  };
}

function spawnFoodCluster(centerX: number, centerY: number): void {
  const clusterSize = FOOD_CONFIG.CLUSTER_SIZE_MIN + 
    Math.floor(Math.random() * (FOOD_CONFIG.CLUSTER_SIZE_MAX - FOOD_CONFIG.CLUSTER_SIZE_MIN + 1));
  
  for (let i = 0; i < clusterSize; i++) {
    const angle = (i / clusterSize) * Math.PI * 2 + Math.random() * 0.5;
    const dist = Math.random() * FOOD_CONFIG.CLUSTER_SPREAD;
    const x = centerX + Math.cos(angle) * dist;
    const y = centerY + Math.sin(angle) * dist;
    
    // Clamp to world bounds
    const padding = 50;
    const clampedX = Math.max(padding, Math.min(WORLD_WIDTH - padding, x));
    const clampedY = Math.max(padding, Math.min(WORLD_HEIGHT - padding, y));
    
    spawnFood(clampedX, clampedY);
  }
}

function spawnInitialFood(): void {
  const initialCount = Math.floor(GAME_CONSTANTS.MAX_FOOD_COUNT * 0.7);
  
  // Spawn some clusters and some individual food
  const clusterCount = Math.floor(initialCount / 8);
  let spawned = 0;
  
  // Spawn clusters first
  for (let i = 0; i < clusterCount && spawned < initialCount; i++) {
    const loc = findSpawnLocation();
    spawnFoodCluster(loc.x, loc.y);
    spawned += FOOD_CONFIG.CLUSTER_SIZE_MIN;
  }
  
  // Fill rest with individual food
  while (spawned < initialCount) {
    const loc = findSpawnLocation();
    spawnFood(loc.x, loc.y);
    spawned++;
  }
  
  console.log(`Spawned ${food.size} initial food items (with clusters)`);
}

function maintainFoodCount(): void {
  tickCounter++;
  const currentCount = food.size;
  
  if (currentCount >= GAME_CONSTANTS.MAX_FOOD_COUNT) return;
  
  // Dynamic spawn rate based on player count
  const activePlayers = [...players.values()].filter(p => p.alive).length;
  const dynamicSpawnRate = GAME_CONSTANTS.FOOD_SPAWN_RATE + 
    Math.floor(activePlayers * FOOD_CONFIG.SPAWN_RATE_PER_PLAYER);
  
  // Food burst event - exciting moment where lots of food appears
  if (Math.random() < FOOD_CONFIG.BURST_CHANCE && currentCount < GAME_CONSTANTS.MAX_FOOD_COUNT * 0.8) {
    const burstLoc = findSpawnLocation();
    console.log(`Food burst at (${Math.round(burstLoc.x)}, ${Math.round(burstLoc.y)})!`);
    for (let i = 0; i < FOOD_CONFIG.BURST_SIZE; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = Math.random() * 120;
      spawnFood(
        burstLoc.x + Math.cos(angle) * dist,
        burstLoc.y + Math.sin(angle) * dist
      );
    }
    return;
  }
  
  // Regular spawning
  const toSpawn = Math.min(dynamicSpawnRate, GAME_CONSTANTS.MAX_FOOD_COUNT - currentCount);
  
  for (let i = 0; i < toSpawn; i++) {
    // Occasionally spawn a cluster instead of single food
    if (Math.random() < FOOD_CONFIG.CLUSTER_CHANCE && currentCount + 5 < GAME_CONSTANTS.MAX_FOOD_COUNT) {
      const loc = findSpawnLocation();
      spawnFoodCluster(loc.x, loc.y);
    } else {
      const loc = findSpawnLocation();
      spawnFood(loc.x, loc.y);
    }
  }
}

function updateFoodMagnetism(deltaS: number): void {
  for (const player of players.values()) {
    if (!player.alive) continue;
    
    // Bigger players have stronger pull (1x base, up to 2.5x at 20+ segments)
    const bodyCount = player.bodySegments.length;
    const sizePullMultiplier = 1 + Math.min(bodyCount * 0.075, 1.5);
    const magnetRadius = GAME_CONSTANTS.FOOD_MAGNET_RADIUS * (1 + Math.min(bodyCount * 0.02, 0.4));
    
    for (const item of food.values()) {
      const dx = player.x - item.x;
      const dy = player.y - item.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      
      if (distance < magnetRadius && distance > 0) {
        const pullFactor = 1 - (distance / magnetRadius);
        const pullStrength = GAME_CONSTANTS.FOOD_MAGNET_STRENGTH * pullFactor * pullFactor * sizePullMultiplier;
        
        const normalizedDx = dx / distance;
        const normalizedDy = dy / distance;
        
        item.x += normalizedDx * pullStrength * deltaS;
        item.y += normalizedDy * pullStrength * deltaS;
      }
    }
  }
}

function checkFoodCollisions(): void {
  const collectionRadius = PLAYER_CONFIG.RADIUS + GAME_CONSTANTS.FOOD_RADIUS;
  
  for (const player of players.values()) {
    if (!player.alive) continue;
    
    const foodToRemove: string[] = [];
    
    for (const item of food.values()) {
      const dx = player.x - item.x;
      const dy = player.y - item.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      
      if (distance < collectionRadius) {
        player.score += item.value;
        player.targetLength += item.value * GAME_CONSTANTS.GROWTH_PER_FOOD;
        foodToRemove.push(item.id);
        io.emit('foodCollected', item.id, player.id);
      }
    }
    
    for (const id of foodToRemove) {
      food.delete(id);
    }
  }
}

// =============================================================================
// COLLISION SYSTEM
// =============================================================================

function checkPlayerCollisions(): void {
  const playersArray = Array.from(players.values()).filter(p => p.alive);
  const deaths: Array<{ player: ServerPlayerState; cause: DeathCause; killer?: ServerPlayerState }> = [];
  
  for (const player of playersArray) {
    // Skip if already marked for death this tick
    if (deaths.some(d => d.player.id === player.id)) continue;
    
    // Check world border collision
    if (isAtWorldBorder(player)) {
      deaths.push({ player, cause: 'world_border' });
      continue;
    }
    
    // Check collision with other players
    for (const other of playersArray) {
      if (player.id === other.id) continue;
      if (deaths.some(d => d.player.id === player.id)) break;
      
      // Head vs Head collision
      const headDist = distance(player.x, player.y, other.x, other.y);
      if (headDist < PLAYER_CONFIG.RADIUS * 2) {
        if (GAME_CONSTANTS.HEAD_COLLISION_BOTH_DIE) {
          // Both die
          deaths.push({ player, cause: 'head_to_head', killer: other });
          deaths.push({ player: other, cause: 'head_to_head', killer: player });
        } else {
          // Smaller one dies (based on body length)
          const playerSize = player.bodySegments.length;
          const otherSize = other.bodySegments.length;
          
          if (playerSize <= otherSize) {
            deaths.push({ player, cause: 'head_to_head', killer: other });
          }
          if (otherSize <= playerSize) {
            deaths.push({ player: other, cause: 'head_to_head', killer: player });
          }
        }
        continue;
      }
      
      // Head vs Body collision (my head hits their body)
      for (const segment of other.bodySegments) {
        const segDist = distance(player.x, player.y, segment.x, segment.y);
        if (segDist < PLAYER_CONFIG.RADIUS + GAME_CONSTANTS.BODY_SEGMENT_HITBOX) {
          deaths.push({ player, cause: 'head_collision', killer: other });
          break;
        }
      }
    }
  }
  
  // Process all deaths
  for (const { player, cause, killer } of deaths) {
    killPlayer(player, cause, killer);
  }
}

function isAtWorldBorder(player: ServerPlayerState): boolean {
  const margin = PLAYER_CONFIG.RADIUS * 0.5; // Small margin before death
  return (
    player.x <= margin ||
    player.x >= WORLD_WIDTH - margin ||
    player.y <= margin ||
    player.y >= WORLD_HEIGHT - margin
  );
}

function distance(x1: number, y1: number, x2: number, y2: number): number {
  const dx = x1 - x2;
  const dy = y1 - y2;
  return Math.sqrt(dx * dx + dy * dy);
}

// =============================================================================
// DEATH & RESPAWN SYSTEM
// =============================================================================

function killPlayer(
  player: ServerPlayerState, 
  cause: DeathCause, 
  killer?: ServerPlayerState
): void {
  if (!player.alive) return;
  
  console.log(`Player ${player.name} (${player.id}) died: ${cause}${killer ? ` (killed by ${killer.name})` : ''}`);
  
  // Mark as dead
  player.alive = false;
  player.respawnTime = Date.now() + GAME_CONSTANTS.RESPAWN_DELAY;
  
  // Award kill to killer
  if (killer && killer.id !== player.id) {
    killer.kills++;
  }
  
  // Drop all body segments as high-value food
  let foodDropped = 0;
  for (const segment of player.bodySegments) {
    spawnFood(
      segment.x + (Math.random() - 0.5) * 30,
      segment.y + (Math.random() - 0.5) * 30,
      GAME_CONSTANTS.DEATH_DROP_VALUE
    );
    foodDropped++;
  }
  
  // Also drop some food at the head position
  const headDrops = Math.min(5, Math.floor(player.score / 10) + 1);
  for (let i = 0; i < headDrops; i++) {
    const angle = (i / headDrops) * Math.PI * 2;
    const dist = 20 + Math.random() * 30;
    spawnFood(
      player.x + Math.cos(angle) * dist,
      player.y + Math.sin(angle) * dist,
      GAME_CONSTANTS.DEATH_DROP_VALUE
    );
    foodDropped++;
  }
  
  // Clear body segments
  player.bodySegments = [];
  player.targetLength = 0;
  player.positionHistory = [];
  
  // Emit death event
  const deathEvent: DeathEvent = {
    playerId: player.id,
    cause,
    killerId: killer?.id,
    killerName: killer?.name,
    x: player.x,
    y: player.y,
    score: player.score,
    foodDropped,
  };
  
  io.emit('playerDied', deathEvent);
}

function respawnPlayer(player: ServerPlayerState): void {
  console.log(`Player ${player.id} respawning`);
  
  // Reset position to random location
  player.x = WORLD_WIDTH / 2 + (Math.random() - 0.5) * 2000;
  player.y = WORLD_HEIGHT / 2 + (Math.random() - 0.5) * 2000;
  player.angle = Math.random() * Math.PI * 2;
  player.currentAngle = player.angle;
  player.targetAngle = player.angle;
  
  // Reset state
  player.alive = true;
  player.score = 0;
  player.targetLength = GAME_CONSTANTS.STARTING_BODY_LENGTH;
  player.bodySegments = [];
  player.respawnTime = 0;
  player.currentSpeed = 0;
  player.boostDropAccumulator = 0;
  
  // Initialize position history
  player.positionHistory = [{ x: player.x, y: player.y, timestamp: Date.now() }];
  const historyLength = GAME_CONSTANTS.STARTING_BODY_LENGTH * GAME_CONSTANTS.BODY_SEGMENT_SPACING * 2;
  for (let i = 0; i < historyLength; i++) {
    player.positionHistory.push({
      x: player.x - Math.cos(player.angle) * i * 0.5,
      y: player.y - Math.sin(player.angle) * i * 0.5,
      timestamp: Date.now() - i,
    });
  }
  
  io.emit('playerRespawned', player.id);
}

function checkRespawns(): void {
  const now = Date.now();
  
  for (const player of players.values()) {
    if (!player.alive && player.respawnTime > 0 && now >= player.respawnTime) {
      respawnPlayer(player);
    }
  }
}

// =============================================================================
// SCOREBOARD
// =============================================================================

function buildScoreboard(): ScoreboardEntry[] {
  const entries: ScoreboardEntry[] = [];
  
  for (const player of players.values()) {
    if (!player.hasJoined) continue; // Only show players who have joined
    entries.push({
      id: player.id,
      name: player.name,
      score: player.score,
      kills: player.kills,
      bodyLength: player.bodySegments.length,
    });
  }
  
  // Sort by score descending
  entries.sort((a, b) => b.score - a.score);
  
  // Return top N
  return entries.slice(0, GAME_CONSTANTS.SCOREBOARD_SIZE);
}

// =============================================================================
// BODY SEGMENT SYSTEM
// =============================================================================

function updatePositionHistory(player: ServerPlayerState): void {
  if (!player.alive) return;
  
  const now = Date.now();
  
  player.positionHistory.unshift({
    x: player.x,
    y: player.y,
    timestamp: now,
  });
  
  const firstGap = GAME_CONSTANTS.FIRST_SEGMENT_GAP;
  const segmentSpacing = GAME_CONSTANTS.BODY_SEGMENT_SPACING;
  const historyResolution = GAME_CONSTANTS.POSITION_HISTORY_RESOLUTION;
  const maxSegments = Math.max(player.targetLength, player.bodySegments.length) + 5;
  const totalDistance = firstGap + (maxSegments - 1) * segmentSpacing;
  const maxHistoryLength = totalDistance * historyResolution;
  
  while (player.positionHistory.length > maxHistoryLength) {
    player.positionHistory.pop();
  }
}

function calculateBodySegments(player: ServerPlayerState): BodySegment[] {
  if (!player.alive) return [];
  
  const segments: BodySegment[] = [];
  const firstGap = GAME_CONSTANTS.FIRST_SEGMENT_GAP;
  const segmentSpacing = GAME_CONSTANTS.BODY_SEGMENT_SPACING;
  const history = player.positionHistory;
  
  if (history.length < 2) {
    return segments;
  }
  
  const currentLength = Math.min(
    player.bodySegments.length + 1,
    player.targetLength
  );
  
  let distanceAccumulated = 0;
  let segmentIndex = 0;
  
  for (let i = 1; i < history.length && segmentIndex < currentLength; i++) {
    const prev = history[i - 1];
    const curr = history[i];
    
    const dx = prev.x - curr.x;
    const dy = prev.y - curr.y;
    const segmentDistance = Math.sqrt(dx * dx + dy * dy);
    
    distanceAccumulated += segmentDistance;
    
    const requiredSpacing = segmentIndex === 0 ? firstGap : segmentSpacing;
    
    while (distanceAccumulated >= requiredSpacing && segmentIndex < currentLength) {
      const overshoot = distanceAccumulated - requiredSpacing;
      const t = segmentDistance > 0 ? overshoot / segmentDistance : 0;
      
      segments.push({
        x: curr.x + dx * t,
        y: curr.y + dy * t,
      });
      
      distanceAccumulated -= requiredSpacing;
      segmentIndex++;
    }
  }
  
  return segments;
}

// =============================================================================
// BOOST DROP SYSTEM
// =============================================================================

function handleBoostDrop(player: ServerPlayerState, deltaS: number): void {
  if (!player.alive) return;
  if (!player.input.boosting || player.targetLength <= GAME_CONSTANTS.MIN_BODY_LENGTH) {
    return;
  }
  
  player.boostDropAccumulator += GAME_CONSTANTS.BOOST_DROP_RATE * deltaS;
  
  while (player.boostDropAccumulator >= 1 && player.targetLength > GAME_CONSTANTS.MIN_BODY_LENGTH) {
    player.boostDropAccumulator -= 1;
    player.targetLength--;
    
    const tailSegment = player.bodySegments[player.bodySegments.length - 1];
    if (tailSegment) {
      spawnFood(
        tailSegment.x + (Math.random() - 0.5) * 10,
        tailSegment.y + (Math.random() - 0.5) * 10,
        GAME_CONSTANTS.DROPPED_PELLET_VALUE
      );
    }
  }
}

// =============================================================================
// PLAYER MANAGEMENT
// =============================================================================

function createPlayer(playerId: string, socket: GameSocket, name = 'Wandering Soul'): ServerPlayerState {
  const startX = WORLD_WIDTH / 2 + (Math.random() - 0.5) * 1500;
  const startY = WORLD_HEIGHT / 2 + (Math.random() - 0.5) * 1500;
  const startAngle = Math.random() * Math.PI * 2;
  
  // Sanitize and trim name
  const sanitizedName = name.trim().substring(0, 16) || 'Wandering Soul';
  
  const player: ServerPlayerState = {
    id: playerId,
    name: sanitizedName,
    x: startX,
    y: startY,
    angle: startAngle,
    speed: 0,
    score: 0,
    bodySegments: [],
    targetLength: GAME_CONSTANTS.STARTING_BODY_LENGTH,
    lastProcessedInput: 0,
    alive: true,
    kills: 0,
    input: {
      sequence: 0,
      mouseX: 0,
      mouseY: 0,
      boosting: false,
      timestamp: Date.now(),
    },
    currentAngle: startAngle,
    targetAngle: startAngle,
    currentSpeed: 0,
    positionHistory: [{ x: startX, y: startY, timestamp: Date.now() }],
    boostDropAccumulator: 0,
    socket,
    respawnTime: 0,
    hasJoined: false,
  };
  
  const historyLength = GAME_CONSTANTS.STARTING_BODY_LENGTH * GAME_CONSTANTS.BODY_SEGMENT_SPACING * 2;
  for (let i = 0; i < historyLength; i++) {
    player.positionHistory.push({
      x: startX - Math.cos(startAngle) * i * 0.5,
      y: startY - Math.sin(startAngle) * i * 0.5,
      timestamp: Date.now() - i,
    });
  }
  
  return player;
}

// =============================================================================
// CONNECTION HANDLING
// =============================================================================

io.on('connection', (socket: GameSocket) => {
  const playerId = socket.id;
  console.log(`Player connected: ${playerId}`);
  
  // Create player but don't mark as joined yet
  const playerState = createPlayer(playerId, socket);
  players.set(playerId, playerState);
  
  const initialState: InitialGameState = {
    playerId,
    snapshot: buildGameSnapshot(),
    serverTime: Date.now(),
  };
  
  socket.emit('connected', initialState);
  
  // Handle player joining with name
  socket.on('joinGame', (options: JoinOptions) => {
    const player = players.get(playerId);
    if (player && !player.hasJoined) {
      player.name = (options.name || 'Wandering Soul').trim().substring(0, 16) || 'Wandering Soul';
      player.hasJoined = true;
      console.log(`Player ${player.name} (${playerId}) joined the game`);
      socket.broadcast.emit('playerJoined', playerId, player.name);
    }
  });
  
  socket.on('playerInput', (input: PlayerInput) => {
    const player = players.get(playerId);
    if (player && player.alive && player.hasJoined) {
      player.input = input;
      player.lastProcessedInput = input.sequence;
    }
  });
  
  socket.on('ping', (clientTime: number) => {
    socket.emit('pong', Date.now(), clientTime);
  });
  
  socket.on('requestRespawn', () => {
    const player = players.get(playerId);
    if (player && !player.alive && player.respawnTime === 0) {
      // Allow manual respawn request
      respawnPlayer(player);
    }
  });
  
  socket.on('disconnect', () => {
    const player = players.get(playerId);
    console.log(`Player disconnected: ${player?.name || playerId}`);
    
    if (player && player.alive && player.hasJoined) {
      killPlayer(player, 'disconnect');
    }
    
    players.delete(playerId);
    io.emit('playerLeft', playerId);
  });
});

// =============================================================================
// GAME LOOP
// =============================================================================

function gameLoop(): void {
  currentTick++;
  const deltaMs = 1000 / TICK_RATE;
  const deltaS = deltaMs / 1000;
  
  // Check for respawns
  checkRespawns();
  
  // Update all alive players
  for (const player of players.values()) {
    if (player.alive) {
      updatePlayerMovement(player, deltaS);
      updatePositionHistory(player);
      player.bodySegments = calculateBodySegments(player);
      handleBoostDrop(player, deltaS);
    }
  }
  
  // Check collisions (can cause deaths)
  checkPlayerCollisions();
  
  // Update food
  updateFoodMagnetism(deltaS);
  checkFoodCollisions();
  maintainFoodCount();
  
  // Broadcast game state
  const snapshot = buildGameSnapshot();
  io.emit('gameState', snapshot);
}

function updatePlayerMovement(player: ServerPlayerState, deltaS: number): void {
  if (!player.alive) return;
  
  const { input } = player;
  
  const distance = Math.sqrt(input.mouseX * input.mouseX + input.mouseY * input.mouseY);
  
  if (distance > 0.05) {
    player.targetAngle = Math.atan2(input.mouseY, input.mouseX);
    
    const angleDiff = wrapAngle(player.targetAngle - player.currentAngle);
    const turnAmount = PLAYER_CONFIG.TURN_SPEED * deltaS;
    
    if (Math.abs(angleDiff) < turnAmount) {
      player.currentAngle = player.targetAngle;
    } else if (angleDiff > 0) {
      player.currentAngle += turnAmount;
    } else {
      player.currentAngle -= turnAmount;
    }
    
    player.currentAngle = wrapAngle(player.currentAngle);
    
    const speedFactor = Math.min(distance, 1);
    const baseSpeed = PLAYER_CONFIG.BASE_SPEED * speedFactor;
    
    // Only allow boosting if player has body segments to burn
    const canBoost = input.boosting && player.targetLength > GAME_CONSTANTS.MIN_BODY_LENGTH;
    player.currentSpeed = canBoost 
      ? baseSpeed * PLAYER_CONFIG.BOOST_MULTIPLIER 
      : baseSpeed;
  } else {
    player.currentSpeed *= 0.95;
  }
  
  const velocityX = Math.cos(player.currentAngle) * player.currentSpeed;
  const velocityY = Math.sin(player.currentAngle) * player.currentSpeed;
  
  player.x += velocityX * deltaS;
  player.y += velocityY * deltaS;
  
  // Don't clamp - let them hit the border and die
  // But prevent going outside the world entirely
  const hardLimit = PLAYER_CONFIG.RADIUS * -0.5;
  player.x = clamp(player.x, hardLimit, WORLD_WIDTH - hardLimit);
  player.y = clamp(player.y, hardLimit, WORLD_HEIGHT - hardLimit);
  
  player.angle = player.currentAngle;
  player.speed = player.currentSpeed;
}

function buildGameSnapshot(): GameSnapshot {
  const playersRecord: Record<string, PlayerState> = {};
  
  for (const [id, player] of players) {
    // Only include players who have officially joined
    if (!player.hasJoined) continue;
    
    playersRecord[id] = {
      id: player.id,
      name: player.name,
      x: player.x,
      y: player.y,
      angle: player.angle,
      speed: player.speed,
      score: player.score,
      bodySegments: player.bodySegments,
      targetLength: player.targetLength,
      lastProcessedInput: player.lastProcessedInput,
      alive: player.alive,
      kills: player.kills,
    };
  }
  
  return {
    players: playersRecord,
    food: {
      items: Array.from(food.values()),
    },
    scoreboard: buildScoreboard(),
    serverTime: Date.now(),
    tick: currentTick,
  };
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

function wrapAngle(angle: number): number {
  while (angle > Math.PI) angle -= Math.PI * 2;
  while (angle < -Math.PI) angle += Math.PI * 2;
  return angle;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// =============================================================================
// STARTUP
// =============================================================================

spawnInitialFood();

setInterval(gameLoop, 1000 / TICK_RATE);

httpServer.listen(PORT, '0.0.0.0', () => {
  const portStr = PORT.toString().padEnd(4, ' ');
  console.log(`
╔═══════════════════════════════════════════════╗
║     🏮 Tōrō Server - River of Souls 🏮        ║
╠═══════════════════════════════════════════════╣
║  Server running on http://0.0.0.0:${portStr}       ║
║  Environment: ${NODE_ENV.padEnd(11, ' ')}                   ║
║  Tick rate: ${TICK_RATE} Hz                           ║
╚═══════════════════════════════════════════════╝
  `);
});
