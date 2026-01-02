import Phaser from 'phaser';
import { PHASER_CONFIG } from './config';
import { GameScene } from './scenes/GameScene';

/** Main game entry point */
class ToroGame extends Phaser.Game {
  constructor() {
    super({
      ...PHASER_CONFIG,
      scene: [GameScene],
    });
  }
}

// Initialize game when DOM is ready
window.addEventListener('load', () => {
  new ToroGame();
});

