import Phaser from 'phaser';
import { Pool } from './Pool';

/**
 * Object pool specifically for Phaser Sprites
 * Reuses sprites to avoid GC from constant creation/destruction
 */
export class SpritePool {
  private pool: Pool<Phaser.GameObjects.Sprite>;
  private scene: Phaser.Scene;
  private textureKey: string;
  private frame?: string | number;
  
  constructor(
    scene: Phaser.Scene,
    textureKey: string,
    frame?: string | number,
    initialSize: number = 100
  ) {
    this.scene = scene;
    this.textureKey = textureKey;
    this.frame = frame;
    
    this.pool = new Pool<Phaser.GameObjects.Sprite>(
      // Factory: create new sprite (hidden by default)
      () => {
        const sprite = scene.add.sprite(0, 0, textureKey, frame);
        sprite.setActive(false);
        sprite.setVisible(false);
        return sprite;
      },
      // Reset: hide and reset sprite properties
      (sprite) => {
        sprite.setActive(false);
        sprite.setVisible(false);
        sprite.setPosition(0, 0);
        sprite.setScale(1);
        sprite.setAlpha(1);
        sprite.clearTint();
        sprite.setAngle(0);
        sprite.setDepth(0);
        sprite.setBlendMode(Phaser.BlendModes.NORMAL);
      },
      initialSize
    );
  }
  
  /**
   * Get a sprite from the pool at the specified position
   */
  acquire(x: number, y: number): Phaser.GameObjects.Sprite {
    const sprite = this.pool.acquire();
    sprite.setPosition(x, y);
    sprite.setTexture(this.textureKey, this.frame);
    sprite.setActive(true);
    sprite.setVisible(true);
    return sprite;
  }
  
  /**
   * Return a sprite to the pool
   */
  release(sprite: Phaser.GameObjects.Sprite): void {
    this.pool.release(sprite);
  }
  
  /**
   * Release all active sprites back to pool
   */
  releaseAll(): void {
    this.pool.releaseAll();
  }
  
  /**
   * Get count of active sprites
   */
  get activeCount(): number {
    return this.pool.activeCount;
  }
  
  /**
   * Get count of available sprites
   */
  get availableCount(): number {
    return this.pool.availableCount;
  }
  
  /**
   * Get total pool size
   */
  get totalCount(): number {
    return this.pool.totalCount;
  }
  
  /**
   * Pre-warm the pool with additional sprites
   */
  prewarm(count: number): void {
    this.pool.prewarm(count);
  }
  
  /**
   * Destroy all sprites and clear pool
   */
  destroy(): void {
    this.pool.clear((sprite) => sprite.destroy());
  }
}

/**
 * Object pool for Phaser Graphics (arcs/circles)
 * Used for body segments that use Arc shapes
 */
export class ArcPool {
  private pool: Pool<Phaser.GameObjects.Arc>;
  private scene: Phaser.Scene;
  
  constructor(
    scene: Phaser.Scene,
    initialSize: number = 200
  ) {
    this.scene = scene;
    
    this.pool = new Pool<Phaser.GameObjects.Arc>(
      // Factory: create new arc (hidden by default)
      () => {
        const arc = scene.add.arc(0, 0, 10, 0, 360, false, 0xffffff, 1);
        arc.setActive(false);
        arc.setVisible(false);
        return arc;
      },
      // Reset: hide and reset arc properties
      (arc) => {
        arc.setActive(false);
        arc.setVisible(false);
        arc.setPosition(0, 0);
        arc.setScale(1);
        arc.setAlpha(1);
        arc.setFillStyle(0xffffff, 1);
        arc.setDepth(0);
      },
      initialSize
    );
  }
  
  /**
   * Get an arc from the pool at the specified position
   */
  acquire(x: number, y: number, radius: number, color: number, alpha: number = 1): Phaser.GameObjects.Arc {
    const arc = this.pool.acquire();
    arc.setPosition(x, y);
    arc.setRadius(radius);
    arc.setFillStyle(color, alpha);
    arc.setActive(true);
    arc.setVisible(true);
    return arc;
  }
  
  /**
   * Return an arc to the pool
   */
  release(arc: Phaser.GameObjects.Arc): void {
    this.pool.release(arc);
  }
  
  /**
   * Release all active arcs back to pool
   */
  releaseAll(): void {
    this.pool.releaseAll();
  }
  
  /**
   * Get count of active arcs
   */
  get activeCount(): number {
    return this.pool.activeCount;
  }
  
  /**
   * Get total pool size
   */
  get totalCount(): number {
    return this.pool.totalCount;
  }
  
  /**
   * Destroy all arcs and clear pool
   */
  destroy(): void {
    this.pool.clear((arc) => arc.destroy());
  }
}

/**
 * Object pool for Phaser Images
 * Used for sprites when you don't need animation
 */
export class ImagePool {
  private pool: Pool<Phaser.GameObjects.Image>;
  private scene: Phaser.Scene;
  private textureKey: string;
  private frame?: string | number;
  
  constructor(
    scene: Phaser.Scene,
    textureKey: string,
    frame?: string | number,
    initialSize: number = 100
  ) {
    this.scene = scene;
    this.textureKey = textureKey;
    this.frame = frame;
    
    this.pool = new Pool<Phaser.GameObjects.Image>(
      // Factory: create new image (hidden by default)
      () => {
        const image = scene.add.image(0, 0, textureKey, frame);
        image.setActive(false);
        image.setVisible(false);
        return image;
      },
      // Reset: hide and reset image properties
      (image) => {
        image.setActive(false);
        image.setVisible(false);
        image.setPosition(0, 0);
        image.setScale(1);
        image.setAlpha(1);
        image.clearTint();
        image.setAngle(0);
        image.setDepth(0);
        image.setBlendMode(Phaser.BlendModes.NORMAL);
      },
      initialSize
    );
  }
  
  /**
   * Get an image from the pool at the specified position
   */
  acquire(x: number, y: number): Phaser.GameObjects.Image {
    const image = this.pool.acquire();
    image.setPosition(x, y);
    image.setTexture(this.textureKey, this.frame);
    image.setActive(true);
    image.setVisible(true);
    return image;
  }
  
  /**
   * Return an image to the pool
   */
  release(image: Phaser.GameObjects.Image): void {
    this.pool.release(image);
  }
  
  /**
   * Release all active images back to pool
   */
  releaseAll(): void {
    this.pool.releaseAll();
  }
  
  /**
   * Get count of active images
   */
  get activeCount(): number {
    return this.pool.activeCount;
  }
  
  /**
   * Get total pool size
   */
  get totalCount(): number {
    return this.pool.totalCount;
  }
  
  /**
   * Destroy all images and clear pool
   */
  destroy(): void {
    this.pool.clear((image) => image.destroy());
  }
}


