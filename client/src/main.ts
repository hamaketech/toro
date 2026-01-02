import Phaser from 'phaser';
import { PHASER_CONFIG } from './config';
import { MainMenuScene } from './scenes/MainMenuScene';
import { GameScene } from './scenes/GameScene';
import { registerBloomPipeline } from './pipelines/BloomPipeline';

/** Main game entry point */
class ToroGame extends Phaser.Game {
  constructor() {
    super({
      ...PHASER_CONFIG,
      scene: [MainMenuScene, GameScene],
    });

    // Register bloom pipeline once the game is ready
    this.events.once('ready', () => {
      registerBloomPipeline(this);
    });
  }
}

// Initialize game when DOM is ready
window.addEventListener('load', () => {
  new ToroGame();
});
