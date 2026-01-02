import type { PlayerState } from '@shared/types';

/**
 * Simple client prediction - just tracks server position
 * No actual prediction, just smooth interpolation to server state
 */
export class ClientPrediction {
  private inputSequence = 0;
  
  // Target position from server
  private serverX: number;
  private serverY: number;
  private serverAngle: number;
  private serverSpeed: number;
  
  // Current display position (interpolated)
  private displayX: number;
  private displayY: number;

  constructor(initialX: number, initialY: number, initialAngle: number) {
    this.serverX = initialX;
    this.serverY = initialY;
    this.displayX = initialX;
    this.displayY = initialY;
    this.serverAngle = initialAngle;
    this.serverSpeed = 0;
  }

  getNextSequence(): number {
    return ++this.inputSequence;
  }

  /**
   * Called each frame - smoothly interpolate display position toward server position
   */
  processInput(
    _mouseX: number,
    _mouseY: number,
    _boosting: boolean,
    _deltaMs: number,
    _sequence: number
  ): { x: number; y: number; angle: number; speed: number } {
    // Smoothly move display position toward server position
    const lerpFactor = 0.3; // Adjust for smoothness vs responsiveness
    
    this.displayX += (this.serverX - this.displayX) * lerpFactor;
    this.displayY += (this.serverY - this.displayY) * lerpFactor;
    
    return {
      x: this.displayX,
      y: this.displayY,
      angle: this.serverAngle,
      speed: this.serverSpeed,
    };
  }

  /**
   * Called when we receive server state - update target position
   */
  reconcile(serverState: PlayerState): void {
    this.serverX = serverState.x;
    this.serverY = serverState.y;
    this.serverAngle = serverState.angle;
    this.serverSpeed = serverState.speed;
  }

  getRawPosition(): { x: number; y: number } {
    return { x: this.displayX, y: this.displayY };
  }

  setPosition(x: number, y: number, angle: number): void {
    this.serverX = x;
    this.serverY = y;
    this.displayX = x;
    this.displayY = y;
    this.serverAngle = angle;
    this.inputSequence = 0;
  }
}
