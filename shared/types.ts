/** Shared types between client and server */

// =============================================================================
// PLAYER TYPES
// =============================================================================

/** Player input sent from client to server */
export interface PlayerInput {
  /** Incrementing sequence number for reconciliation */
  sequence: number;
  /** Mouse X position relative to viewport center (-1 to 1) */
  mouseX: number;
  /** Mouse Y position relative to viewport center (-1 to 1) */
  mouseY: number;
  /** Whether boost is active */
  boosting: boolean;
  /** Client timestamp for lag compensation */
  timestamp: number;
}

/** Body segment position */
export interface BodySegment {
  x: number;
  y: number;
}

/** Player state sent from server to clients */
export interface PlayerState {
  id: string;
  x: number;
  y: number;
  angle: number;
  speed: number;
  score: number;
  /** Array of body segment positions (the "Procession") */
  bodySegments: BodySegment[];
  /** Number of segments the player should have (used for growth) */
  targetLength: number;
  /** Last processed input sequence (for reconciliation) */
  lastProcessedInput: number;
}

// =============================================================================
// FOOD / HITODAMA TYPES
// =============================================================================

/** Food (Hitodama) entity */
export interface Hitodama {
  id: string;
  x: number;
  y: number;
  /** Value/size of the food - affects score and how much it grows the player */
  value: number;
  /** Visual radius */
  radius: number;
}

/** Food state in game snapshot */
export interface FoodState {
  /** All food items in the world */
  items: Hitodama[];
}

// =============================================================================
// GAME STATE TYPES
// =============================================================================

/** Game state snapshot sent from server */
export interface GameSnapshot {
  players: Record<string, PlayerState>;
  food: FoodState;
  /** Server timestamp for interpolation */
  serverTime: number;
  /** Tick number for ordering */
  tick: number;
}

/** Initial state sent when player connects */
export interface InitialGameState {
  playerId: string;
  snapshot: GameSnapshot;
  serverTime: number;
}

// =============================================================================
// SOCKET EVENTS
// =============================================================================

/** Socket.io event types for type safety */
export interface ServerToClientEvents {
  /** Initial connection with full state */
  connected: (state: InitialGameState) => void;
  /** Game state update */
  gameState: (snapshot: GameSnapshot) => void;
  /** Player joined notification */
  playerJoined: (playerId: string) => void;
  /** Player left notification */
  playerLeft: (playerId: string) => void;
  /** Server time sync response */
  pong: (serverTime: number, clientTime: number) => void;
  /** Food collected notification (for sound/effects) */
  foodCollected: (foodId: string, playerId: string) => void;
}

export interface ClientToServerEvents {
  /** Player input from client */
  playerInput: (input: PlayerInput) => void;
  /** Time sync request */
  ping: (clientTime: number) => void;
}

// =============================================================================
// GAME CONSTANTS (shared between client and server)
// =============================================================================

export const GAME_CONSTANTS = {
  /** Spacing between body segments in pixels */
  BODY_SEGMENT_SPACING: 25,
  /** Number of position history points to keep per segment spacing */
  POSITION_HISTORY_RESOLUTION: 2,
  /** Food magnetic pull radius */
  FOOD_MAGNET_RADIUS: 100,
  /** Food magnetic pull strength (pixels per second at max) */
  FOOD_MAGNET_STRENGTH: 150,
  /** Base food value */
  FOOD_BASE_VALUE: 1,
  /** Food visual radius */
  FOOD_RADIUS: 8,
  /** How much body length per food value */
  GROWTH_PER_FOOD: 1,
  /** Boost drop rate (segments lost per second while boosting) */
  BOOST_DROP_RATE: 2,
  /** Minimum body length (can't shrink below this) */
  MIN_BODY_LENGTH: 0,
  /** Starting body length for new players */
  STARTING_BODY_LENGTH: 3,
  /** Maximum food items in the world */
  MAX_FOOD_COUNT: 200,
  /** Food spawn rate per tick when below max */
  FOOD_SPAWN_RATE: 3,
  /** Dropped pellet value (from boosting or death) */
  DROPPED_PELLET_VALUE: 1,
} as const;
