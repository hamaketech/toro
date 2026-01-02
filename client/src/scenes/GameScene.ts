import Phaser from 'phaser';
import { io, Socket } from 'socket.io-client';
import { GAME_CONFIG } from '../config';
import { SnapshotInterpolation, InterpolatedPlayer } from '../network/SnapshotInterpolation';
import { ClientPrediction } from '../network/ClientPrediction';
import type { 
  ServerToClientEvents, 
  ClientToServerEvents, 
  PlayerInput, 
  GameSnapshot, 
  InitialGameState 
} from '@shared/types';

type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/**
 * Remote player visual representation
 */
interface RemotePlayerVisual {
  container: Phaser.GameObjects.Container;
  glow: Phaser.GameObjects.Arc;
  core: Phaser.GameObjects.Arc;
}

/**
 * Main game scene - handles player movement, rendering, and server communication
 * 
 * Phase 2 features:
 * - Snapshot interpolation for smooth remote player movement
 * - Client-side prediction for responsive local movement
 * - Server reconciliation to correct prediction errors
 */
export class GameScene extends Phaser.Scene {
  private socket!: GameSocket;
  private playerId: string | null = null;
  
  // Network systems
  private snapshotInterpolation!: SnapshotInterpolation;
  private clientPrediction!: ClientPrediction;
  private timeSyncInterval?: number;
  
  // Graphics objects
  private lantern!: Phaser.GameObjects.Container;
  private lanternGlow!: Phaser.GameObjects.Arc;
  private lanternCore!: Phaser.GameObjects.Arc;
  
  // Other players
  private otherPlayers: Map<string, RemotePlayerVisual> = new Map();
  
  // Input state
  private isBoosting = false;
  
  // World bounds graphics
  private worldBounds!: Phaser.GameObjects.Graphics;
  
  // Debug display
  private debugText?: Phaser.GameObjects.Text;
  private showDebug = false;

  constructor() {
    super({ key: 'GameScene' });
  }

  create(): void {
    // Initialize network systems
    this.snapshotInterpolation = new SnapshotInterpolation();
    
    this.setupWorld();
    this.createPlayer();
    this.setupInput();
    this.connectToServer();
    this.setupDebug();
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
    const startX = GAME_CONFIG.WORLD_WIDTH / 2;
    const startY = GAME_CONFIG.WORLD_HEIGHT / 2;
    
    // Initialize client prediction
    this.clientPrediction = new ClientPrediction(startX, startY, 0);
    
    // Create lantern container (will hold glow + core)
    this.lantern = this.add.container(startX, startY);
    
    // Outer glow effect
    this.lanternGlow = this.add.arc(
      0, 0, 
      GAME_CONFIG.PLAYER.RADIUS * 2, 
      0, 360, false, 
      GAME_CONFIG.COLORS.LANTERN_GLOW, 0.3
    );
    
    // Inner core (the actual hitbox visualization)
    this.lanternCore = this.add.arc(
      0, 0, 
      GAME_CONFIG.PLAYER.RADIUS, 
      0, 360, false, 
      GAME_CONFIG.COLORS.LANTERN_CORE, 1
    );
    
    // Add to container
    this.lantern.add([this.lanternGlow, this.lanternCore]);
    
    // Camera follows the lantern
    this.cameras.main.startFollow(this.lantern, true, 0.1, 0.1);
    this.cameras.main.setZoom(1);
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
    
    // Toggle debug with F3
    this.input.keyboard?.on('keydown-F3', () => {
      this.showDebug = !this.showDebug;
      if (this.debugText) {
        this.debugText.setVisible(this.showDebug);
      }
    });
  }

  private setupDebug(): void {
    this.debugText = this.add.text(10, 10, '', {
      fontSize: '14px',
      color: '#88ff88',
      backgroundColor: '#000000aa',
      padding: { x: 8, y: 4 },
    });
    this.debugText.setScrollFactor(0);
    this.debugText.setDepth(1000);
    this.debugText.setVisible(this.showDebug);
  }

  private connectToServer(): void {
    this.socket = io(GAME_CONFIG.SERVER_URL, {
      transports: ['websocket'],
    });
    
    this.socket.on('connected', (state: InitialGameState) => {
      console.log('Connected to server with ID:', state.playerId);
      this.playerId = state.playerId;
      
      // Get our initial position from server
      const myState = state.snapshot.players[state.playerId];
      if (myState) {
        this.clientPrediction.setPosition(myState.x, myState.y, myState.angle);
        this.lantern.setPosition(myState.x, myState.y);
      }
      
      // Add initial snapshot
      this.snapshotInterpolation.addSnapshot(state.snapshot);
      
      // Start time sync
      this.startTimeSync();
    });
    
    this.socket.on('gameState', (snapshot: GameSnapshot) => {
      this.handleGameState(snapshot);
    });
    
    this.socket.on('pong', (serverTime: number, clientTime: number) => {
      this.snapshotInterpolation.updateTimeSync(serverTime, clientTime);
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

  private startTimeSync(): void {
    // Initial sync
    this.socket.emit('ping', Date.now());
    
    // Periodic sync
    this.timeSyncInterval = window.setInterval(() => {
      if (this.socket.connected) {
        this.socket.emit('ping', Date.now());
      }
    }, GAME_CONFIG.NETWORK.TIME_SYNC_INTERVAL);
  }

  private handleGameState(snapshot: GameSnapshot): void {
    // Add snapshot to interpolation buffer
    this.snapshotInterpolation.addSnapshot(snapshot);
    
    // Reconcile local player with server state
    if (this.playerId) {
      const myServerState = snapshot.players[this.playerId];
      if (myServerState) {
        this.clientPrediction.reconcile(myServerState);
      }
    }
  }

  private updateOtherPlayers(): void {
    // Get interpolated states for all other players
    const interpolatedPlayers = this.snapshotInterpolation.getInterpolatedPlayers(
      this.playerId || undefined
    );
    
    // Update existing and create new player visuals
    for (const [id, playerState] of interpolatedPlayers) {
      this.updateOtherPlayerVisual(id, playerState);
    }
    
    // Remove players that are no longer in the interpolated state
    for (const id of this.otherPlayers.keys()) {
      if (!interpolatedPlayers.has(id)) {
        this.removeOtherPlayer(id);
      }
    }
  }

  private updateOtherPlayerVisual(id: string, state: InterpolatedPlayer): void {
    let visual = this.otherPlayers.get(id);
    
    if (!visual) {
      // Create new player visual
      const container = this.add.container(state.x, state.y);
      
      const glow = this.add.arc(
        0, 0, 
        GAME_CONFIG.PLAYER.RADIUS * 2, 
        0, 360, false, 
        GAME_CONFIG.COLORS.OTHER_PLAYER_GLOW, 0.3
      );
      
      const core = this.add.arc(
        0, 0, 
        GAME_CONFIG.PLAYER.RADIUS, 
        0, 360, false, 
        GAME_CONFIG.COLORS.OTHER_PLAYER_CORE, 1
      );
      
      container.add([glow, core]);
      
      visual = { container, glow, core };
      this.otherPlayers.set(id, visual);
    }
    
    // Update position (now smoothly interpolated!)
    visual.container.setPosition(state.x, state.y);
  }

  private removeOtherPlayer(id: string): void {
    const visual = this.otherPlayers.get(id);
    if (visual) {
      visual.container.destroy();
      this.otherPlayers.delete(id);
    }
  }

  update(_time: number, delta: number): void {
    if (!this.playerId) return;
    
    // Process local movement with client-side prediction
    this.handleLocalMovement(delta);
    
    // Update other players with interpolation
    this.updateOtherPlayers();
    
    // Send input to server
    this.sendInputToServer();
    
    // Update debug display
    this.updateDebug();
  }

  private handleLocalMovement(delta: number): void {
    const pointer = this.input.activePointer;
    const camera = this.cameras.main;
    
    // Get mouse position relative to screen center
    const centerX = camera.width / 2;
    const centerY = camera.height / 2;
    
    const mouseOffsetX = pointer.x - centerX;
    const mouseOffsetY = pointer.y - centerY;
    
    // Normalize to -1 to 1 range
    const normalizedX = mouseOffsetX / centerX;
    const normalizedY = mouseOffsetY / centerY;
    
    // Get next sequence number
    const sequence = this.clientPrediction.getNextSequence();
    
    // Process input with prediction
    const predicted = this.clientPrediction.processInput(
      Phaser.Math.Clamp(normalizedX, -1, 1),
      Phaser.Math.Clamp(normalizedY, -1, 1),
      this.isBoosting,
      delta,
      sequence
    );
    
    // Update lantern position
    this.lantern.setPosition(predicted.x, predicted.y);
    
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
      sequence: this.clientPrediction.getNextSequence(),
      mouseX: Phaser.Math.Clamp(normalizedX, -1, 1),
      mouseY: Phaser.Math.Clamp(normalizedY, -1, 1),
      boosting: this.isBoosting,
      timestamp: Date.now(),
    };
    
    this.socket.emit('playerInput', input);
  }

  private updateDebug(): void {
    if (!this.debugText || !this.showDebug) return;
    
    const rtt = this.snapshotInterpolation.getRTT();
    const serverTime = this.snapshotInterpolation.getServerTime();
    const renderTime = this.snapshotInterpolation.getRenderTime();
    const pos = this.clientPrediction.getRawPosition();
    
    this.debugText.setText([
      `Phase 2: Multiplayer Movement`,
      `RTT: ${rtt}ms`,
      `Interpolation Delay: ${GAME_CONFIG.NETWORK.INTERPOLATION_DELAY}ms`,
      `Server Time: ${serverTime}`,
      `Render Time: ${renderTime}`,
      `Position: (${pos.x.toFixed(1)}, ${pos.y.toFixed(1)})`,
      `Other Players: ${this.otherPlayers.size}`,
      `[F3 to toggle debug]`,
    ].join('\n'));
  }

  shutdown(): void {
    if (this.timeSyncInterval) {
      clearInterval(this.timeSyncInterval);
    }
    this.socket?.disconnect();
  }
}
