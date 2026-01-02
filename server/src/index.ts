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
} from '../../shared/types';

// Server configuration
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

// Type for our socket with typed events
type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

// Player state stored on server
interface ServerPlayerState extends PlayerState {
  input: PlayerInput;
  currentAngle: number;
  targetAngle: number;
  currentSpeed: number;
}

// Store all connected players
const players: Map<string, ServerPlayerState> = new Map();

// Current game tick
let currentTick = 0;

// Initialize Express + Socket.io
const app = express();
const httpServer = createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: {
    origin: '*', // Allow any origin for local network testing
    methods: ['GET', 'POST'],
  },
});

// Basic health check endpoint
app.get('/', (_req, res) => {
  res.json({ 
    status: 'ok', 
    players: players.size,
    tick: currentTick,
    uptime: process.uptime(),
  });
});

// Handle new connections
io.on('connection', (socket: GameSocket) => {
  const playerId = socket.id;
  console.log(`Player connected: ${playerId}`);
  
  // Create initial player state
  const playerState: ServerPlayerState = {
    id: playerId,
    x: WORLD_WIDTH / 2 + (Math.random() - 0.5) * 200,
    y: WORLD_HEIGHT / 2 + (Math.random() - 0.5) * 200,
    angle: Math.random() * Math.PI * 2,
    speed: 0,
    score: 0,
    bodySegments: [],
    lastProcessedInput: 0,
    input: {
      sequence: 0,
      mouseX: 0,
      mouseY: 0,
      boosting: false,
      timestamp: Date.now(),
    },
    currentAngle: 0,
    targetAngle: 0,
    currentSpeed: 0,
  };
  
  // Set initial angle
  playerState.currentAngle = playerState.angle;
  playerState.targetAngle = playerState.angle;
  
  players.set(playerId, playerState);
  
  // Build initial game state to send to new player
  const initialState: InitialGameState = {
    playerId,
    snapshot: buildGameSnapshot(),
    serverTime: Date.now(),
  };
  
  // Send acknowledgment with full initial state
  socket.emit('connected', initialState);
  
  // Notify others of new player
  socket.broadcast.emit('playerJoined', playerId);
  
  // Handle player input
  socket.on('playerInput', (input: PlayerInput) => {
    const player = players.get(playerId);
    if (player) {
      player.input = input;
      // Track the sequence number for reconciliation
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
    players.delete(playerId);
    io.emit('playerLeft', playerId);
  });
});

// Game loop - updates physics and broadcasts state
function gameLoop(): void {
  currentTick++;
  const deltaMs = 1000 / TICK_RATE;
  const deltaS = deltaMs / 1000;
  
  // Update all players
  for (const player of players.values()) {
    updatePlayer(player, deltaS);
  }
  
  // Build and broadcast game snapshot
  const snapshot = buildGameSnapshot();
  io.emit('gameState', snapshot);
}

function updatePlayer(player: ServerPlayerState, deltaS: number): void {
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
      lastProcessedInput: player.lastProcessedInput,
    };
  }
  
  return {
    players: playersRecord,
    serverTime: Date.now(),
    tick: currentTick,
  };
}

// Utility functions
function wrapAngle(angle: number): number {
  while (angle > Math.PI) angle -= Math.PI * 2;
  while (angle < -Math.PI) angle += Math.PI * 2;
  return angle;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// Start game loop
setInterval(gameLoop, 1000 / TICK_RATE);

// Start server on all interfaces (0.0.0.0) for local network access
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`
╔═══════════════════════════════════════════════╗
║     🏮 Tōrō Server - River of Souls 🏮        ║
╠═══════════════════════════════════════════════╣
║  Server running on http://0.0.0.0:${PORT}        ║
║  Local network: http://10.1.1.189:${PORT}        ║
║  Tick rate: ${TICK_RATE} Hz                           ║
║  Phase 2: Multiplayer Movement Active         ║
╚═══════════════════════════════════════════════╝
  `);
});
