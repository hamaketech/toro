import type { PlayerInput, PlayerState } from '@shared/types';
import { GAME_CONFIG } from '../config';

/**
 * Stored input for replay during reconciliation
 */
interface StoredInput {
  input: PlayerInput;
  predictedX: number;
  predictedY: number;
  predictedAngle: number;
  predictedSpeed: number;
}

/**
 * ClientPrediction handles client-side movement prediction
 * and server reconciliation for responsive local player movement.
 */
export class ClientPrediction {
  private inputHistory: StoredInput[] = [];
  private inputSequence = 0;
  
  // Current predicted state
  private x: number;
  private y: number;
  private currentAngle: number;
  private targetAngle: number;
  private currentSpeed: number;
  
  // Reconciliation smoothing
  private correctionX = 0;
  private correctionY = 0;

  constructor(initialX: number, initialY: number, initialAngle: number) {
    this.x = initialX;
    this.y = initialY;
    this.currentAngle = initialAngle;
    this.targetAngle = initialAngle;
    this.currentSpeed = 0;
  }

  /**
   * Get the next input sequence number
   */
  getNextSequence(): number {
    return ++this.inputSequence;
  }

  /**
   * Process input and predict movement (called every frame)
   * Returns the predicted position
   */
  processInput(
    mouseX: number,
    mouseY: number,
    boosting: boolean,
    deltaMs: number,
    sequence: number
  ): { x: number; y: number; angle: number; speed: number } {
    const deltaS = deltaMs / 1000;

    // Calculate distance from center (for speed control)
    const distance = Math.sqrt(mouseX * mouseX + mouseY * mouseY);

    if (distance > 0.05) {
      // Calculate target angle from normalized mouse position
      this.targetAngle = Math.atan2(mouseY, mouseX);

      // Smoothly rotate towards target (limited turn speed)
      const angleDiff = this.wrapAngle(this.targetAngle - this.currentAngle);
      const turnAmount = GAME_CONFIG.PLAYER.TURN_SPEED * deltaS;

      if (Math.abs(angleDiff) < turnAmount) {
        this.currentAngle = this.targetAngle;
      } else if (angleDiff > 0) {
        this.currentAngle += turnAmount;
      } else {
        this.currentAngle -= turnAmount;
      }

      this.currentAngle = this.wrapAngle(this.currentAngle);

      // Calculate speed based on mouse distance
      const speedFactor = Math.min(distance, 1);
      const baseSpeed = GAME_CONFIG.PLAYER.BASE_SPEED * speedFactor;

      // Apply boost if active
      this.currentSpeed = boosting
        ? baseSpeed * GAME_CONFIG.PLAYER.BOOST_MULTIPLIER
        : baseSpeed;
    } else {
      // Drift to stop when mouse is near center
      this.currentSpeed *= 0.95;
    }

    // Apply velocity
    const velocityX = Math.cos(this.currentAngle) * this.currentSpeed;
    const velocityY = Math.sin(this.currentAngle) * this.currentSpeed;

    // Update position
    this.x += velocityX * deltaS;
    this.y += velocityY * deltaS;

    // Clamp to world bounds
    const radius = GAME_CONFIG.PLAYER.RADIUS;
    this.x = this.clamp(this.x, radius, GAME_CONFIG.WORLD_WIDTH - radius);
    this.y = this.clamp(this.y, radius, GAME_CONFIG.WORLD_HEIGHT - radius);

    // Store input for potential reconciliation
    const storedInput: StoredInput = {
      input: {
        sequence,
        mouseX,
        mouseY,
        boosting,
        timestamp: Date.now(),
      },
      predictedX: this.x,
      predictedY: this.y,
      predictedAngle: this.currentAngle,
      predictedSpeed: this.currentSpeed,
    };

    this.inputHistory.push(storedInput);

    // Trim old inputs
    while (this.inputHistory.length > GAME_CONFIG.NETWORK.INPUT_BUFFER_SIZE) {
      this.inputHistory.shift();
    }

    // Apply any pending correction smoothly
    this.applyCorrection();

    return {
      x: this.x + this.correctionX,
      y: this.y + this.correctionY,
      angle: this.currentAngle,
      speed: this.currentSpeed,
    };
  }

  /**
   * Reconcile with server state
   * Called when we receive authoritative state from server
   */
  reconcile(serverState: PlayerState): void {
    // Find the input that the server last processed
    const lastProcessed = serverState.lastProcessedInput;
    
    // Remove all inputs that have been processed
    const processedIndex = this.inputHistory.findIndex(
      stored => stored.input.sequence === lastProcessed
    );

    if (processedIndex === -1) {
      // Haven't found the processed input, might be too old
      // Snap to server position if too far off
      const dx = serverState.x - this.x;
      const dy = serverState.y - this.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance > GAME_CONFIG.NETWORK.MAX_POSITION_ERROR) {
        // Too far off, snap to server
        this.x = serverState.x;
        this.y = serverState.y;
        this.currentAngle = serverState.angle;
        this.currentSpeed = serverState.speed;
        this.correctionX = 0;
        this.correctionY = 0;
      }
      return;
    }

    // Get the stored state at the time of server's processed input
    const storedAtProcessed = this.inputHistory[processedIndex];

    // Calculate error between our prediction and server's authoritative state
    const errorX = serverState.x - storedAtProcessed.predictedX;
    const errorY = serverState.y - storedAtProcessed.predictedY;
    const errorDistance = Math.sqrt(errorX * errorX + errorY * errorY);

    // Remove processed inputs from history
    this.inputHistory.splice(0, processedIndex + 1);

    if (errorDistance > GAME_CONFIG.NETWORK.MAX_POSITION_ERROR) {
      // Error too large, snap and replay
      this.x = serverState.x;
      this.y = serverState.y;
      this.currentAngle = serverState.angle;
      this.currentSpeed = serverState.speed;
      this.correctionX = 0;
      this.correctionY = 0;

      // Replay unprocessed inputs
      this.replayInputs();
    } else if (errorDistance > 0.5) {
      // Small error, smoothly correct
      this.correctionX += errorX;
      this.correctionY += errorY;
    }
  }

  /**
   * Replay unprocessed inputs after a reconciliation snap
   */
  private replayInputs(): void {
    const tickDelta = 1000 / GAME_CONFIG.NETWORK.SERVER_TICK_RATE;

    for (const stored of this.inputHistory) {
      const { mouseX, mouseY, boosting } = stored.input;
      
      // Simulate the input
      const distance = Math.sqrt(mouseX * mouseX + mouseY * mouseY);
      const deltaS = tickDelta / 1000;

      if (distance > 0.05) {
        this.targetAngle = Math.atan2(mouseY, mouseX);
        const angleDiff = this.wrapAngle(this.targetAngle - this.currentAngle);
        const turnAmount = GAME_CONFIG.PLAYER.TURN_SPEED * deltaS;

        if (Math.abs(angleDiff) < turnAmount) {
          this.currentAngle = this.targetAngle;
        } else if (angleDiff > 0) {
          this.currentAngle += turnAmount;
        } else {
          this.currentAngle -= turnAmount;
        }

        this.currentAngle = this.wrapAngle(this.currentAngle);
        const speedFactor = Math.min(distance, 1);
        const baseSpeed = GAME_CONFIG.PLAYER.BASE_SPEED * speedFactor;
        this.currentSpeed = boosting
          ? baseSpeed * GAME_CONFIG.PLAYER.BOOST_MULTIPLIER
          : baseSpeed;
      } else {
        this.currentSpeed *= 0.95;
      }

      const velocityX = Math.cos(this.currentAngle) * this.currentSpeed;
      const velocityY = Math.sin(this.currentAngle) * this.currentSpeed;

      this.x += velocityX * deltaS;
      this.y += velocityY * deltaS;

      const radius = GAME_CONFIG.PLAYER.RADIUS;
      this.x = this.clamp(this.x, radius, GAME_CONFIG.WORLD_WIDTH - radius);
      this.y = this.clamp(this.y, radius, GAME_CONFIG.WORLD_HEIGHT - radius);

      // Update stored prediction
      stored.predictedX = this.x;
      stored.predictedY = this.y;
      stored.predictedAngle = this.currentAngle;
      stored.predictedSpeed = this.currentSpeed;
    }
  }

  /**
   * Apply correction smoothly over time
   */
  private applyCorrection(): void {
    const smoothing = GAME_CONFIG.NETWORK.RECONCILIATION_SMOOTHING;
    
    // Apply a portion of the correction
    const applyX = this.correctionX * smoothing;
    const applyY = this.correctionY * smoothing;
    
    this.x += applyX;
    this.y += applyY;
    
    this.correctionX -= applyX;
    this.correctionY -= applyY;
    
    // Clear very small corrections
    if (Math.abs(this.correctionX) < 0.1) this.correctionX = 0;
    if (Math.abs(this.correctionY) < 0.1) this.correctionY = 0;
  }

  /**
   * Get raw predicted position (without correction offset)
   */
  getRawPosition(): { x: number; y: number } {
    return { x: this.x, y: this.y };
  }

  /**
   * Set position directly (used for initial spawn)
   */
  setPosition(x: number, y: number, angle: number): void {
    this.x = x;
    this.y = y;
    this.currentAngle = angle;
    this.targetAngle = angle;
    this.correctionX = 0;
    this.correctionY = 0;
  }

  private wrapAngle(angle: number): number {
    while (angle > Math.PI) angle -= Math.PI * 2;
    while (angle < -Math.PI) angle += Math.PI * 2;
    return angle;
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }
}

