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
  
  /** Visual settings */
  COLORS: {
    BACKGROUND: 0x0a0a12,
    LANTERN_GLOW: 0xffcc66,
    LANTERN_CORE: 0xffeebb,
    SPIRIT_TRAIL: 0x88ccff,
    HITODAMA: 0x66ffcc,
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

