import express from 'express';
import { createServer } from 'http';
import { Server, Socket } from 'socket.io';
import type { 
  ServerToClientEvents, 
  ClientToServerEvents, 
  PlayerInput, 
  PlayerState, 
  GameSnapshot,
  InitialGameState,
  Hitodama,
  BodySegment,
} from '../../shared/types';
import { GAME_CONSTANTS } from '../../shared/types';

// =============================================================================
// SERVER CONFIGURATION
// =============================================================================

const PORT = 3001;
const TICK_RATE = 20; // 20 updates per second

// Game world configuration (must match client)
const WORLD_WIDTH = 2000;
const WORLD_HEIGHT = 2000;

// Player configuration
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

/** Position with timestamp for history tracking */
interface PositionRecord {
  x: number;
  y: number;
  timestamp: number;
}

/** Player state stored on server (extends shared PlayerState) */
interface ServerPlayerState extends PlayerState {
  input: PlayerInput;
  currentAngle: number;
  targetAngle: number;
  currentSpeed: number;
  /** Position history for body segment following */
  positionHistory: PositionRecord[];
  /** Accumulated boost drop (fractional segments) */
  boostDropAccumulator: number;
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

// Basic health check endpoint
app.get('/', (_req, res) => {
  res.json({ 
    status: 'ok', 
    players: players.size,
    food: food.size,
    tick: currentTick,
    uptime: process.uptime(),
  });
});

// =============================================================================
// FOOD SYSTEM
// =============================================================================

function generateFoodId(): string {
  return `food_${++foodIdCounter}`;
}

function spawnFood(x?: number, y?: number, value?: number): Hitodama {
  const id = generateFoodId();
  const padding = 50;
  
  const hitodama: Hitodama = {
    id,
    x: x ?? padding + Math.random() * (WORLD_WIDTH - padding * 2),
    y: y ?? padding + Math.random() * (WORLD_HEIGHT - padding * 2),
    value: value ?? GAME_CONSTANTS.FOOD_BASE_VALUE,
    radius: GAME_CONSTANTS.FOOD_RADIUS,
  };
  
  food.set(id, hitodama);
  return hitodama;
}

function spawnInitialFood(): void {
  const initialCount = Math.floor(GAME_CONSTANTS.MAX_FOOD_COUNT * 0.7);
  for (let i = 0; i < initialCount; i++) {
    spawnFood();
  }
  console.log(`Spawned ${initialCount} initial food items`);
}

function maintainFoodCount(): void {
  // Spawn food if below max
  const currentCount = food.size;
  if (currentCount < GAME_CONSTANTS.MAX_FOOD_COUNT) {
    const toSpawn = Math.min(
      GAME_CONSTANTS.FOOD_SPAWN_RATE,
      GAME_CONSTANTS.MAX_FOOD_COUNT - currentCount
    );
    for (let i = 0; i < toSpawn; i++) {
      spawnFood();
    }
  }
}

function updateFoodMagnetism(deltaS: number): void {
  // Apply magnetic pull from players to nearby food
  for (const player of players.values()) {
    for (const item of food.values()) {
      const dx = player.x - item.x;
      const dy = player.y - item.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      
      if (distance < GAME_CONSTANTS.FOOD_MAGNET_RADIUS && distance > 0) {
        // Magnetic pull strength increases as food gets closer
        const pullFactor = 1 - (distance / GAME_CONSTANTS.FOOD_MAGNET_RADIUS);
        const pullStrength = GAME_CONSTANTS.FOOD_MAGNET_STRENGTH * pullFactor * pullFactor;
        
        // Move food toward player
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
    const foodToRemove: string[] = [];
    
    for (const item of food.values()) {
      const dx = player.x - item.x;
      const dy = player.y - item.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      
      if (distance < collectionRadius) {
        // Collect food!
        player.score += item.value;
        player.targetLength += item.value * GAME_CONSTANTS.GROWTH_PER_FOOD;
        foodToRemove.push(item.id);
        
        // Notify clients
        io.emit('foodCollected', item.id, player.id);
      }
    }
    
    // Remove collected food
    for (const id of foodToRemove) {
      food.delete(id);
    }
  }
}

// =============================================================================
// BODY SEGMENT SYSTEM
// =============================================================================

function updatePositionHistory(player: ServerPlayerState): void {
  const now = Date.now();
  
  // Add current position to history
  player.positionHistory.unshift({
    x: player.x,
    y: player.y,
    timestamp: now,
  });
  
  // Calculate how many history points we need
  const firstGap = GAME_CONSTANTS.FIRST_SEGMENT_GAP;
  const segmentSpacing = GAME_CONSTANTS.BODY_SEGMENT_SPACING;
  const historyResolution = GAME_CONSTANTS.POSITION_HISTORY_RESOLUTION;
  const maxSegments = Math.max(player.targetLength, player.bodySegments.length) + 5;
  // Account for larger first segment gap
  const totalDistance = firstGap + (maxSegments - 1) * segmentSpacing;
  const maxHistoryLength = totalDistance * historyResolution;
  
  // Trim old history
  while (player.positionHistory.length > maxHistoryLength) {
    player.positionHistory.pop();
  }
}

function calculateBodySegments(player: ServerPlayerState): BodySegment[] {
  const segments: BodySegment[] = [];
  const firstGap = GAME_CONSTANTS.FIRST_SEGMENT_GAP;
  const segmentSpacing = GAME_CONSTANTS.BODY_SEGMENT_SPACING;
  const history = player.positionHistory;
  
  if (history.length < 2) {
    return segments;
  }
  
  // Calculate current body length (may be growing toward targetLength)
  const currentLength = Math.min(
    player.bodySegments.length + 1, // Can grow by 1 per tick
    player.targetLength
  );
  
  // Walk along the position history trail to place segments
  let distanceAccumulated = 0;
  let segmentIndex = 0;
  
  for (let i = 1; i < history.length && segmentIndex < currentLength; i++) {
    const prev = history[i - 1];
    const curr = history[i];
    
    const dx = prev.x - curr.x;
    const dy = prev.y - curr.y;
    const segmentDistance = Math.sqrt(dx * dx + dy * dy);
    
    distanceAccumulated += segmentDistance;
    
    // First segment has larger gap from head, rest use normal spacing
    const requiredSpacing = segmentIndex === 0 ? firstGap : segmentSpacing;
    
    // Place a segment when we've accumulated enough distance
    while (distanceAccumulated >= requiredSpacing && segmentIndex < currentLength) {
      // Interpolate position along this segment
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
  if (!player.input.boosting || player.targetLength <= GAME_CONSTANTS.MIN_BODY_LENGTH) {
    return;
  }
  
  // Accumulate drop rate
  player.boostDropAccumulator += GAME_CONSTANTS.BOOST_DROP_RATE * deltaS;
  
  // Drop segments when accumulator reaches 1
  while (player.boostDropAccumulator >= 1 && player.targetLength > GAME_CONSTANTS.MIN_BODY_LENGTH) {
    player.boostDropAccumulator -= 1;
    player.targetLength--;
    
    // Drop a pellet at the tail position
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

function createPlayer(playerId: string): ServerPlayerState {
  const startX = WORLD_WIDTH / 2 + (Math.random() - 0.5) * 400;
  const startY = WORLD_HEIGHT / 2 + (Math.random() - 0.5) * 400;
  const startAngle = Math.random() * Math.PI * 2;
  
  const player: ServerPlayerState = {
    id: playerId,
    x: startX,
    y: startY,
    angle: startAngle,
    speed: 0,
    score: 0,
    bodySegments: [],
    targetLength: GAME_CONSTANTS.STARTING_BODY_LENGTH,
    lastProcessedInput: 0,
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
  };
  
  // Initialize position history with enough points for starting body
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
  
  // Create player
  const playerState = createPlayer(playerId);
  players.set(playerId, playerState);
  
  // Build initial game state
  const initialState: InitialGameState = {
    playerId,
    snapshot: buildGameSnapshot(),
    serverTime: Date.now(),
  };
  
  socket.emit('connected', initialState);
  socket.broadcast.emit('playerJoined', playerId);
  
  // Handle player input
  socket.on('playerInput', (input: PlayerInput) => {
    const player = players.get(playerId);
    if (player) {
      player.input = input;
      player.lastProcessedInput = input.sequence;
    }
  });
  
  // Handle time sync ping
  socket.on('ping', (clientTime: number) => {
    socket.emit('pong', Date.now(), clientTime);
  });
  
  // Handle disconnection
  socket.on('disconnect', () => {
    console.log(`Player disconnected: ${playerId}`);
    
    // Drop all body segments as food on death/disconnect
    const player = players.get(playerId);
    if (player) {
      for (const segment of player.bodySegments) {
        spawnFood(
          segment.x + (Math.random() - 0.5) * 20,
          segment.y + (Math.random() - 0.5) * 20,
          GAME_CONSTANTS.DROPPED_PELLET_VALUE
        );
      }
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
  
  // Update all players
  for (const player of players.values()) {
    updatePlayerMovement(player, deltaS);
    updatePositionHistory(player);
    player.bodySegments = calculateBodySegments(player);
    handleBoostDrop(player, deltaS);
  }
  
  // Update food
  updateFoodMagnetism(deltaS);
  checkFoodCollisions();
  maintainFoodCount();
  
  // Broadcast game state
  const snapshot = buildGameSnapshot();
  io.emit('gameState', snapshot);
}

function updatePlayerMovement(player: ServerPlayerState, deltaS: number): void {
  const { input } = player;
  
  // Calculate distance from center (for speed control)
  const distance = Math.sqrt(input.mouseX * input.mouseX + input.mouseY * input.mouseY);
  
  if (distance > 0.05) {
    // Calculate target angle from normalized mouse position
    player.targetAngle = Math.atan2(input.mouseY, input.mouseX);
    
    // Smoothly rotate towards target (limited turn speed)
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
    
    // Calculate speed based on mouse distance
    const speedFactor = Math.min(distance, 1);
    const baseSpeed = PLAYER_CONFIG.BASE_SPEED * speedFactor;
    
    // Apply boost if active
    player.currentSpeed = input.boosting 
      ? baseSpeed * PLAYER_CONFIG.BOOST_MULTIPLIER 
      : baseSpeed;
  } else {
    // Drift to stop when mouse is near center
    player.currentSpeed *= 0.95;
  }
  
  // Apply velocity
  const velocityX = Math.cos(player.currentAngle) * player.currentSpeed;
  const velocityY = Math.sin(player.currentAngle) * player.currentSpeed;
  
  // Update position
  player.x += velocityX * deltaS;
  player.y += velocityY * deltaS;
  
  // Clamp to world bounds
  const radius = PLAYER_CONFIG.RADIUS;
  player.x = clamp(player.x, radius, WORLD_WIDTH - radius);
  player.y = clamp(player.y, radius, WORLD_HEIGHT - radius);
  
  // Update visible angle and speed
  player.angle = player.currentAngle;
  player.speed = player.currentSpeed;
}

function buildGameSnapshot(): GameSnapshot {
  const playersRecord: Record<string, PlayerState> = {};
  
  for (const [id, player] of players) {
    playersRecord[id] = {
      id: player.id,
      x: player.x,
      y: player.y,
      angle: player.angle,
      speed: player.speed,
      score: player.score,
      bodySegments: player.bodySegments,
      targetLength: player.targetLength,
      lastProcessedInput: player.lastProcessedInput,
    };
  }
  
  return {
    players: playersRecord,
    food: {
      items: Array.from(food.values()),
    },
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

// Spawn initial food
spawnInitialFood();

// Start game loop
setInterval(gameLoop, 1000 / TICK_RATE);

// Start server
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`
╔═══════════════════════════════════════════════╗
║     🏮 Tōrō Server - River of Souls 🏮        ║
╠═══════════════════════════════════════════════╣
║  Server running on http://0.0.0.0:${PORT}        ║
║  Tick rate: ${TICK_RATE} Hz                           ║
║  Phase 3: Snake Logic + Food Active           ║
╚═══════════════════════════════════════════════╝
  `);
});
