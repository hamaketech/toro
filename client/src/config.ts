import Phaser from 'phaser';

export const GAME_CONFIG = {
  /** Server connection settings */
  SERVER_URL: 'http://localhost:3001',
  
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
    LANTERN_GLOW: 0xffcc66,
    LANTERN_CORE: 0xffeebb,
    SPIRIT_TRAIL: 0x88ccff,
    HITODAMA: 0x66ffcc,
    OTHER_PLAYER_GLOW: 0xff6666,
    OTHER_PLAYER_CORE: 0xffaaaa,
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
