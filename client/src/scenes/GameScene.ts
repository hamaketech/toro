import Phaser from 'phaser';
import { io, Socket } from 'socket.io-client';
import { GAME_CONFIG } from '../config';
import { SnapshotInterpolation, InterpolatedPlayer, InterpolatedFood } from '../network/SnapshotInterpolation';
import { ClientPrediction } from '../network/ClientPrediction';
import type { 
  ServerToClientEvents, 
  ClientToServerEvents, 
  PlayerInput, 
  GameSnapshot, 
  InitialGameState,
  BodySegment,
} from '@shared/types';

type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

interface BodySegmentVisual {
  glow: Phaser.GameObjects.Arc;
  core: Phaser.GameObjects.Arc;
}

interface RemotePlayerVisual {
  container: Phaser.GameObjects.Container;
  glow: Phaser.GameObjects.Arc;
  core: Phaser.GameObjects.Arc;
  bodySegments: BodySegmentVisual[];
}

interface FoodVisual {
  container: Phaser.GameObjects.Container;
  glow: Phaser.GameObjects.Arc;
  core: Phaser.GameObjects.Arc;
}

// =============================================================================
// GAME SCENE
// =============================================================================

/**
 * Main game scene - handles player movement, rendering, and server communication
 * 
 * Phase 3 features:
 * - Body segments (snake-like procession)
 * - Food (Hitodama) collection
 * - Magnetic pull effect on food
 * - Boost drops body segments as food
 */
export class GameScene extends Phaser.Scene {
  private socket!: GameSocket;
  private playerId: string | null = null;
  
  // Network systems
  private snapshotInterpolation!: SnapshotInterpolation;
  private clientPrediction!: ClientPrediction;
  private timeSyncInterval?: number;
  
  // Local player graphics
  private lantern!: Phaser.GameObjects.Container;
  private lanternGlow!: Phaser.GameObjects.Arc;
  private lanternCore!: Phaser.GameObjects.Arc;
  private localBodySegments: BodySegmentVisual[] = [];
  
  // Other players
  private otherPlayers: Map<string, RemotePlayerVisual> = new Map();
  
  // Food visuals
  private foodVisuals: Map<string, FoodVisual> = new Map();
  
  // Input state
  private isBoosting = false;
  
  // World bounds graphics
  private worldBounds!: Phaser.GameObjects.Graphics;
  
  // Debug display
  private debugText?: Phaser.GameObjects.Text;
  private showDebug = false;
  
  // Animation time
  private animTime = 0;

  constructor() {
    super({ key: 'GameScene' });
  }

  create(): void {
    this.snapshotInterpolation = new SnapshotInterpolation();
    
    this.setupWorld();
    this.createPlayer();
    this.setupInput();
    this.connectToServer();
    this.setupDebug();
  }

  // ===========================================================================
  // SETUP
  // ===========================================================================

  private setupWorld(): void {
    this.worldBounds = this.add.graphics();
    this.worldBounds.lineStyle(3, 0x334455, 0.8);
    this.worldBounds.strokeRect(0, 0, GAME_CONFIG.WORLD_WIDTH, GAME_CONFIG.WORLD_HEIGHT);
    
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
    
    this.cameras.main.setBounds(0, 0, GAME_CONFIG.WORLD_WIDTH, GAME_CONFIG.WORLD_HEIGHT);
    this.physics.world.setBounds(0, 0, GAME_CONFIG.WORLD_WIDTH, GAME_CONFIG.WORLD_HEIGHT);
  }

  private createPlayer(): void {
    const startX = GAME_CONFIG.WORLD_WIDTH / 2;
    const startY = GAME_CONFIG.WORLD_HEIGHT / 2;
    
    this.clientPrediction = new ClientPrediction(startX, startY, 0);
    
    this.lantern = this.add.container(startX, startY);
    this.lantern.setDepth(100);
    
    this.lanternGlow = this.add.arc(
      0, 0, 
      GAME_CONFIG.PLAYER.RADIUS * 2, 
      0, 360, false, 
      GAME_CONFIG.COLORS.LANTERN_GLOW, 0.3
    );
    
    this.lanternCore = this.add.arc(
      0, 0, 
      GAME_CONFIG.PLAYER.RADIUS, 
      0, 360, false, 
      GAME_CONFIG.COLORS.LANTERN_CORE, 1
    );
    
    this.lantern.add([this.lanternGlow, this.lanternCore]);
    
    this.cameras.main.startFollow(this.lantern, true, 0.1, 0.1);
    this.cameras.main.setZoom(1);
  }

  private setupInput(): void {
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

  // ===========================================================================
  // NETWORKING
  // ===========================================================================

  private connectToServer(): void {
    this.socket = io(GAME_CONFIG.SERVER_URL, {
      transports: ['websocket'],
    });
    
    this.socket.on('connected', (state: InitialGameState) => {
      console.log('Connected to server with ID:', state.playerId);
      this.playerId = state.playerId;
      
      const myState = state.snapshot.players[state.playerId];
      if (myState) {
        this.clientPrediction.setPosition(myState.x, myState.y, myState.angle);
        this.lantern.setPosition(myState.x, myState.y);
      }
      
      this.snapshotInterpolation.addSnapshot(state.snapshot);
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
    
    this.socket.on('foodCollected', (_foodId: string, _playerId: string) => {
      // Could play collection sound/effect here
    });
    
    this.socket.on('connect_error', (error) => {
      console.warn('Connection error:', error.message);
    });
  }

  private startTimeSync(): void {
    this.socket.emit('ping', Date.now());
    
    this.timeSyncInterval = window.setInterval(() => {
      if (this.socket.connected) {
        this.socket.emit('ping', Date.now());
      }
    }, GAME_CONFIG.NETWORK.TIME_SYNC_INTERVAL);
  }

  private handleGameState(snapshot: GameSnapshot): void {
    this.snapshotInterpolation.addSnapshot(snapshot);
    
    if (this.playerId) {
      const myServerState = snapshot.players[this.playerId];
      if (myServerState) {
        this.clientPrediction.reconcile(myServerState);
        // Update local body segments from server state
        this.updateLocalBodySegments(myServerState.bodySegments);
      }
    }
  }

  // ===========================================================================
  // LOCAL PLAYER BODY SEGMENTS
  // ===========================================================================

  private updateLocalBodySegments(segments: BodySegment[]): void {
    const segmentRadius = GAME_CONFIG.BODY.SEGMENT_RADIUS;
    const glowRadius = GAME_CONFIG.BODY.SEGMENT_GLOW_RADIUS;
    
    // Add new segments if needed
    while (this.localBodySegments.length < segments.length) {
      const index = this.localBodySegments.length;
      const opacity = this.calculateSegmentOpacity(index, segments.length);
      
      const glow = this.add.arc(0, 0, glowRadius, 0, 360, false, GAME_CONFIG.COLORS.SPIRIT_GLOW, opacity * 0.4);
      const core = this.add.arc(0, 0, segmentRadius, 0, 360, false, GAME_CONFIG.COLORS.SPIRIT_CORE, opacity);
      
      glow.setDepth(50 - index);
      core.setDepth(50 - index);
      
      this.localBodySegments.push({ glow, core });
    }
    
    // Remove excess segments
    while (this.localBodySegments.length > segments.length) {
      const removed = this.localBodySegments.pop();
      if (removed) {
        removed.glow.destroy();
        removed.core.destroy();
      }
    }
    
    // Update positions and opacity
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      const visual = this.localBodySegments[i];
      const opacity = this.calculateSegmentOpacity(i, segments.length);
      
      visual.glow.setPosition(segment.x, segment.y);
      visual.core.setPosition(segment.x, segment.y);
      visual.glow.setAlpha(opacity * 0.4);
      visual.core.setAlpha(opacity);
    }
  }

  private calculateSegmentOpacity(index: number, totalSegments: number): number {
    if (totalSegments <= 1) return 1;
    const t = index / (totalSegments - 1);
    return Phaser.Math.Linear(1, GAME_CONFIG.BODY.TAIL_OPACITY_MIN, t);
  }

  // ===========================================================================
  // OTHER PLAYERS
  // ===========================================================================

  private updateOtherPlayers(): void {
    const interpolatedPlayers = this.snapshotInterpolation.getInterpolatedPlayers(
      this.playerId || undefined
    );
    
    for (const [id, playerState] of interpolatedPlayers) {
      this.updateOtherPlayerVisual(id, playerState);
    }
    
    for (const id of this.otherPlayers.keys()) {
      if (!interpolatedPlayers.has(id)) {
        this.removeOtherPlayer(id);
      }
    }
  }

  private updateOtherPlayerVisual(id: string, state: InterpolatedPlayer): void {
    let visual = this.otherPlayers.get(id);
    
    if (!visual) {
      const container = this.add.container(state.x, state.y);
      container.setDepth(90);
      
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
      
      visual = { container, glow, core, bodySegments: [] };
      this.otherPlayers.set(id, visual);
    }
    
    visual.container.setPosition(state.x, state.y);
    
    // Update body segments
    this.updateOtherPlayerBodySegments(visual, state.bodySegments);
  }

  private updateOtherPlayerBodySegments(visual: RemotePlayerVisual, segments: BodySegment[]): void {
    const segmentRadius = GAME_CONFIG.BODY.SEGMENT_RADIUS;
    const glowRadius = GAME_CONFIG.BODY.SEGMENT_GLOW_RADIUS;
    
    // Add new segments
    while (visual.bodySegments.length < segments.length) {
      const index = visual.bodySegments.length;
      const opacity = this.calculateSegmentOpacity(index, segments.length);
      
      const glow = this.add.arc(0, 0, glowRadius, 0, 360, false, GAME_CONFIG.COLORS.OTHER_SPIRIT_GLOW, opacity * 0.4);
      const core = this.add.arc(0, 0, segmentRadius, 0, 360, false, GAME_CONFIG.COLORS.OTHER_SPIRIT_CORE, opacity);
      
      glow.setDepth(40 - index);
      core.setDepth(40 - index);
      
      visual.bodySegments.push({ glow, core });
    }
    
    // Remove excess
    while (visual.bodySegments.length > segments.length) {
      const removed = visual.bodySegments.pop();
      if (removed) {
        removed.glow.destroy();
        removed.core.destroy();
      }
    }
    
    // Update positions
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      const segVisual = visual.bodySegments[i];
      const opacity = this.calculateSegmentOpacity(i, segments.length);
      
      segVisual.glow.setPosition(segment.x, segment.y);
      segVisual.core.setPosition(segment.x, segment.y);
      segVisual.glow.setAlpha(opacity * 0.4);
      segVisual.core.setAlpha(opacity);
    }
  }

  private removeOtherPlayer(id: string): void {
    const visual = this.otherPlayers.get(id);
    if (visual) {
      visual.container.destroy();
      for (const seg of visual.bodySegments) {
        seg.glow.destroy();
        seg.core.destroy();
      }
      this.otherPlayers.delete(id);
    }
  }

  // ===========================================================================
  // FOOD RENDERING
  // ===========================================================================

  private updateFood(): void {
    const interpolatedFood = this.snapshotInterpolation.getInterpolatedFood();
    
    // Update existing and create new food visuals
    for (const [id, foodState] of interpolatedFood) {
      this.updateFoodVisual(id, foodState);
    }
    
    // Remove food that no longer exists
    for (const id of this.foodVisuals.keys()) {
      if (!interpolatedFood.has(id)) {
        this.removeFoodVisual(id);
      }
    }
  }

  private updateFoodVisual(id: string, state: InterpolatedFood): void {
    let visual = this.foodVisuals.get(id);
    
    if (!visual) {
      const container = this.add.container(state.x, state.y);
      container.setDepth(10);
      
      const glowRadius = state.radius * GAME_CONFIG.FOOD.GLOW_MULTIPLIER;
      
      const glow = this.add.arc(
        0, 0, 
        glowRadius, 
        0, 360, false, 
        GAME_CONFIG.COLORS.HITODAMA_GLOW, 0.4
      );
      
      const core = this.add.arc(
        0, 0, 
        state.radius, 
        0, 360, false, 
        GAME_CONFIG.COLORS.HITODAMA_CORE, 0.9
      );
      
      container.add([glow, core]);
      
      visual = { container, glow, core };
      this.foodVisuals.set(id, visual);
    }
    
    visual.container.setPosition(state.x, state.y);
    
    // Subtle pulse animation
    const pulse = 1 + Math.sin(this.animTime * GAME_CONFIG.FOOD.PULSE_SPEED + state.x * 0.01) * GAME_CONFIG.FOOD.PULSE_AMOUNT;
    visual.glow.setScale(pulse);
    visual.core.setScale(pulse * 0.9);
  }

  private removeFoodVisual(id: string): void {
    const visual = this.foodVisuals.get(id);
    if (visual) {
      visual.container.destroy();
      this.foodVisuals.delete(id);
    }
  }

  // ===========================================================================
  // GAME LOOP
  // ===========================================================================

  update(time: number, delta: number): void {
    if (!this.playerId) return;
    
    this.animTime = time / 1000;
    
    this.handleLocalMovement(delta);
    this.updateOtherPlayers();
    this.updateFood();
    this.sendInputToServer();
    this.updateDebug();
  }

  private handleLocalMovement(delta: number): void {
    const pointer = this.input.activePointer;
    const camera = this.cameras.main;
    
    const centerX = camera.width / 2;
    const centerY = camera.height / 2;
    
    const mouseOffsetX = pointer.x - centerX;
    const mouseOffsetY = pointer.y - centerY;
    
    const normalizedX = mouseOffsetX / centerX;
    const normalizedY = mouseOffsetY / centerY;
    
    const sequence = this.clientPrediction.getNextSequence();
    
    const predicted = this.clientPrediction.processInput(
      Phaser.Math.Clamp(normalizedX, -1, 1),
      Phaser.Math.Clamp(normalizedY, -1, 1),
      this.isBoosting,
      delta,
      sequence
    );
    
    this.lantern.setPosition(predicted.x, predicted.y);
    
    // Boost visual feedback
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
    const pos = this.clientPrediction.getRawPosition();
    const latestState = this.snapshotInterpolation.getLatestPlayerState(this.playerId || '');
    
    this.debugText.setText([
      `Phase 3: Snake Logic + Food`,
      `RTT: ${rtt}ms`,
      `Position: (${pos.x.toFixed(0)}, ${pos.y.toFixed(0)})`,
      `Body Segments: ${this.localBodySegments.length}`,
      `Target Length: ${latestState?.targetLength ?? 0}`,
      `Score: ${latestState?.score ?? 0}`,
      `Food Items: ${this.foodVisuals.size}`,
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
