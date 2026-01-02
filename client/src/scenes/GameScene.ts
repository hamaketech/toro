import Phaser from 'phaser';
import { io, Socket } from 'socket.io-client';
import { GAME_CONFIG } from '../config';
import type { ServerToClientEvents, ClientToServerEvents, PlayerInput, GameSnapshot, PlayerState } from '@shared/types';

type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/**
 * Main game scene - handles player movement, rendering, and server communication
 */
export class GameScene extends Phaser.Scene {
  private socket!: GameSocket;
  private playerId: string | null = null;
  
  // Graphics objects
  private lantern!: Phaser.GameObjects.Container;
  private lanternGlow!: Phaser.GameObjects.Arc;
  private lanternCore!: Phaser.GameObjects.Arc;
  
  // Other players
  private otherPlayers: Map<string, Phaser.GameObjects.Container> = new Map();
  
  // Movement state
  private currentAngle = 0;
  private targetAngle = 0;
  private currentSpeed = 0;
  
  // Input state
  private isBoosting = false;
  
  // World bounds graphics
  private worldBounds!: Phaser.GameObjects.Graphics;

  constructor() {
    super({ key: 'GameScene' });
  }

  create(): void {
    this.setupWorld();
    this.createPlayer();
    this.setupInput();
    this.connectToServer();
  }

  private setupWorld(): void {
    // Draw world boundary rectangle
    this.worldBounds = this.add.graphics();
    this.worldBounds.lineStyle(3, 0x334455, 0.8);
    this.worldBounds.strokeRect(0, 0, GAME_CONFIG.WORLD_WIDTH, GAME_CONFIG.WORLD_HEIGHT);
    
    // Add subtle grid pattern for movement reference
    const gridGraphics = this.add.graphics();
    gridGraphics.lineStyle(1, 0x1a1a2e, 0.3);
    
    const gridSize = 100;
    for (let x = 0; x <= GAME_CONFIG.WORLD_WIDTH; x += gridSize) {
      gridGraphics.moveTo(x, 0);
      gridGraphics.lineTo(x, GAME_CONFIG.WORLD_HEIGHT);
    }
    for (let y = 0; y <= GAME_CONFIG.WORLD_HEIGHT; y += gridSize) {
      gridGraphics.moveTo(0, y);
      gridGraphics.lineTo(GAME_CONFIG.WORLD_WIDTH, y);
    }
    gridGraphics.strokePath();
    
    // Setup camera bounds
    this.cameras.main.setBounds(0, 0, GAME_CONFIG.WORLD_WIDTH, GAME_CONFIG.WORLD_HEIGHT);
    
    // Set world physics bounds
    this.physics.world.setBounds(0, 0, GAME_CONFIG.WORLD_WIDTH, GAME_CONFIG.WORLD_HEIGHT);
  }

  private createPlayer(): void {
    // Create lantern container (will hold glow + core)
    this.lantern = this.add.container(
      GAME_CONFIG.WORLD_WIDTH / 2,
      GAME_CONFIG.WORLD_HEIGHT / 2
    );
    
    // Outer glow effect
    this.lanternGlow = this.add.arc(0, 0, GAME_CONFIG.PLAYER.RADIUS * 2, 0, 360, false, GAME_CONFIG.COLORS.LANTERN_GLOW, 0.3);
    
    // Inner core (the actual hitbox visualization)
    this.lanternCore = this.add.arc(0, 0, GAME_CONFIG.PLAYER.RADIUS, 0, 360, false, GAME_CONFIG.COLORS.LANTERN_CORE, 1);
    
    // Add to container
    this.lantern.add([this.lanternGlow, this.lanternCore]);
    
    // Camera follows the lantern
    this.cameras.main.startFollow(this.lantern, true, 0.1, 0.1);
    this.cameras.main.setZoom(1);
    
    // Spawn at center of world
    this.currentAngle = 0;
  }

  private setupInput(): void {
    // Boost on space or left click
    this.input.keyboard?.on('keydown-SPACE', () => {
      this.isBoosting = true;
    });
    
    this.input.keyboard?.on('keyup-SPACE', () => {
      this.isBoosting = false;
    });
    
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (pointer.leftButtonDown()) {
        this.isBoosting = true;
      }
    });
    
    this.input.on('pointerup', () => {
      this.isBoosting = false;
    });
  }

  private connectToServer(): void {
    this.socket = io(GAME_CONFIG.SERVER_URL, {
      transports: ['websocket'],
    });
    
    this.socket.on('connected', (playerId: string) => {
      console.log('Connected to server with ID:', playerId);
      this.playerId = playerId;
    });
    
    this.socket.on('gameState', (snapshot: GameSnapshot) => {
      this.handleGameState(snapshot);
    });
    
    this.socket.on('playerJoined', (playerId: string) => {
      console.log('Player joined:', playerId);
    });
    
    this.socket.on('playerLeft', (playerId: string) => {
      console.log('Player left:', playerId);
      this.removeOtherPlayer(playerId);
    });
    
    this.socket.on('connect_error', (error) => {
      console.warn('Connection error:', error.message);
    });
  }

  private handleGameState(snapshot: GameSnapshot): void {
    // Update other players
    for (const [id, playerState] of Object.entries(snapshot.players)) {
      if (id === this.playerId) {
        // Could add server reconciliation here later
        continue;
      }
      this.updateOtherPlayer(id, playerState);
    }
    
    // Remove disconnected players
    for (const id of this.otherPlayers.keys()) {
      if (!snapshot.players[id]) {
        this.removeOtherPlayer(id);
      }
    }
  }

  private updateOtherPlayer(id: string, state: PlayerState): void {
    let playerContainer = this.otherPlayers.get(id);
    
    if (!playerContainer) {
      // Create new player representation
      playerContainer = this.add.container(state.x, state.y);
      
      const glow = this.add.arc(0, 0, GAME_CONFIG.PLAYER.RADIUS * 2, 0, 360, false, 0xff6666, 0.3);
      const core = this.add.arc(0, 0, GAME_CONFIG.PLAYER.RADIUS, 0, 360, false, 0xffaaaa, 1);
      
      playerContainer.add([glow, core]);
      this.otherPlayers.set(id, playerContainer);
    }
    
    // Update position (later: use interpolation)
    playerContainer.setPosition(state.x, state.y);
  }

  private removeOtherPlayer(id: string): void {
    const playerContainer = this.otherPlayers.get(id);
    if (playerContainer) {
      playerContainer.destroy();
      this.otherPlayers.delete(id);
    }
  }

  update(_time: number, delta: number): void {
    this.handleMovement(delta);
    this.sendInputToServer();
  }

  private handleMovement(delta: number): void {
    const pointer = this.input.activePointer;
    const camera = this.cameras.main;
    
    // Get mouse position relative to screen center
    const centerX = camera.width / 2;
    const centerY = camera.height / 2;
    
    const mouseOffsetX = pointer.x - centerX;
    const mouseOffsetY = pointer.y - centerY;
    
    // Calculate distance from center (for speed control)
    const distance = Math.sqrt(mouseOffsetX * mouseOffsetX + mouseOffsetY * mouseOffsetY);
    const maxDistance = Math.min(centerX, centerY);
    
    // Only move if mouse is far enough from center
    if (distance > 10) {
      // Calculate target angle from mouse position
      this.targetAngle = Math.atan2(mouseOffsetY, mouseOffsetX);
      
      // Smoothly rotate towards target (limited turn speed for boat-like feel)
      const angleDiff = Phaser.Math.Angle.Wrap(this.targetAngle - this.currentAngle);
      const turnAmount = GAME_CONFIG.PLAYER.TURN_SPEED * (delta / 1000);
      
      if (Math.abs(angleDiff) < turnAmount) {
        this.currentAngle = this.targetAngle;
      } else if (angleDiff > 0) {
        this.currentAngle += turnAmount;
      } else {
        this.currentAngle -= turnAmount;
      }
      
      this.currentAngle = Phaser.Math.Angle.Wrap(this.currentAngle);
      
      // Calculate speed based on mouse distance (normalized 0-1)
      const speedFactor = Math.min(distance / maxDistance, 1);
      const baseSpeed = GAME_CONFIG.PLAYER.BASE_SPEED * speedFactor;
      
      // Apply boost if active
      this.currentSpeed = this.isBoosting 
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
    let newX = this.lantern.x + velocityX * (delta / 1000);
    let newY = this.lantern.y + velocityY * (delta / 1000);
    
    // Clamp to world bounds
    const radius = GAME_CONFIG.PLAYER.RADIUS;
    newX = Phaser.Math.Clamp(newX, radius, GAME_CONFIG.WORLD_WIDTH - radius);
    newY = Phaser.Math.Clamp(newY, radius, GAME_CONFIG.WORLD_HEIGHT - radius);
    
    this.lantern.setPosition(newX, newY);
    
    // Visual feedback for boosting
    if (this.isBoosting) {
      this.lanternGlow.setFillStyle(GAME_CONFIG.COLORS.LANTERN_GLOW, 0.5);
      this.lanternGlow.setRadius(GAME_CONFIG.PLAYER.RADIUS * 2.5);
    } else {
      this.lanternGlow.setFillStyle(GAME_CONFIG.COLORS.LANTERN_GLOW, 0.3);
      this.lanternGlow.setRadius(GAME_CONFIG.PLAYER.RADIUS * 2);
    }
  }

  private sendInputToServer(): void {
    if (!this.socket.connected) return;
    
    const pointer = this.input.activePointer;
    const camera = this.cameras.main;
    
    const centerX = camera.width / 2;
    const centerY = camera.height / 2;
    
    // Normalize mouse position to -1 to 1 range
    const normalizedX = (pointer.x - centerX) / centerX;
    const normalizedY = (pointer.y - centerY) / centerY;
    
    const input: PlayerInput = {
      mouseX: Phaser.Math.Clamp(normalizedX, -1, 1),
      mouseY: Phaser.Math.Clamp(normalizedY, -1, 1),
      boosting: this.isBoosting,
      timestamp: Date.now(),
    };
    
    this.socket.emit('playerInput', input);
  }
}

