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
  JoinOptions,
} from '@shared/types';

type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/** Data passed from MainMenuScene */
interface SceneData {
  playerName: string;
  roomCode?: string;
}

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

interface BodySegmentVisual {
  glow: Phaser.GameObjects.Arc;
  core: Phaser.GameObjects.Arc;
  phaseOffset: number;
  // Smoothed position (interpolated)
  currentX: number;
  currentY: number;
  // Velocity for smooth following
  velX: number;
  velY: number;
}

interface RemotePlayerVisual {
  container: Phaser.GameObjects.Container;
  glow: Phaser.GameObjects.Image;
  core: Phaser.GameObjects.Image;
  nameText: Phaser.GameObjects.Text;
  bodySegments: BodySegmentVisual[];
}

interface FoodVisual {
  container: Phaser.GameObjects.Container;
  glow: Phaser.GameObjects.Image;
  core: Phaser.GameObjects.Image;
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
  private playerName = 'Hitodama';
  
  // Network systems
  private snapshotInterpolation!: SnapshotInterpolation;
  private clientPrediction!: ClientPrediction;
  private timeSyncInterval?: number;
  
  // Local player graphics
  private lantern!: Phaser.GameObjects.Container;
  private lanternGlow!: Phaser.GameObjects.Image;
  private lanternCore!: Phaser.GameObjects.Image;
  private localBodySegments: BodySegmentVisual[] = [];
  
  // Other players
  private otherPlayers: Map<string, RemotePlayerVisual> = new Map();
  
  // Food visuals
  private foodVisuals: Map<string, FoodVisual> = new Map();
  
  // Input state
  private isBoosting = false;
  private keyboardInput = { x: 0, y: 0, active: false };
  private isMobile = false;
  private touchInput = { x: 0, y: 0, active: false }; // Track mobile touch
  private boostPointerId: number | null = null; // Track which pointer is boosting
  private boostButtonBg?: Phaser.GameObjects.Arc; // Reference for visual feedback
  private boostButton?: Phaser.GameObjects.Container;
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
  
  // Room code
  private roomCode = '';
  private roomCodeUI?: Phaser.GameObjects.Container;
  
  // Minimap
  private minimapContainer?: Phaser.GameObjects.Container;
  private minimapGraphics?: Phaser.GameObjects.Graphics;
  private readonly MINIMAP_SIZE = 150;
  private readonly MINIMAP_MARGIN = 15;

  constructor() {
    super({ key: 'GameScene' });
  }

  init(data: SceneData): void {
    this.playerName = data?.playerName || 'Hitodama';
    this.roomCode = data?.roomCode || '';
  }

  preload(): void {
    // Load SVG images from public folder
    this.load.svg('lantern', '/images/lantern.svg', { width: 64, height: 64 });
    this.load.svg('devil-mask', '/images/devil-mask.svg', { width: 64, height: 64 });
    this.load.svg('ghost', '/images/ghost.svg', { width: 32, height: 32 });
  }

  create(): void {
    this.snapshotInterpolation = new SnapshotInterpolation();
    
    this.setupWorld();
    this.createPlayer();
    this.setupInput();
    this.createScoreboard();
    this.createMinimap();
    this.createDeathParticleSystem();
    this.connectToServer();
    this.setupDebug();
    this.setupBloom();
  }
  
  /**
   * Setup bloom post-processing effect
   */
  private setupBloom(): void {
    if (this.game.renderer instanceof Phaser.Renderer.WebGL.WebGLRenderer) {
      try {
        const BloomPipeline = this.game.renderer.pipelines.getPostPipeline('BloomPipeline');
        if (BloomPipeline) {
          this.cameras.main.setPostPipeline('BloomPipeline');
          console.log('Bloom effect applied to camera');
        }
      } catch (e) {
        console.warn('Could not apply bloom pipeline:', e);
      }
    }
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
    
    // Glow effect (larger, more transparent, blurred look)
    this.lanternGlow = this.add.image(0, 0, 'lantern');
    this.lanternGlow.setScale(1.4);
    this.lanternGlow.setTint(0xffcc66); // Golden glow
    this.lanternGlow.setAlpha(0.4);
    
    // Main lantern sprite
    this.lanternCore = this.add.image(0, 0, 'lantern');
    this.lanternCore.setScale(0.8);
    this.lanternCore.setTint(0xffeedd); // Warm white
    
    this.lantern.add([this.lanternGlow, this.lanternCore]);
    
    this.cameras.main.startFollow(this.lantern, true, 0.1, 0.1);
    this.cameras.main.setZoom(1);
  }

  private setupInput(): void {
    this.cursors = this.input.keyboard?.createCursorKeys();
    
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
    
    // Detect mobile
    this.isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
      || ('ontouchstart' in window)
      || (navigator.maxTouchPoints > 0);
    
    // Keyboard boost (desktop)
    this.input.keyboard?.on('keydown-SHIFT', () => {
      if (this.isAlive) {
        this.isBoosting = true;
      }
    });
    
    this.input.keyboard?.on('keyup-SHIFT', () => {
      this.isBoosting = false;
    });
    
    // Desktop: click to boost
    // Mobile: touch sets movement direction
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (!this.isMobile && pointer.leftButtonDown()) {
        // Desktop: click to boost
        if (this.isAlive) {
          this.isBoosting = true;
        } else {
          this.requestRespawn();
        }
      } else if (this.isMobile) {
        if (!this.isAlive) {
          // Mobile: tap to respawn when dead
          this.requestRespawn();
        } else {
          // Mobile: track touch position for movement
          this.updateTouchInput(pointer);
          this.touchInput.active = true;
        }
      }
    });
    
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (this.isMobile && this.isAlive && pointer.isDown) {
        this.updateTouchInput(pointer);
      }
    });
    
    this.input.on('pointerup', (pointer: Phaser.Input.Pointer) => {
      if (!this.isMobile) {
        this.isBoosting = false;
      } else {
        // On mobile: release boost if this was the boost pointer
        if (pointer.id === this.boostPointerId) {
          this.boostPointerId = null;
          this.isBoosting = false;
          if (this.boostButtonBg) {
            this.boostButtonBg.setFillStyle(0xff6600, 0.8);
            this.boostButtonBg.setScale(1);
          }
        }
        // Keep moving in last direction when finger lifts (touch stays active)
      }
    });
    
    // Create mobile boost button
    if (this.isMobile) {
      this.createMobileBoostButton();
    }
    
    this.input.keyboard?.on('keydown-F3', () => {
      this.showDebug = !this.showDebug;
      if (this.debugText) {
        this.debugText.setVisible(this.showDebug);
      }
    });
    
    this.input.keyboard?.on('keydown-ENTER', () => {
      if (!this.isAlive) {
        this.requestRespawn();
      }
    });
    
    this.input.keyboard?.on('keydown-ESC', () => {
      this.returnToMenu();
    });
  }
  
  /**
   * Create a boost button for mobile devices
   */
  private createMobileBoostButton(): void {
    const buttonSize = 100; // Bigger for easier touch
    const margin = 40;
    const x = this.cameras.main.width - buttonSize / 2 - margin;
    const y = this.cameras.main.height - buttonSize / 2 - margin;
    
    // Create button container (fixed to camera)
    this.boostButton = this.add.container(x, y);
    this.boostButton.setScrollFactor(0);
    this.boostButton.setDepth(1000);
    
    // Button background - larger hit area
    this.boostButtonBg = this.add.circle(0, 0, buttonSize / 2, 0xff6600, 0.8);
    this.boostButtonBg.setStrokeStyle(4, 0xffaa00);
    
    // Button icon (lightning bolt shape using text)
    const icon = this.add.text(0, -5, '⚡', {
      fontSize: '42px',
    });
    icon.setOrigin(0.5);
    
    // Label
    const label = this.add.text(0, 25, 'BOOST', {
      fontSize: '14px',
      color: '#ffffff',
      fontStyle: 'bold',
    });
    label.setOrigin(0.5);
    
    this.boostButton.add([this.boostButtonBg, icon, label]);
    
    // Make the whole container interactive with a large hit area
    this.boostButton.setSize(buttonSize, buttonSize);
    this.boostButton.setInteractive(new Phaser.Geom.Circle(0, 0, buttonSize / 2), Phaser.Geom.Circle.Contains);
    
    this.boostButton.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (this.isAlive) {
        this.boostPointerId = pointer.id;
        this.isBoosting = true;
        this.boostButtonBg?.setFillStyle(0xffaa00, 1);
        this.boostButtonBg?.setScale(1.1);
      }
    });
    
    // pointerup is handled globally in setupInput to catch releases anywhere
  }

  private returnToMenu(): void {
    this.shutdown();
    this.scene.start('MainMenuScene');
  }
  
  private updateKeyboardInput(): void {
    let kx = 0;
    let ky = 0;
    
    if (this.cursors) {
      if (this.cursors.left.isDown) kx -= 1;
      if (this.cursors.right.isDown) kx += 1;
      if (this.cursors.up.isDown) ky -= 1;
      if (this.cursors.down.isDown) ky += 1;
    }
    
    if (this.wasdKeys) {
      if (this.wasdKeys.A.isDown) kx -= 1;
      if (this.wasdKeys.D.isDown) kx += 1;
      if (this.wasdKeys.W.isDown) ky -= 1;
      if (this.wasdKeys.S.isDown) ky += 1;
    }
    
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
    
    const bg = this.add.graphics();
    bg.fillStyle(0x000000, 0.6);
    bg.fillRoundedRect(0, 0, 200, 180, 8);
    bg.lineStyle(1, 0x44ffcc, 0.4);
    bg.strokeRoundedRect(0, 0, 200, 180, 8);
    this.scoreboardContainer.add(bg);
    
    const title = this.add.text(100, 12, '🏮 LEADERBOARD', {
      fontSize: '14px',
      fontStyle: 'bold',
      color: '#ffcc66',
    });
    title.setOrigin(0.5, 0);
    this.scoreboardContainer.add(title);
    
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
        const displayName = data.name.substring(0, 12);
        const medal = rank === 1 ? '👑' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : '  ';
        
        entry.setText(`${medal} ${rank}. ${displayName} - ${data.score}`);
        entry.setColor(isMe ? '#ffcc66' : '#aaddff');
        entry.setAlpha(1);
      } else {
        entry.setText('');
      }
    }
  }

  // ===========================================================================
  // ROOM CODE UI (Simple display, no copy button)
  // ===========================================================================
  
  private createRoomCodeUI(): void {
    if (this.roomCodeUI) {
      this.roomCodeUI.destroy();
    }
    
    const padding = 15;
    const x = padding;
    const y = padding;
    
    this.roomCodeUI = this.add.container(x, y);
    this.roomCodeUI.setScrollFactor(0);
    this.roomCodeUI.setDepth(901);
    
    // Background
    const bg = this.add.graphics();
    bg.fillStyle(0x000000, 0.5);
    bg.fillRoundedRect(0, 0, 120, 36, 6);
    this.roomCodeUI.add(bg);
    
    // Room label + code on one line
    const codeText = this.add.text(60, 18, `🎮 ${this.roomCode}`, {
      fontSize: '13px',
      color: '#88ffcc',
      fontStyle: 'bold',
    });
    codeText.setOrigin(0.5, 0.5);
    this.roomCodeUI.add(codeText);
  }

  // ===========================================================================
  // MINIMAP
  // ===========================================================================
  
  private createMinimap(): void {
    const size = this.MINIMAP_SIZE;
    const margin = this.MINIMAP_MARGIN;
    
    // Position in bottom-left
    const x = margin;
    const y = this.cameras.main.height - size - margin;
    
    this.minimapContainer = this.add.container(x, y);
    this.minimapContainer.setScrollFactor(0);
    this.minimapContainer.setDepth(900);
    
    // Background
    const bg = this.add.graphics();
    bg.fillStyle(0x000000, 0.7);
    bg.fillRoundedRect(0, 0, size, size, 6);
    bg.lineStyle(2, 0x44ffcc, 0.5);
    bg.strokeRoundedRect(0, 0, size, size, 6);
    this.minimapContainer.add(bg);
    
    // Graphics layer for dots
    this.minimapGraphics = this.add.graphics();
    this.minimapContainer.add(this.minimapGraphics);
    
    // Title
    const title = this.add.text(size / 2, 8, 'MAP', {
      fontSize: '10px',
      color: '#44ffcc',
      fontStyle: 'bold',
    });
    title.setOrigin(0.5, 0);
    this.minimapContainer.add(title);
  }
  
  private updateMinimap(): void {
    if (!this.minimapGraphics || !this.playerId) return;
    
    const g = this.minimapGraphics;
    g.clear();
    
    const size = this.MINIMAP_SIZE;
    const padding = 15; // Padding inside minimap for dots
    const mapArea = size - padding * 2;
    const worldW = GAME_CONFIG.WORLD_WIDTH;
    const worldH = GAME_CONFIG.WORLD_HEIGHT;
    
    // Helper to convert world coords to minimap coords
    const toMinimap = (wx: number, wy: number) => ({
      x: padding + (wx / worldW) * mapArea,
      y: padding + (wy / worldH) * mapArea,
    });
    
    // Draw food as small cyan dots
    const foods = this.snapshotInterpolation.getInterpolatedFood();
    g.fillStyle(0x44ffcc, 0.5);
    foods.forEach((food) => {
      const pos = toMinimap(food.x, food.y);
      g.fillCircle(pos.x, pos.y, 1.5);
    });
    
    // Draw other players as red dots
    const players = this.snapshotInterpolation.getInterpolatedPlayers();
    players.forEach((player, id) => {
      if (id === this.playerId) return;
      const pos = toMinimap(player.x, player.y);
      g.fillStyle(0xff6666, 0.9);
      g.fillCircle(pos.x, pos.y, 3);
    });
    
    // Draw local player as golden dot (if alive)
    if (this.isAlive && this.lantern) {
      const pos = toMinimap(this.lantern.x, this.lantern.y);
      // Outer glow
      g.fillStyle(0xffcc66, 0.4);
      g.fillCircle(pos.x, pos.y, 6);
      // Inner dot
      g.fillStyle(0xffcc66, 1);
      g.fillCircle(pos.x, pos.y, 4);
    }
    
    // Draw world border indicator
    g.lineStyle(1, 0xff4444, 0.3);
    g.strokeRect(padding, padding, mapArea, mapArea);
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
      
      p.x += p.vx * deltaS;
      p.y += p.vy * deltaS;
      p.vx *= 0.96;
      p.vy *= 0.96;
      p.life -= deltaS * 0.8;
      p.alpha = p.life;
      p.size *= 0.995;
      
      if (p.life <= 0 || p.size < 1) {
        this.deathParticles.splice(i, 1);
        continue;
      }
      
      this.deathParticleGraphics.fillStyle(p.color, p.alpha * 0.6);
      this.deathParticleGraphics.fillCircle(p.x, p.y, p.size * 1.5);
      this.deathParticleGraphics.fillStyle(p.color, p.alpha);
      this.deathParticleGraphics.fillCircle(p.x, p.y, p.size);
    }
  }

  private showDeathOverlay(event: DeathEvent): void {
    this.isAlive = false;
    
    this.lantern.setVisible(false);
    this.clearLocalBodySegments();
    
    // Hide boost button on mobile when dead
    if (this.boostButton) {
      this.boostButton.setVisible(false);
    }
    
    this.deathOverlay = this.add.container(0, 0);
    this.deathOverlay.setScrollFactor(0);
    this.deathOverlay.setDepth(1000);
    
    const dimmer = this.add.rectangle(
      this.cameras.main.width / 2,
      this.cameras.main.height / 2,
      this.cameras.main.width,
      this.cameras.main.height,
      0x000000,
      0.7
    );
    this.deathOverlay.add(dimmer);
    
    const msgY = this.cameras.main.height / 2 - 50;
    
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
    
    const hintLabel = this.add.text(
      this.cameras.main.width / 2,
      msgY + 120,
      this.isMobile ? 'Tap to respawn' : 'Click or Press ENTER to respawn',
      {
        fontSize: '16px',
        color: '#88ffcc',
      }
    );
    hintLabel.setOrigin(0.5);
    this.deathOverlay.add(hintLabel);
    
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
        return event.killerName 
          ? `Crashed into ${event.killerName}'s procession`
          : 'Crashed into another player';
      case 'head_to_head':
        return event.killerName 
          ? `Head-on collision with ${event.killerName}`
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
    
    // Show boost button on mobile
    if (this.boostButton) {
      this.boostButton.setVisible(true);
    }
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
    // Use room code from scene data (if provided)
    const requestedRoom = this.roomCode || null;
    
    this.socket = io(GAME_CONFIG.SERVER_URL, {
      transports: ['websocket'],
      query: requestedRoom ? { room: requestedRoom } : {},
    });
    
    this.socket.on('connected', (state: InitialGameState) => {
      console.log('Connected to server with ID:', state.playerId);
      console.log('Room code:', state.roomCode);
      this.playerId = state.playerId;
      this.roomCode = state.roomCode;
      
      // Update URL with room code (for sharing)
      const newUrl = new URL(window.location.href);
      newUrl.searchParams.set('room', state.roomCode);
      window.history.replaceState({}, '', newUrl.toString());
      
      // Show room code in-game
      this.createRoomCodeUI();
      
      const joinOptions: JoinOptions = {
        name: this.playerName,
      };
      this.socket.emit('joinGame', joinOptions);
      
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
    
    this.socket.on('playerJoined', (playerId: string, playerName: string) => {
      console.log(`Player joined: ${playerName} (${playerId})`);
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
      this.spawnDeathExplosion(event.x, event.y, event.foodDropped);
      
      if (event.playerId === this.playerId) {
        this.showDeathOverlay(event);
      }
    });
    
    this.socket.on('playerRespawned', (playerId: string) => {
      console.log('Player respawned:', playerId);
      
      if (playerId === this.playerId) {
        this.hideDeathOverlay();
        
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

  private getSegmentProgress(index: number, totalSegments: number): number {
    if (totalSegments <= 1) return 0;
    return index / (totalSegments - 1);
  }

  private getSegmentRadius(progress: number): number {
    const { SEGMENT_RADIUS_MAX, SEGMENT_RADIUS_MIN } = GAME_CONFIG.BODY;
    const eased = 1 - Math.pow(progress, 0.7);
    return Phaser.Math.Linear(SEGMENT_RADIUS_MIN, SEGMENT_RADIUS_MAX, eased);
  }

  private getSegmentOpacity(progress: number): number {
    const { OPACITY_MAX, OPACITY_MIN } = GAME_CONFIG.BODY;
    const eased = Math.pow(progress, 0.5);
    return Phaser.Math.Linear(OPACITY_MAX, OPACITY_MIN, eased);
  }

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

  private getWobbleOffset(
    index: number, 
    phaseOffset: number, 
    prevSegment: { x: number; y: number } | null,
    currentSegment: { x: number; y: number }
  ): { x: number; y: number } {
    const { WOBBLE_AMPLITUDE, WOBBLE_SPEED } = GAME_CONFIG.BODY;
    
    let perpX = 0;
    let perpY = 1;
    
    if (prevSegment) {
      const dx = currentSegment.x - prevSegment.x;
      const dy = currentSegment.y - prevSegment.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len > 0.1) {
        perpX = -dy / len;
        perpY = dx / len;
      }
    }
    
    const wobblePhase = this.animTime * WOBBLE_SPEED + phaseOffset + index * 0.8;
    const wobbleAmount = Math.sin(wobblePhase) * WOBBLE_AMPLITUDE;
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
    
    while (this.localBodySegments.length < segments.length) {
      const index = this.localBodySegments.length;
      const phaseOffset = Math.random() * Math.PI * 2;
      
      // Initialize position from server or use head position
      const initX = segments[index]?.x ?? this.lantern.x;
      const initY = segments[index]?.y ?? this.lantern.y;
      
      const glow = this.add.arc(0, 0, 10, 0, 360, false, SPIRIT_GLOW_HEAD, 0.5);
      const core = this.add.arc(0, 0, 5, 0, 360, false, SPIRIT_CORE_HEAD, 1);
      
      glow.setDepth(50 - index);
      core.setDepth(51 - index);
      
      this.localBodySegments.push({ 
        glow, core, phaseOffset, 
        currentX: initX, currentY: initY,
        velX: 0, velY: 0
      });
    }
    
    while (this.localBodySegments.length > segments.length) {
      const removed = this.localBodySegments.pop();
      if (removed) {
        removed.glow.destroy();
        removed.core.destroy();
      }
    }
    
    // First segment follows the head with spring physics
    // Other segments follow the previous segment
    for (let i = 0; i < segments.length; i++) {
      const visual = this.localBodySegments[i];
      
      // Determine what this segment should follow
      let targetX: number;
      let targetY: number;
      
      if (i === 0) {
        // First segment follows the head (lantern)
        targetX = this.lantern.x;
        targetY = this.lantern.y;
      } else {
        // Other segments follow the previous segment's smoothed position
        const prevVisual = this.localBodySegments[i - 1];
        targetX = prevVisual.currentX;
        targetY = prevVisual.currentY;
      }
      
      // Calculate desired distance from target
      const spacing = i === 0 ? 30 : 20; // First segment gap vs normal spacing
      
      // Vector from current to target
      const dx = targetX - visual.currentX;
      const dy = targetY - visual.currentY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      
      if (dist > spacing) {
        // Calculate direction
        const dirX = dx / dist;
        const dirY = dy / dist;
        
        // Move towards target - keep at spacing distance
        // Use stronger smoothing and snap if too far
        const overshoot = dist - spacing;
        const moveSpeed = overshoot > 50 ? 1 : 0.4; // Snap if too far, otherwise smooth
        
        visual.currentX += dirX * overshoot * moveSpeed;
        visual.currentY += dirY * overshoot * moveSpeed;
      } else if (dist < spacing * 0.5) {
        // Too close - push away slightly
        const dirX = dx / dist || 0;
        const dirY = dy / dist || 0;
        visual.currentX -= dirX * (spacing - dist) * 0.2;
        visual.currentY -= dirY * (spacing - dist) * 0.2;
      }
      
      const progress = this.getSegmentProgress(i, segments.length);
      const radius = this.getSegmentRadius(progress);
      const opacity = this.getSegmentOpacity(progress);
      
      // Use smoothed position for wobble calculation
      const smoothedSegment = { x: visual.currentX, y: visual.currentY };
      const smoothedPrev = i > 0 ? { 
        x: this.localBodySegments[i - 1].currentX, 
        y: this.localBodySegments[i - 1].currentY 
      } : null;
      
      const wobble = this.getWobbleOffset(i, visual.phaseOffset, smoothedPrev, smoothedSegment);
      
      const pulsePhase = this.animTime * PULSE_SPEED + visual.phaseOffset;
      const pulse = 1 + Math.sin(pulsePhase) * PULSE_AMOUNT * (1 - progress * 0.5);
      
      const finalX = visual.currentX + wobble.x;
      const finalY = visual.currentY + wobble.y;
      
      visual.glow.setPosition(finalX, finalY);
      visual.core.setPosition(finalX, finalY);
      
      const glowRadius = radius * GLOW_MULTIPLIER * pulse;
      const coreRadius = radius * pulse;
      
      visual.glow.setRadius(glowRadius);
      visual.core.setRadius(coreRadius);
      
      const glowColor = this.lerpColor(SPIRIT_GLOW_HEAD, SPIRIT_GLOW_TAIL, progress);
      const coreColor = this.lerpColor(SPIRIT_CORE_HEAD, SPIRIT_CORE_TAIL, progress);
      
      visual.glow.setFillStyle(glowColor, opacity * 0.5);
      visual.core.setFillStyle(coreColor, opacity);
    }
  }

  // ===========================================================================
  // OTHER PLAYERS (Devil Mask)
  // ===========================================================================

  private updateOtherPlayers(): void {
    const interpolatedPlayers = this.snapshotInterpolation.getInterpolatedPlayers(
      this.playerId || undefined
    );
    
    for (const [id, playerState] of interpolatedPlayers) {
      if (playerState.alive) {
        this.updateOtherPlayerVisual(id, playerState);
      } else {
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
      
      // Glow effect for devil mask (red/orange glow)
      const glow = this.add.image(0, 0, 'devil-mask');
      glow.setScale(1.3);
      glow.setTint(0xff6644); // Red-orange glow
      glow.setAlpha(0.4);
      
      // Main devil mask sprite
      const core = this.add.image(0, 0, 'devil-mask');
      core.setScale(0.75);
      core.setTint(0xffaaaa); // Light red tint
      
      // Player name tag
      const nameText = this.add.text(0, -40, state.name, {
        fontSize: '12px',
        fontFamily: 'Georgia, serif',
        color: '#ffffff',
        backgroundColor: '#00000088',
        padding: { x: 4, y: 2 },
      });
      nameText.setOrigin(0.5);
      
      container.add([glow, core, nameText]);
      
      visual = { container, glow, core, nameText, bodySegments: [] };
      this.otherPlayers.set(id, visual);
    }
    
    visual.container.setPosition(state.x, state.y);
    visual.nameText.setText(state.name);
    
    // Scale devil mask based on body segments (same formula as local player)
    const bodyCount = state.bodySegments.length;
    const sizeMultiplier = 1 + Math.min(bodyCount * 0.03, 0.6);
    visual.glow.setScale(1.3 * sizeMultiplier);
    visual.core.setScale(0.75 * sizeMultiplier);
    
    this.updateOtherPlayerBodySegments(visual, state.bodySegments);
  }

  private updateOtherPlayerBodySegments(visual: RemotePlayerVisual, segments: BodySegment[]): void {
    const { GLOW_MULTIPLIER, PULSE_AMOUNT, PULSE_SPEED } = GAME_CONFIG.BODY;
    const { OTHER_SPIRIT_GLOW_HEAD, OTHER_SPIRIT_GLOW_TAIL, OTHER_SPIRIT_CORE_HEAD, OTHER_SPIRIT_CORE_TAIL } = GAME_CONFIG.COLORS;
    
    while (visual.bodySegments.length < segments.length) {
      const index = visual.bodySegments.length;
      const phaseOffset = Math.random() * Math.PI * 2;
      
      const initX = segments[index]?.x ?? visual.container.x;
      const initY = segments[index]?.y ?? visual.container.y;
      
      const glow = this.add.arc(0, 0, 10, 0, 360, false, OTHER_SPIRIT_GLOW_HEAD, 0.5);
      const core = this.add.arc(0, 0, 5, 0, 360, false, OTHER_SPIRIT_CORE_HEAD, 1);
      
      glow.setDepth(40 - index);
      core.setDepth(41 - index);
      
      visual.bodySegments.push({ 
        glow, core, phaseOffset, 
        currentX: initX, currentY: initY, 
        velX: 0, velY: 0 
      });
    }
    
    while (visual.bodySegments.length > segments.length) {
      const removed = visual.bodySegments.pop();
      if (removed) {
        removed.glow.destroy();
        removed.core.destroy();
      }
    }
    
    // Smooth segment following (same as local player)
    for (let i = 0; i < segments.length; i++) {
      const segVisual = visual.bodySegments[i];
      
      // Determine target
      let targetX: number;
      let targetY: number;
      
      if (i === 0) {
        targetX = visual.container.x;
        targetY = visual.container.y;
      } else {
        const prevVisual = visual.bodySegments[i - 1];
        targetX = prevVisual.currentX;
        targetY = prevVisual.currentY;
      }
      
      const spacing = i === 0 ? 30 : 20;
      
      const dx = targetX - segVisual.currentX;
      const dy = targetY - segVisual.currentY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      
      if (dist > spacing) {
        const dirX = dx / dist;
        const dirY = dy / dist;
        const overshoot = dist - spacing;
        const moveSpeed = overshoot > 50 ? 1 : 0.4;
        
        segVisual.currentX += dirX * overshoot * moveSpeed;
        segVisual.currentY += dirY * overshoot * moveSpeed;
      } else if (dist < spacing * 0.5) {
        const dirX = dx / dist || 0;
        const dirY = dy / dist || 0;
        segVisual.currentX -= dirX * (spacing - dist) * 0.2;
        segVisual.currentY -= dirY * (spacing - dist) * 0.2;
      }
      
      const progress = this.getSegmentProgress(i, segments.length);
      const radius = this.getSegmentRadius(progress);
      const opacity = this.getSegmentOpacity(progress);
      
      const smoothedSegment = { x: segVisual.currentX, y: segVisual.currentY };
      const smoothedPrev = i > 0 ? { 
        x: visual.bodySegments[i - 1].currentX, 
        y: visual.bodySegments[i - 1].currentY 
      } : null;
      
      const wobble = this.getWobbleOffset(i, segVisual.phaseOffset, smoothedPrev, smoothedSegment);
      
      const pulsePhase = this.animTime * PULSE_SPEED + segVisual.phaseOffset;
      const pulse = 1 + Math.sin(pulsePhase) * PULSE_AMOUNT * (1 - progress * 0.5);
      
      const finalX = segVisual.currentX + wobble.x;
      const finalY = segVisual.currentY + wobble.y;
      
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
  // FOOD RENDERING (Ghosts)
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
    
    // Detect golden food (value > base value)
    const isGolden = state.value > 1;
    const sizeMultiplier = isGolden ? 1.3 : 1;
    
    if (!visual) {
      const container = this.add.container(state.x, state.y);
      container.setDepth(isGolden ? 15 : 10); // Golden food renders on top
      
      const phaseOffset = Math.random() * Math.PI * 2;
      
      // Ghost glow
      const glow = this.add.image(0, 0, 'ghost');
      glow.setScale(1.4 * sizeMultiplier);
      glow.setAlpha(isGolden ? 0.5 : 0.35);
      
      // Ghost core
      const core = this.add.image(0, 0, 'ghost');
      core.setScale(0.8 * sizeMultiplier);
      
      // Apply colors based on type
      if (isGolden) {
        glow.setTint(0xffaa00); // Golden orange glow
        core.setTint(0xffdd44); // Bright gold
      } else {
        glow.setTint(0x44ffcc); // Cyan ethereal glow
        core.setTint(0xccffee); // Light cyan
      }
      
      container.add([glow, core]);
      
      visual = { container, glow, core, phaseOffset };
      this.foodVisuals.set(id, visual);
    }
    
    visual.container.setPosition(state.x, state.y);
    
    // Floating animation - golden food floats more dramatically
    const floatSpeed = isGolden ? 3 : 2;
    const floatAmount = isGolden ? 5 : 3;
    const floatPhase = this.animTime * floatSpeed + visual.phaseOffset;
    const floatY = Math.sin(floatPhase) * floatAmount;
    visual.core.setY(floatY);
    visual.glow.setY(floatY);
    
    // Pulse animation - golden food pulses faster and more
    const pulseSpeed = isGolden ? GAME_CONFIG.FOOD.PULSE_SPEED * 1.5 : GAME_CONFIG.FOOD.PULSE_SPEED;
    const pulseAmount = isGolden ? 0.25 : 0.15;
    const pulse = 1 + Math.sin(this.animTime * pulseSpeed + visual.phaseOffset) * pulseAmount;
    visual.core.setScale(0.8 * sizeMultiplier * pulse);
    visual.glow.setScale(1.4 * sizeMultiplier * pulse);
    
    // Glow breathing - golden food glows brighter
    const baseAlpha = isGolden ? 0.4 : 0.25;
    const alphaRange = isGolden ? 0.15 : 0.1;
    visual.glow.setAlpha(baseAlpha + Math.sin(this.animTime * 3 + visual.phaseOffset) * alphaRange);
    
    // Golden food slight rotation shimmer
    if (isGolden) {
      visual.core.setRotation(Math.sin(this.animTime * 2) * 0.1);
    }
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
    
    this.updateOtherPlayers();
    this.updateFood();
    this.updateDeathParticles(delta);
    this.updateScoreboard();
    this.updateMinimap();
    
    if (this.isAlive) {
      this.handleLocalMovement(delta);
      this.sendInputToServer();
    }
    
    this.updateDebug();
  }

  // Store current input for sending to server
  private currentInputX = 0;
  private currentInputY = 0;
  private currentSequence = 0;
  private lastSendTime = 0;
  private readonly SEND_RATE = 50; // Send at 20Hz (every 50ms)

  /**
   * Update touch input from pointer (for mobile)
   */
  private updateTouchInput(pointer: Phaser.Input.Pointer): void {
    const camera = this.cameras.main;
    const centerX = camera.width / 2;
    const centerY = camera.height / 2;
    
    const offsetX = pointer.x - centerX;
    const offsetY = pointer.y - centerY;
    
    this.touchInput.x = Phaser.Math.Clamp(offsetX / centerX, -1, 1);
    this.touchInput.y = Phaser.Math.Clamp(offsetY / centerY, -1, 1);
  }

  private handleLocalMovement(delta: number): void {
    this.updateKeyboardInput();
    
    // Read input - priority: keyboard > touch (mobile) > mouse (desktop)
    if (this.keyboardInput.active) {
      this.currentInputX = this.keyboardInput.x;
      this.currentInputY = this.keyboardInput.y;
    } else if (this.isMobile && this.touchInput.active) {
      // Mobile: use tracked touch position
      this.currentInputX = this.touchInput.x;
      this.currentInputY = this.touchInput.y;
    } else if (!this.isMobile) {
      // Desktop: use current mouse position
      const pointer = this.input.activePointer;
      const camera = this.cameras.main;
      
      const centerX = camera.width / 2;
      const centerY = camera.height / 2;
      
      const mouseOffsetX = pointer.x - centerX;
      const mouseOffsetY = pointer.y - centerY;
      
      this.currentInputX = Phaser.Math.Clamp(mouseOffsetX / centerX, -1, 1);
      this.currentInputY = Phaser.Math.Clamp(mouseOffsetY / centerY, -1, 1);
    }
    
    // Update display position (smoothly follows server)
    const predicted = this.clientPrediction.processInput(
      this.currentInputX,
      this.currentInputY,
      this.isBoosting,
      delta,
      0 // sequence not used for display
    );
    
    this.lantern.setPosition(predicted.x, predicted.y);
    
    // Size scaling based on body segments (more food = bigger lantern)
    // +3% per segment, max +60% at 20+ segments
    const bodyCount = this.localBodySegments.length;
    const sizeMultiplier = 1 + Math.min(bodyCount * 0.03, 0.6);
    
    // Boost visual feedback
    const boostPulse = this.isBoosting ? 1 + Math.sin(this.animTime * 8) * 0.1 : 1;
    
    if (this.isBoosting) {
      this.lanternGlow.setScale(1.6 * sizeMultiplier * boostPulse);
      this.lanternGlow.setAlpha(0.6);
      this.lanternGlow.setTint(0xffaa44); // Brighter orange when boosting
    } else {
      this.lanternGlow.setScale(1.4 * sizeMultiplier);
      this.lanternGlow.setAlpha(0.4);
      this.lanternGlow.setTint(0xffcc66);
    }
    
    // Scale core sprite as well
    this.lanternCore.setScale(0.8 * sizeMultiplier);
    
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
      this.lanternCore.setTint(this.lerpColor(0xffeedd, 0xff6666, warningPulse));
    } else {
      this.lanternCore.setTint(0xffeedd);
    }
  }

  private sendInputToServer(): void {
    if (!this.socket.connected || !this.isAlive) return;
    
    // Throttle: only send at 20Hz to match server tick rate
    const now = performance.now();
    if (now - this.lastSendTime < this.SEND_RATE) return;
    this.lastSendTime = now;
    
    // Increment sequence only when actually sending
    this.currentSequence = this.clientPrediction.getNextSequence();
    
    const input: PlayerInput = {
      sequence: this.currentSequence,
      mouseX: this.currentInputX,
      mouseY: this.currentInputY,
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
      `Phase 5: Juice & Polish`,
      `Player: ${this.playerName}`,
      `RTT: ${rtt}ms`,
      `Position: (${pos.x.toFixed(0)}, ${pos.y.toFixed(0)})`,
      `Input: ${inputMode}`,
      `Alive: ${this.isAlive}`,
      `Body Segments: ${this.localBodySegments.length}`,
      `Score: ${latestState?.score ?? 0}`,
      `Kills: ${latestState?.kills ?? 0}`,
      `Other Players: ${this.otherPlayers.size}`,
      `[F3 debug] [ESC menu]`,
    ].join('\n'));
  }

  shutdown(): void {
    if (this.timeSyncInterval) {
      clearInterval(this.timeSyncInterval);
    }
    this.socket?.disconnect();
  }
}
