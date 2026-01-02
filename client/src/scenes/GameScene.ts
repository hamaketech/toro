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
  DeathEvent,
} from '@shared/types';

type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

interface BodySegmentVisual {
  glow: Phaser.GameObjects.Arc;
  core: Phaser.GameObjects.Arc;
  /** Unique phase offset for animations */
  phaseOffset: number;
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
  innerGlow: Phaser.GameObjects.Arc;
  core: Phaser.GameObjects.Arc;
  /** Unique phase offset for animations */
  phaseOffset: number;
}

interface DeathParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  alpha: number;
  life: number;
  color: number;
}

// =============================================================================
// GAME SCENE
// =============================================================================

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
  private keyboardInput = { x: 0, y: 0, active: false };
  private cursors?: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasdKeys?: {
    W: Phaser.Input.Keyboard.Key;
    A: Phaser.Input.Keyboard.Key;
    S: Phaser.Input.Keyboard.Key;
    D: Phaser.Input.Keyboard.Key;
  };
  
  // World bounds graphics
  private worldBounds!: Phaser.GameObjects.Graphics;
  private worldBorderWarning!: Phaser.GameObjects.Graphics;
  
  // Debug display
  private debugText?: Phaser.GameObjects.Text;
  private showDebug = false;
  
  // Animation time
  private animTime = 0;
  
  // Death state
  private isAlive = true;
  private deathOverlay?: Phaser.GameObjects.Container;
  private deathParticles: DeathParticle[] = [];
  private deathParticleGraphics?: Phaser.GameObjects.Graphics;
  
  // Scoreboard UI
  private scoreboardContainer?: Phaser.GameObjects.Container;
  private scoreboardEntries: Phaser.GameObjects.Text[] = [];

  constructor() {
    super({ key: 'GameScene' });
  }

  create(): void {
    this.snapshotInterpolation = new SnapshotInterpolation();
    
    this.setupWorld();
    this.createPlayer();
    this.setupInput();
    this.createScoreboard();
    this.createDeathParticleSystem();
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
    
    // World border danger zone warning
    this.worldBorderWarning = this.add.graphics();
    this.worldBorderWarning.lineStyle(8, 0xff4444, 0.15);
    this.worldBorderWarning.strokeRect(10, 10, GAME_CONFIG.WORLD_WIDTH - 20, GAME_CONFIG.WORLD_HEIGHT - 20);
    this.worldBorderWarning.lineStyle(4, 0xff6666, 0.25);
    this.worldBorderWarning.strokeRect(5, 5, GAME_CONFIG.WORLD_WIDTH - 10, GAME_CONFIG.WORLD_HEIGHT - 10);
    
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
      GAME_CONFIG.PLAYER.RADIUS * 2.2, 
      0, 360, false, 
      GAME_CONFIG.COLORS.LANTERN_GLOW, 0.35
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
    // Setup cursor keys (arrow keys)
    this.cursors = this.input.keyboard?.createCursorKeys();
    
    // Setup WASD keys
    if (this.input.keyboard) {
      this.wasdKeys = {
        W: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W),
        A: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A),
        S: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S),
        D: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D),
      };
    }
    
    this.input.keyboard?.on('keydown-SPACE', () => {
      if (this.isAlive) {
        this.isBoosting = true;
      }
    });
    
    this.input.keyboard?.on('keyup-SPACE', () => {
      this.isBoosting = false;
    });
    
    // Shift key also triggers boost
    this.input.keyboard?.on('keydown-SHIFT', () => {
      if (this.isAlive) {
        this.isBoosting = true;
      }
    });
    
    this.input.keyboard?.on('keyup-SHIFT', () => {
      this.isBoosting = false;
    });
    
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (pointer.leftButtonDown()) {
        if (this.isAlive) {
          this.isBoosting = true;
        } else {
          // Click to respawn when dead
          this.requestRespawn();
        }
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
    
    // Press Enter or Space to respawn when dead
    this.input.keyboard?.on('keydown-ENTER', () => {
      if (!this.isAlive) {
        this.requestRespawn();
      }
    });
  }
  
  private updateKeyboardInput(): void {
    let kx = 0;
    let ky = 0;
    
    // Check arrow keys
    if (this.cursors) {
      if (this.cursors.left.isDown) kx -= 1;
      if (this.cursors.right.isDown) kx += 1;
      if (this.cursors.up.isDown) ky -= 1;
      if (this.cursors.down.isDown) ky += 1;
    }
    
    // Check WASD keys
    if (this.wasdKeys) {
      if (this.wasdKeys.A.isDown) kx -= 1;
      if (this.wasdKeys.D.isDown) kx += 1;
      if (this.wasdKeys.W.isDown) ky -= 1;
      if (this.wasdKeys.S.isDown) ky += 1;
    }
    
    // Normalize diagonal movement
    const len = Math.sqrt(kx * kx + ky * ky);
    if (len > 0) {
      kx /= len;
      ky /= len;
    }
    
    this.keyboardInput = {
      x: kx,
      y: ky,
      active: len > 0,
    };
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
  // SCOREBOARD UI
  // ===========================================================================

  private createScoreboard(): void {
    this.scoreboardContainer = this.add.container(0, 0);
    this.scoreboardContainer.setScrollFactor(0);
    this.scoreboardContainer.setDepth(900);
    
    // Background
    const bg = this.add.graphics();
    bg.fillStyle(0x000000, 0.6);
    bg.fillRoundedRect(0, 0, 200, 180, 8);
    bg.lineStyle(1, 0x44ffcc, 0.4);
    bg.strokeRoundedRect(0, 0, 200, 180, 8);
    this.scoreboardContainer.add(bg);
    
    // Title
    const title = this.add.text(100, 12, '🏮 LEADERBOARD', {
      fontSize: '14px',
      fontStyle: 'bold',
      color: '#ffcc66',
    });
    title.setOrigin(0.5, 0);
    this.scoreboardContainer.add(title);
    
    // Create entry slots
    for (let i = 0; i < 5; i++) {
      const entry = this.add.text(15, 40 + i * 26, '', {
        fontSize: '13px',
        color: '#aaddff',
      });
      this.scoreboardEntries.push(entry);
      this.scoreboardContainer.add(entry);
    }
    
    this.positionScoreboard();
  }

  private positionScoreboard(): void {
    if (this.scoreboardContainer) {
      const padding = 15;
      this.scoreboardContainer.setPosition(
        this.cameras.main.width - 200 - padding,
        padding
      );
    }
  }

  private updateScoreboard(): void {
    const scoreboard = this.snapshotInterpolation.getScoreboard();
    
    for (let i = 0; i < this.scoreboardEntries.length; i++) {
      const entry = this.scoreboardEntries[i];
      const data = scoreboard[i];
      
      if (data) {
        const rank = i + 1;
        const isMe = data.id === this.playerId;
        const displayId = data.id.substring(0, 6);
        const medal = rank === 1 ? '👑' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : '  ';
        
        entry.setText(`${medal} ${rank}. ${displayId} - ${data.score} pts`);
        entry.setColor(isMe ? '#ffcc66' : '#aaddff');
        entry.setAlpha(1);
      } else {
        entry.setText('');
      }
    }
  }

  // ===========================================================================
  // DEATH SYSTEM
  // ===========================================================================

  private createDeathParticleSystem(): void {
    this.deathParticleGraphics = this.add.graphics();
    this.deathParticleGraphics.setDepth(200);
  }

  private spawnDeathExplosion(x: number, y: number, foodCount: number): void {
    const particleCount = Math.min(50, foodCount * 3 + 15);
    
    for (let i = 0; i < particleCount; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 100 + Math.random() * 300;
      
      this.deathParticles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: 4 + Math.random() * 12,
        alpha: 1,
        life: 1,
        color: Math.random() > 0.5 ? 0xffcc66 : 0x44ffcc,
      });
    }
  }

  private updateDeathParticles(delta: number): void {
    if (!this.deathParticleGraphics) return;
    
    const deltaS = delta / 1000;
    this.deathParticleGraphics.clear();
    
    for (let i = this.deathParticles.length - 1; i >= 0; i--) {
      const p = this.deathParticles[i];
      
      // Update position
      p.x += p.vx * deltaS;
      p.y += p.vy * deltaS;
      
      // Apply friction
      p.vx *= 0.96;
      p.vy *= 0.96;
      
      // Decay
      p.life -= deltaS * 0.8;
      p.alpha = p.life;
      p.size *= 0.995;
      
      // Remove dead particles
      if (p.life <= 0 || p.size < 1) {
        this.deathParticles.splice(i, 1);
        continue;
      }
      
      // Draw
      this.deathParticleGraphics.fillStyle(p.color, p.alpha * 0.6);
      this.deathParticleGraphics.fillCircle(p.x, p.y, p.size * 1.5);
      this.deathParticleGraphics.fillStyle(p.color, p.alpha);
      this.deathParticleGraphics.fillCircle(p.x, p.y, p.size);
    }
  }

  private showDeathOverlay(event: DeathEvent): void {
    this.isAlive = false;
    
    // Hide local player
    this.lantern.setVisible(false);
    this.clearLocalBodySegments();
    
    // Create death overlay
    this.deathOverlay = this.add.container(0, 0);
    this.deathOverlay.setScrollFactor(0);
    this.deathOverlay.setDepth(1000);
    
    // Darken background
    const dimmer = this.add.rectangle(
      this.cameras.main.width / 2,
      this.cameras.main.height / 2,
      this.cameras.main.width,
      this.cameras.main.height,
      0x000000,
      0.7
    );
    this.deathOverlay.add(dimmer);
    
    // Death message container
    const msgY = this.cameras.main.height / 2 - 50;
    
    // "YOU DIED" text
    const deathText = this.add.text(
      this.cameras.main.width / 2,
      msgY - 40,
      '💀 YOU DIED 💀',
      {
        fontSize: '48px',
        fontStyle: 'bold',
        color: '#ff6666',
      }
    );
    deathText.setOrigin(0.5);
    this.deathOverlay.add(deathText);
    
    // Cause of death
    const causeText = this.getCauseText(event);
    const causeLabel = this.add.text(
      this.cameras.main.width / 2,
      msgY + 20,
      causeText,
      {
        fontSize: '20px',
        color: '#ffaaaa',
      }
    );
    causeLabel.setOrigin(0.5);
    this.deathOverlay.add(causeLabel);
    
    // Score
    const scoreLabel = this.add.text(
      this.cameras.main.width / 2,
      msgY + 60,
      `Final Score: ${event.score}`,
      {
        fontSize: '24px',
        color: '#ffcc66',
      }
    );
    scoreLabel.setOrigin(0.5);
    this.deathOverlay.add(scoreLabel);
    
    // Respawn hint
    const hintLabel = this.add.text(
      this.cameras.main.width / 2,
      msgY + 120,
      'Click or Press ENTER to respawn',
      {
        fontSize: '16px',
        color: '#88ffcc',
      }
    );
    hintLabel.setOrigin(0.5);
    this.deathOverlay.add(hintLabel);
    
    // Animate hint
    this.tweens.add({
      targets: hintLabel,
      alpha: { from: 1, to: 0.4 },
      duration: 800,
      yoyo: true,
      repeat: -1,
    });
  }

  private getCauseText(event: DeathEvent): string {
    switch (event.cause) {
      case 'head_collision':
        return event.killerId 
          ? `Crashed into ${event.killerId.substring(0, 6)}'s procession`
          : 'Crashed into another player';
      case 'head_to_head':
        return event.killerId 
          ? `Head-on collision with ${event.killerId.substring(0, 6)}`
          : 'Head-on collision';
      case 'world_border':
        return 'Touched the void beyond the world';
      case 'disconnect':
        return 'Lost connection';
      default:
        return 'Unknown cause';
    }
  }

  private hideDeathOverlay(): void {
    if (this.deathOverlay) {
      this.deathOverlay.destroy();
      this.deathOverlay = undefined;
    }
    
    this.isAlive = true;
    this.lantern.setVisible(true);
  }

  private requestRespawn(): void {
    if (!this.isAlive && this.socket.connected) {
      this.socket.emit('requestRespawn');
    }
  }

  private clearLocalBodySegments(): void {
    for (const seg of this.localBodySegments) {
      seg.glow.destroy();
      seg.core.destroy();
    }
    this.localBodySegments = [];
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
        this.isAlive = myState.alive;
        this.lantern.setVisible(this.isAlive);
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
    
    this.socket.on('playerDied', (event: DeathEvent) => {
      console.log('Player died:', event);
      
      // Spawn death explosion effect at location
      this.spawnDeathExplosion(event.x, event.y, event.foodDropped);
      
      // If it's us, show death overlay
      if (event.playerId === this.playerId) {
        this.showDeathOverlay(event);
      }
    });
    
    this.socket.on('playerRespawned', (playerId: string) => {
      console.log('Player respawned:', playerId);
      
      if (playerId === this.playerId) {
        this.hideDeathOverlay();
        
        // Sync position from server
        const latestState = this.snapshotInterpolation.getLatestPlayerState(playerId);
        if (latestState) {
          this.clientPrediction.setPosition(latestState.x, latestState.y, latestState.angle);
          this.lantern.setPosition(latestState.x, latestState.y);
        }
      }
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
        // Check if we just became alive (server respawned us)
        if (!this.isAlive && myServerState.alive) {
          this.hideDeathOverlay();
          this.clientPrediction.setPosition(myServerState.x, myServerState.y, myServerState.angle);
          this.lantern.setPosition(myServerState.x, myServerState.y);
        }
        
        this.isAlive = myServerState.alive;
        
        if (this.isAlive) {
          this.clientPrediction.reconcile(myServerState);
          this.updateLocalBodySegments(myServerState.bodySegments);
        }
      }
    }
  }

  // ===========================================================================
  // SEGMENT VISUAL CALCULATIONS
  // ===========================================================================

  /** Calculate progress along the body (0 = head, 1 = tail) */
  private getSegmentProgress(index: number, totalSegments: number): number {
    if (totalSegments <= 1) return 0;
    return index / (totalSegments - 1);
  }

  /** Calculate segment radius based on position */
  private getSegmentRadius(progress: number): number {
    const { SEGMENT_RADIUS_MAX, SEGMENT_RADIUS_MIN } = GAME_CONFIG.BODY;
    // Ease out for smoother tail taper
    const eased = 1 - Math.pow(progress, 0.7);
    return Phaser.Math.Linear(SEGMENT_RADIUS_MIN, SEGMENT_RADIUS_MAX, eased);
  }

  /** Calculate segment opacity based on position */
  private getSegmentOpacity(progress: number): number {
    const { OPACITY_MAX, OPACITY_MIN } = GAME_CONFIG.BODY;
    // Ease in for gentle fade
    const eased = Math.pow(progress, 0.5);
    return Phaser.Math.Linear(OPACITY_MAX, OPACITY_MIN, eased);
  }

  /** Interpolate between two colors */
  private lerpColor(colorA: number, colorB: number, t: number): number {
    const rA = (colorA >> 16) & 0xff;
    const gA = (colorA >> 8) & 0xff;
    const bA = colorA & 0xff;
    
    const rB = (colorB >> 16) & 0xff;
    const gB = (colorB >> 8) & 0xff;
    const bB = colorB & 0xff;
    
    const r = Math.round(Phaser.Math.Linear(rA, rB, t));
    const g = Math.round(Phaser.Math.Linear(gA, gB, t));
    const b = Math.round(Phaser.Math.Linear(bA, bB, t));
    
    return (r << 16) | (g << 8) | b;
  }

  /** Calculate floating wobble offset perpendicular to movement */
  private getWobbleOffset(
    index: number, 
    phaseOffset: number, 
    prevSegment: { x: number; y: number } | null,
    currentSegment: { x: number; y: number }
  ): { x: number; y: number } {
    const { WOBBLE_AMPLITUDE, WOBBLE_SPEED } = GAME_CONFIG.BODY;
    
    // Calculate perpendicular direction
    let perpX = 0;
    let perpY = 1;
    
    if (prevSegment) {
      const dx = currentSegment.x - prevSegment.x;
      const dy = currentSegment.y - prevSegment.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len > 0.1) {
        // Perpendicular to movement direction
        perpX = -dy / len;
        perpY = dx / len;
      }
    }
    
    // Sine wave wobble with unique phase per segment
    const wobblePhase = this.animTime * WOBBLE_SPEED + phaseOffset + index * 0.8;
    const wobbleAmount = Math.sin(wobblePhase) * WOBBLE_AMPLITUDE;
    
    // Reduce wobble for segments closer to head
    const wobbleFalloff = Math.min(1, index / 3);
    
    return {
      x: perpX * wobbleAmount * wobbleFalloff,
      y: perpY * wobbleAmount * wobbleFalloff,
    };
  }

  // ===========================================================================
  // LOCAL PLAYER BODY SEGMENTS
  // ===========================================================================

  private updateLocalBodySegments(segments: BodySegment[]): void {
    const { GLOW_MULTIPLIER, PULSE_AMOUNT, PULSE_SPEED } = GAME_CONFIG.BODY;
    const { SPIRIT_GLOW_HEAD, SPIRIT_GLOW_TAIL, SPIRIT_CORE_HEAD, SPIRIT_CORE_TAIL } = GAME_CONFIG.COLORS;
    
    // Add new segments if needed
    while (this.localBodySegments.length < segments.length) {
      const index = this.localBodySegments.length;
      
      // Random phase offset for varied animation
      const phaseOffset = Math.random() * Math.PI * 2;
      
      const glow = this.add.arc(0, 0, 10, 0, 360, false, SPIRIT_GLOW_HEAD, 0.5);
      const core = this.add.arc(0, 0, 5, 0, 360, false, SPIRIT_CORE_HEAD, 1);
      
      glow.setDepth(50 - index);
      core.setDepth(51 - index);
      
      this.localBodySegments.push({ glow, core, phaseOffset });
    }
    
    // Remove excess segments
    while (this.localBodySegments.length > segments.length) {
      const removed = this.localBodySegments.pop();
      if (removed) {
        removed.glow.destroy();
        removed.core.destroy();
      }
    }
    
    // Update positions, sizes, colors, and animations
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      const visual = this.localBodySegments[i];
      const prevSegment = i > 0 ? segments[i - 1] : null;
      
      const progress = this.getSegmentProgress(i, segments.length);
      const radius = this.getSegmentRadius(progress);
      const opacity = this.getSegmentOpacity(progress);
      
      // Calculate wobble
      const wobble = this.getWobbleOffset(i, visual.phaseOffset, prevSegment, segment);
      
      // Pulse animation (staggered by index)
      const pulsePhase = this.animTime * PULSE_SPEED + visual.phaseOffset;
      const pulse = 1 + Math.sin(pulsePhase) * PULSE_AMOUNT * (1 - progress * 0.5);
      
      // Apply position with wobble
      const finalX = segment.x + wobble.x;
      const finalY = segment.y + wobble.y;
      
      visual.glow.setPosition(finalX, finalY);
      visual.core.setPosition(finalX, finalY);
      
      // Apply size with pulse
      const glowRadius = radius * GLOW_MULTIPLIER * pulse;
      const coreRadius = radius * pulse;
      
      visual.glow.setRadius(glowRadius);
      visual.core.setRadius(coreRadius);
      
      // Apply gradient colors
      const glowColor = this.lerpColor(SPIRIT_GLOW_HEAD, SPIRIT_GLOW_TAIL, progress);
      const coreColor = this.lerpColor(SPIRIT_CORE_HEAD, SPIRIT_CORE_TAIL, progress);
      
      visual.glow.setFillStyle(glowColor, opacity * 0.5);
      visual.core.setFillStyle(coreColor, opacity);
    }
  }

  // ===========================================================================
  // OTHER PLAYERS
  // ===========================================================================

  private updateOtherPlayers(): void {
    const interpolatedPlayers = this.snapshotInterpolation.getInterpolatedPlayers(
      this.playerId || undefined
    );
    
    for (const [id, playerState] of interpolatedPlayers) {
      // Only render alive players
      if (playerState.alive) {
        this.updateOtherPlayerVisual(id, playerState);
      } else {
        // Remove dead players
        this.removeOtherPlayer(id);
      }
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
        GAME_CONFIG.PLAYER.RADIUS * 2.2, 
        0, 360, false, 
        GAME_CONFIG.COLORS.OTHER_PLAYER_GLOW, 0.35
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
    this.updateOtherPlayerBodySegments(visual, state.bodySegments);
  }

  private updateOtherPlayerBodySegments(visual: RemotePlayerVisual, segments: BodySegment[]): void {
    const { GLOW_MULTIPLIER, PULSE_AMOUNT, PULSE_SPEED } = GAME_CONFIG.BODY;
    const { OTHER_SPIRIT_GLOW_HEAD, OTHER_SPIRIT_GLOW_TAIL, OTHER_SPIRIT_CORE_HEAD, OTHER_SPIRIT_CORE_TAIL } = GAME_CONFIG.COLORS;
    
    // Add new segments
    while (visual.bodySegments.length < segments.length) {
      const index = visual.bodySegments.length;
      const phaseOffset = Math.random() * Math.PI * 2;
      
      const glow = this.add.arc(0, 0, 10, 0, 360, false, OTHER_SPIRIT_GLOW_HEAD, 0.5);
      const core = this.add.arc(0, 0, 5, 0, 360, false, OTHER_SPIRIT_CORE_HEAD, 1);
      
      glow.setDepth(40 - index);
      core.setDepth(41 - index);
      
      visual.bodySegments.push({ glow, core, phaseOffset });
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
      const prevSegment = i > 0 ? segments[i - 1] : null;
      
      const progress = this.getSegmentProgress(i, segments.length);
      const radius = this.getSegmentRadius(progress);
      const opacity = this.getSegmentOpacity(progress);
      
      const wobble = this.getWobbleOffset(i, segVisual.phaseOffset, prevSegment, segment);
      
      const pulsePhase = this.animTime * PULSE_SPEED + segVisual.phaseOffset;
      const pulse = 1 + Math.sin(pulsePhase) * PULSE_AMOUNT * (1 - progress * 0.5);
      
      const finalX = segment.x + wobble.x;
      const finalY = segment.y + wobble.y;
      
      segVisual.glow.setPosition(finalX, finalY);
      segVisual.core.setPosition(finalX, finalY);
      
      const glowRadius = radius * GLOW_MULTIPLIER * pulse;
      const coreRadius = radius * pulse;
      
      segVisual.glow.setRadius(glowRadius);
      segVisual.core.setRadius(coreRadius);
      
      const glowColor = this.lerpColor(OTHER_SPIRIT_GLOW_HEAD, OTHER_SPIRIT_GLOW_TAIL, progress);
      const coreColor = this.lerpColor(OTHER_SPIRIT_CORE_HEAD, OTHER_SPIRIT_CORE_TAIL, progress);
      
      segVisual.glow.setFillStyle(glowColor, opacity * 0.5);
      segVisual.core.setFillStyle(coreColor, opacity);
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
    
    for (const [id, foodState] of interpolatedFood) {
      this.updateFoodVisual(id, foodState);
    }
    
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
      
      const phaseOffset = Math.random() * Math.PI * 2;
      const baseRadius = state.radius;
      const glowRadius = baseRadius * GAME_CONFIG.FOOD.GLOW_MULTIPLIER;
      
      // Outer glow
      const glow = this.add.arc(
        0, 0, 
        glowRadius, 
        0, 360, false, 
        GAME_CONFIG.COLORS.HITODAMA_GLOW, 0.3
      );
      
      // Inner glow for depth
      const innerGlow = this.add.arc(
        0, 0, 
        baseRadius * 1.3, 
        0, 360, false, 
        GAME_CONFIG.COLORS.HITODAMA_CORE, GAME_CONFIG.FOOD.INNER_GLOW_OPACITY
      );
      
      // Bright core
      const core = this.add.arc(
        0, 0, 
        baseRadius * 0.5, 
        0, 360, false, 
        GAME_CONFIG.COLORS.HITODAMA_INNER, 0.9
      );
      
      container.add([glow, innerGlow, core]);
      
      visual = { container, glow, innerGlow, core, phaseOffset };
      this.foodVisuals.set(id, visual);
    }
    
    visual.container.setPosition(state.x, state.y);
    
    // Enhanced pulse animation with multiple frequencies
    const phase1 = this.animTime * GAME_CONFIG.FOOD.PULSE_SPEED + visual.phaseOffset;
    const phase2 = this.animTime * GAME_CONFIG.FOOD.PULSE_SPEED * 0.7 + visual.phaseOffset * 1.3;
    
    const pulse1 = Math.sin(phase1) * GAME_CONFIG.FOOD.PULSE_AMOUNT;
    const pulse2 = Math.sin(phase2) * GAME_CONFIG.FOOD.PULSE_AMOUNT * 0.5;
    const pulse = 1 + pulse1 + pulse2;
    
    // Apply pulsing scale
    visual.glow.setScale(pulse * 1.1);
    visual.innerGlow.setScale(pulse);
    visual.core.setScale(pulse * 0.9 + 0.1);
    
    // Subtle opacity pulse on glow
    visual.glow.setAlpha(0.25 + Math.sin(phase1) * 0.1);
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
    
    // Always update these
    this.updateOtherPlayers();
    this.updateFood();
    this.updateDeathParticles(delta);
    this.updateScoreboard();
    
    // Only handle local movement when alive
    if (this.isAlive) {
      this.handleLocalMovement(delta);
      this.sendInputToServer();
    }
    
    this.updateDebug();
  }

  private handleLocalMovement(delta: number): void {
    // Update keyboard state
    this.updateKeyboardInput();
    
    // Get movement input (keyboard takes priority when active)
    let inputX: number;
    let inputY: number;
    
    if (this.keyboardInput.active) {
      // Use keyboard input
      inputX = this.keyboardInput.x;
      inputY = this.keyboardInput.y;
    } else {
      // Use mouse input
      const pointer = this.input.activePointer;
      const camera = this.cameras.main;
      
      const centerX = camera.width / 2;
      const centerY = camera.height / 2;
      
      const mouseOffsetX = pointer.x - centerX;
      const mouseOffsetY = pointer.y - centerY;
      
      inputX = Phaser.Math.Clamp(mouseOffsetX / centerX, -1, 1);
      inputY = Phaser.Math.Clamp(mouseOffsetY / centerY, -1, 1);
    }
    
    const sequence = this.clientPrediction.getNextSequence();
    
    const predicted = this.clientPrediction.processInput(
      inputX,
      inputY,
      this.isBoosting,
      delta,
      sequence
    );
    
    this.lantern.setPosition(predicted.x, predicted.y);
    
    // Boost visual feedback with pulse
    const boostPulse = this.isBoosting ? 1 + Math.sin(this.animTime * 8) * 0.1 : 1;
    
    if (this.isBoosting) {
      this.lanternGlow.setFillStyle(GAME_CONFIG.COLORS.LANTERN_GLOW, 0.55);
      this.lanternGlow.setRadius(GAME_CONFIG.PLAYER.RADIUS * 2.8 * boostPulse);
    } else {
      this.lanternGlow.setFillStyle(GAME_CONFIG.COLORS.LANTERN_GLOW, 0.35);
      this.lanternGlow.setRadius(GAME_CONFIG.PLAYER.RADIUS * 2.2);
    }
    
    // Visual warning when near world border
    const pos = predicted;
    const margin = 100;
    const nearBorder = 
      pos.x < margin || 
      pos.x > GAME_CONFIG.WORLD_WIDTH - margin ||
      pos.y < margin || 
      pos.y > GAME_CONFIG.WORLD_HEIGHT - margin;
    
    if (nearBorder) {
      const warningPulse = 0.5 + Math.sin(this.animTime * 6) * 0.3;
      this.lanternCore.setFillStyle(
        this.lerpColor(GAME_CONFIG.COLORS.LANTERN_CORE, 0xff6666, warningPulse),
        1
      );
    } else {
      this.lanternCore.setFillStyle(GAME_CONFIG.COLORS.LANTERN_CORE, 1);
    }
  }

  private sendInputToServer(): void {
    if (!this.socket.connected || !this.isAlive) return;
    
    // Get movement input (keyboard takes priority when active)
    let inputX: number;
    let inputY: number;
    
    if (this.keyboardInput.active) {
      // Use keyboard input
      inputX = this.keyboardInput.x;
      inputY = this.keyboardInput.y;
    } else {
      // Use mouse input
      const pointer = this.input.activePointer;
      const camera = this.cameras.main;
      
      const centerX = camera.width / 2;
      const centerY = camera.height / 2;
      
      inputX = Phaser.Math.Clamp((pointer.x - centerX) / centerX, -1, 1);
      inputY = Phaser.Math.Clamp((pointer.y - centerY) / centerY, -1, 1);
    }
    
    const input: PlayerInput = {
      sequence: this.clientPrediction.getNextSequence(),
      mouseX: inputX,
      mouseY: inputY,
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
    const inputMode = this.keyboardInput.active ? 'Keyboard' : 'Mouse';
    
    this.debugText.setText([
      `Phase 4: Combat & Collision`,
      `RTT: ${rtt}ms`,
      `Position: (${pos.x.toFixed(0)}, ${pos.y.toFixed(0)})`,
      `Input: ${inputMode}`,
      `Alive: ${this.isAlive}`,
      `Body Segments: ${this.localBodySegments.length}`,
      `Target Length: ${latestState?.targetLength ?? 0}`,
      `Score: ${latestState?.score ?? 0}`,
      `Kills: ${latestState?.kills ?? 0}`,
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
