/** Shared types between client and server */

/** Player input sent from client to server */
export interface PlayerInput {
  /** Sequence number for reconciliation */
  seq: number;
  /** Mouse X position relative to viewport center (-1 to 1) */
  mouseX: number;
  /** Mouse Y position relative to viewport center (-1 to 1) */
  mouseY: number;
  /** Whether boost is active */
  boosting: boolean;
  /** Client timestamp for lag compensation */
  timestamp: number;
}

/** Player state sent from server to clients */
export interface PlayerState {
  id: string;
  x: number;
  y: number;
  angle: number;
  score: number;
  /** Last processed input sequence number (for reconciliation) */
  lastProcessedInput: number;
  bodySegments: Array<{ x: number; y: number }>;
}

/** Game state snapshot sent from server */
export interface GameSnapshot {
  players: Record<string, PlayerState>;
  timestamp: number;
}

/** Socket.io event types for type safety */
export interface ServerToClientEvents {
  /** Initial connection acknowledgment with spawn position */
  connected: (data: { playerId: string; spawnX: number; spawnY: number }) => void;
  /** Game state update */
  gameState: (snapshot: GameSnapshot) => void;
  /** Player joined notification */
  playerJoined: (playerId: string) => void;
  /** Player left notification */
  playerLeft: (playerId: string) => void;
}

export interface ClientToServerEvents {
  /** Player input from client */
  playerInput: (input: PlayerInput) => void;
}

/** Position data for interpolation */
export interface PositionData {
  x: number;
  y: number;
  angle: number;
  timestamp: number;
}
