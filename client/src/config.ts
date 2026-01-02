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
    /** Base segment radius (at head) */
    SEGMENT_RADIUS_MAX: 14,
    /** Minimum segment radius (at tail) */
    SEGMENT_RADIUS_MIN: 6,
    /** Glow multiplier relative to segment size */
    GLOW_MULTIPLIER: 1.6,
    /** Opacity at head (1 = full) */
    OPACITY_MAX: 0.95,
    /** Opacity at tail */
    OPACITY_MIN: 0.3,
    /** Floating wobble amplitude (pixels) */
    WOBBLE_AMPLITUDE: 3,
    /** Wobble speed */
    WOBBLE_SPEED: 2.5,
    /** Pulse amplitude for segments */
    PULSE_AMOUNT: 0.08,
    /** Pulse speed */
    PULSE_SPEED: 3,
  },
  
  /** Food (Hitodama) settings */
  FOOD: {
    /** Base glow radius multiplier */
    GLOW_MULTIPLIER: 2.0,
    /** Pulse animation speed */
    PULSE_SPEED: 2.5,
    /** Pulse intensity */
    PULSE_AMOUNT: 0.2,
    /** Inner glow opacity */
    INNER_GLOW_OPACITY: 0.6,
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
    // Local player lantern
    LANTERN_GLOW: 0xffcc66,
    LANTERN_CORE: 0xffeebb,
    // Body segments (spirits in procession) - gradient from warm to cool
    SPIRIT_GLOW_HEAD: 0xaaddff,    // Brighter blue-white near head
    SPIRIT_GLOW_TAIL: 0x4488cc,    // Deeper blue at tail
    SPIRIT_CORE_HEAD: 0xddeeff,    // Almost white core near head
    SPIRIT_CORE_TAIL: 0x88bbdd,    // Faded core at tail
    // Other players
    OTHER_PLAYER_GLOW: 0xff6666,
    OTHER_PLAYER_CORE: 0xffaaaa,
    OTHER_SPIRIT_GLOW_HEAD: 0xffaaaa,
    OTHER_SPIRIT_GLOW_TAIL: 0xcc6666,
    OTHER_SPIRIT_CORE_HEAD: 0xffdddd,
    OTHER_SPIRIT_CORE_TAIL: 0xdd9999,
    // Food (Hitodama) - ethereal cyan-green
    HITODAMA_GLOW: 0x44ffcc,
    HITODAMA_CORE: 0xccffee,
    HITODAMA_INNER: 0xffffff,
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
