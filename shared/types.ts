/** Shared types between client and server */

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

/** Player state sent from server to clients */
export interface PlayerState {
  id: string;
  x: number;
  y: number;
  angle: number;
  speed: number;
  score: number;
  bodySegments: Array<{ x: number; y: number }>;
  /** Last processed input sequence (for reconciliation) */
  lastProcessedInput: number;
}

/** Game state snapshot sent from server */
export interface GameSnapshot {
  players: Record<string, PlayerState>;
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
}

export interface ClientToServerEvents {
  /** Player input from client */
  playerInput: (input: PlayerInput) => void;
  /** Time sync request */
  ping: (clientTime: number) => void;
}
