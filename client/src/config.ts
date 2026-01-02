import Phaser from 'phaser';

// Dynamically determine server URL based on current host (enables mobile/network testing)
const getServerUrl = () => {
  const hostname = window.location.hostname;
  return `http://${hostname}:3001`;
};

export const GAME_CONFIG = {
  /** Server connection settings */
  SERVER_URL: getServerUrl(),
  
  /** Game world dimensions */
  WORLD_WIDTH: 2000,
  WORLD_HEIGHT: 2000,
  
  /** Player settings */
  PLAYER: {
    RADIUS: 20,
    BASE_SPEED: 200,
    TURN_SPEED: 4,
    BOOST_MULTIPLIER: 1.5,
  },
  
  /** Body segment settings */
  BODY: {
    SEGMENT_RADIUS: 12,
    SEGMENT_GLOW_RADIUS: 18,
    /** Opacity fade from head to tail (1 = full, 0.3 = faded) */
    TAIL_OPACITY_MIN: 0.4,
  },
  
  /** Food (Hitodama) settings */
  FOOD: {
    /** Base glow radius multiplier */
    GLOW_MULTIPLIER: 1.8,
    /** Pulse animation speed */
    PULSE_SPEED: 2,
    /** Pulse intensity */
    PULSE_AMOUNT: 0.15,
  },
  
  /** Network / Interpolation settings */
  NETWORK: {
    /** Server tick rate (must match server) */
    SERVER_TICK_RATE: 20,
    /** How far behind real-time to render other players (ms) - provides interpolation buffer */
    INTERPOLATION_DELAY: 100,
    /** Maximum number of snapshots to keep in buffer */
    SNAPSHOT_BUFFER_SIZE: 30,
    /** How many inputs to keep for reconciliation */
    INPUT_BUFFER_SIZE: 60,
    /** Maximum position error before snapping instead of interpolating */
    MAX_POSITION_ERROR: 50,
    /** How aggressively to correct position errors (0-1) */
    RECONCILIATION_SMOOTHING: 0.1,
    /** Time sync ping interval (ms) */
    TIME_SYNC_INTERVAL: 5000,
  },
  
  /** Visual settings */
  COLORS: {
    BACKGROUND: 0x0a0a12,
    // Local player
    LANTERN_GLOW: 0xffcc66,
    LANTERN_CORE: 0xffeebb,
    // Body segments (spirits in procession)
    SPIRIT_GLOW: 0x88ccff,
    SPIRIT_CORE: 0xaaddff,
    // Other players
    OTHER_PLAYER_GLOW: 0xff6666,
    OTHER_PLAYER_CORE: 0xffaaaa,
    OTHER_SPIRIT_GLOW: 0xff8888,
    OTHER_SPIRIT_CORE: 0xffbbbb,
    // Food (Hitodama)
    HITODAMA_GLOW: 0x66ffcc,
    HITODAMA_CORE: 0xaaffee,
  },
} as const;

export const PHASER_CONFIG: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'game-container',
  width: window.innerWidth,
  height: window.innerHeight,
  backgroundColor: GAME_CONFIG.COLORS.BACKGROUND,
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { x: 0, y: 0 },
      debug: false,
    },
  },
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  render: {
    pixelArt: false,
    antialias: true,
  },
};
