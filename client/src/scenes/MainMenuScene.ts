import Phaser from 'phaser';

/**
 * Main Menu Scene - Name selection before joining the game
 * 
 * Features a dark, ethereal aesthetic matching the game's theme
 */
export class MainMenuScene extends Phaser.Scene {
  private nameInput!: HTMLInputElement;
  private roomCodeInput!: HTMLInputElement;
  private playButton?: Phaser.GameObjects.Container;
  private floatingOrbs: Array<{
    x: number;
    y: number;
    vx: number;
    vy: number;
    size: number;
    alpha: number;
    color: number;
  }> = [];
  private orbGraphics!: Phaser.GameObjects.Graphics;
  private animTime = 0;

  constructor() {
    super({ key: 'MainMenuScene' });
  }

  create(): void {
    this.createBackground();
    this.createFloatingOrbs();
    this.createTitle();
    this.createNameInput();
    this.createRoomCodeInput();
    this.createPlayButton();
    this.createFooter();
  }

  private createBackground(): void {
    const { width, height } = this.cameras.main;
    
    // Dark gradient background using graphics
    const bg = this.add.graphics();
    
    // Create a radial gradient effect with concentric circles
    const centerX = width / 2;
    const centerY = height / 2;
    const maxRadius = Math.max(width, height);
    
    // Draw from outside in for proper layering
    for (let i = 20; i >= 0; i--) {
      const t = i / 20;
      const radius = maxRadius * t;
      
      // Interpolate between deep purple/blue and dark center
      const r = Math.floor(Phaser.Math.Linear(5, 15, t));
      const g = Math.floor(Phaser.Math.Linear(5, 10, t));
      const b = Math.floor(Phaser.Math.Linear(12, 25, t));
      
      const color = (r << 16) | (g << 8) | b;
      bg.fillStyle(color, 1);
      bg.fillCircle(centerX, centerY, radius);
    }
    
    // Subtle grid pattern
    const gridGraphics = this.add.graphics();
    gridGraphics.lineStyle(1, 0x1a1a2e, 0.15);
    
    const gridSize = 60;
    for (let x = 0; x <= width; x += gridSize) {
      gridGraphics.moveTo(x, 0);
      gridGraphics.lineTo(x, height);
    }
    for (let y = 0; y <= height; y += gridSize) {
      gridGraphics.moveTo(0, y);
      gridGraphics.lineTo(width, y);
    }
    gridGraphics.strokePath();
    
    // Vignette overlay
    const vignette = this.add.graphics();
    for (let i = 0; i < 15; i++) {
      const t = i / 15;
      const innerRadius = maxRadius * (0.5 + t * 0.5);
      const alpha = t * 0.4;
      
      vignette.fillStyle(0x000000, alpha);
      vignette.fillCircle(centerX, centerY, innerRadius);
    }
  }

  private createFloatingOrbs(): void {
    this.orbGraphics = this.add.graphics();
    this.orbGraphics.setDepth(5);
    
    const { width, height } = this.cameras.main;
    
    // Create ambient floating orbs
    for (let i = 0; i < 25; i++) {
      this.floatingOrbs.push({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 20,
        vy: (Math.random() - 0.5) * 20,
        size: 2 + Math.random() * 6,
        alpha: 0.2 + Math.random() * 0.4,
        color: Math.random() > 0.5 ? 0x44ffcc : 0xffcc66,
      });
    }
  }

  private createTitle(): void {
    const { width } = this.cameras.main;
    const centerX = width / 2;
    
    // Main title with glow effect (using multiple text layers)
    const titleGlow = this.add.text(centerX, 120, '灯籠', {
      fontSize: '72px',
      fontFamily: 'serif',
      color: '#44ffcc',
    });
    titleGlow.setOrigin(0.5);
    titleGlow.setAlpha(0.3);
    titleGlow.setDepth(10);
    
    const title = this.add.text(centerX, 120, '灯籠', {
      fontSize: '72px',
      fontFamily: 'serif',
      color: '#88ffee',
    });
    title.setOrigin(0.5);
    title.setDepth(11);
    
    // Animate title glow
    this.tweens.add({
      targets: titleGlow,
      alpha: { from: 0.2, to: 0.5 },
      scaleX: { from: 1, to: 1.05 },
      scaleY: { from: 1, to: 1.05 },
      duration: 2000,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
    
    // Subtitle
    const subtitle = this.add.text(centerX, 195, 'T Ō R Ō', {
      fontSize: '28px',
      fontFamily: 'Georgia, serif',
      color: '#aaddff',
      letterSpacing: 12,
    });
    subtitle.setOrigin(0.5);
    subtitle.setDepth(10);
    
    // Tagline
    const tagline = this.add.text(centerX, 235, 'The River of Souls', {
      fontSize: '16px',
      fontFamily: 'Georgia, serif',
      color: '#667788',
      fontStyle: 'italic',
    });
    tagline.setOrigin(0.5);
    tagline.setDepth(10);
  }

  private createNameInput(): void {
    const { width, height } = this.cameras.main;
    const centerX = width / 2;
    const inputY = height / 2 - 20;
    
    // Label
    const label = this.add.text(centerX, inputY - 50, 'Enter your name', {
      fontSize: '18px',
      fontFamily: 'Georgia, serif',
      color: '#aabbcc',
    });
    label.setOrigin(0.5);
    label.setDepth(10);
    
    // Create HTML input element for better text input experience
    this.nameInput = document.createElement('input');
    this.nameInput.type = 'text';
    this.nameInput.maxLength = 16;
    this.nameInput.placeholder = 'Hitodama';
    this.nameInput.value = '';
    
    // Style the input
    Object.assign(this.nameInput.style, {
      position: 'absolute',
      left: `${centerX - 140}px`,
      top: `${inputY}px`,
      width: '280px',
      height: '48px',
      padding: '0 16px',
      fontSize: '20px',
      fontFamily: 'Georgia, serif',
      color: '#ddeeff',
      backgroundColor: 'rgba(10, 15, 25, 0.9)',
      border: '2px solid rgba(68, 255, 204, 0.4)',
      borderRadius: '8px',
      outline: 'none',
      textAlign: 'center',
      transition: 'border-color 0.3s, box-shadow 0.3s',
    });
    
    // Focus/blur effects
    this.nameInput.addEventListener('focus', () => {
      this.nameInput.style.borderColor = 'rgba(68, 255, 204, 0.8)';
      this.nameInput.style.boxShadow = '0 0 20px rgba(68, 255, 204, 0.3)';
    });
    
    this.nameInput.addEventListener('blur', () => {
      this.nameInput.style.borderColor = 'rgba(68, 255, 204, 0.4)';
      this.nameInput.style.boxShadow = 'none';
    });
    
    // Enter key to start game
    this.nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        this.startGame();
      }
    });
    
    
    document.body.appendChild(this.nameInput);
    
    // Focus input after a short delay
    this.time.delayedCall(300, () => {
      this.nameInput.focus();
    });
  }
  
  private createRoomCodeInput(): void {
    const { width, height } = this.cameras.main;
    const centerX = width / 2;
    const inputY = height / 2 + 50;
    
    // Subtle label above input
    const label = this.add.text(centerX, inputY - 12, 'Join a friend?', {
      fontSize: '11px',
      fontFamily: 'Georgia, serif',
      color: '#667788',
    });
    label.setOrigin(0.5);
    label.setDepth(10);
    
    // Create HTML input element
    this.roomCodeInput = document.createElement('input');
    this.roomCodeInput.type = 'text';
    this.roomCodeInput.maxLength = 10;
    this.roomCodeInput.placeholder = 'ROOM-00';
    this.roomCodeInput.value = '';
    
    // Check URL for room code
    const urlParams = new URLSearchParams(window.location.search);
    const urlRoom = urlParams.get('room');
    if (urlRoom) {
      this.roomCodeInput.value = urlRoom;
    }
    
    // Compact, elegant input style
    Object.assign(this.roomCodeInput.style, {
      position: 'absolute',
      left: `${centerX - 60}px`,
      top: `${inputY}px`,
      width: '120px',
      height: '32px',
      padding: '0 10px',
      fontSize: '13px',
      fontFamily: 'monospace',
      color: '#88ddbb',
      backgroundColor: 'rgba(10, 20, 30, 0.5)',
      border: '1px solid rgba(68, 255, 204, 0.2)',
      borderRadius: '4px',
      outline: 'none',
      textAlign: 'center',
      textTransform: 'uppercase',
      letterSpacing: '1px',
      transition: 'all 0.2s ease',
    });
    
    // Focus/blur effects
    this.roomCodeInput.addEventListener('focus', () => {
      this.roomCodeInput.style.borderColor = 'rgba(68, 255, 204, 0.5)';
      this.roomCodeInput.style.backgroundColor = 'rgba(10, 20, 30, 0.7)';
      this.roomCodeInput.style.boxShadow = '0 0 10px rgba(68, 255, 204, 0.15)';
    });
    
    this.roomCodeInput.addEventListener('blur', () => {
      this.roomCodeInput.style.borderColor = 'rgba(68, 255, 204, 0.2)';
      this.roomCodeInput.style.backgroundColor = 'rgba(10, 20, 30, 0.5)';
      this.roomCodeInput.style.boxShadow = 'none';
    });
    
    // Enter key to start game
    this.roomCodeInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        this.startGame();
      }
    });
    
    document.body.appendChild(this.roomCodeInput);
  }

  private createPlayButton(): void {
    const { width, height } = this.cameras.main;
    const centerX = width / 2;
    const buttonY = height / 2 + 145;
    
    this.playButton = this.add.container(centerX, buttonY);
    this.playButton.setDepth(20);
    
    // Button background with glow
    const buttonGlow = this.add.graphics();
    buttonGlow.fillStyle(0x44ffcc, 0.15);
    buttonGlow.fillRoundedRect(-110, -30, 220, 60, 30);
    
    const buttonBg = this.add.graphics();
    buttonBg.fillStyle(0x0a1520, 0.9);
    buttonBg.fillRoundedRect(-100, -25, 200, 50, 25);
    buttonBg.lineStyle(2, 0x44ffcc, 0.6);
    buttonBg.strokeRoundedRect(-100, -25, 200, 50, 25);
    
    // Button text
    const buttonText = this.add.text(0, 0, '🏮  BEGIN JOURNEY  🏮', {
      fontSize: '16px',
      fontFamily: 'Georgia, serif',
      color: '#88ffee',
    });
    buttonText.setOrigin(0.5);
    
    this.playButton.add([buttonGlow, buttonBg, buttonText]);
    
    // Make interactive
    const hitArea = this.add.rectangle(0, 0, 220, 60, 0x000000, 0);
    hitArea.setInteractive({ useHandCursor: true });
    this.playButton.add(hitArea);
    
    hitArea.on('pointerover', () => {
      this.tweens.add({
        targets: this.playButton,
        scaleX: 1.05,
        scaleY: 1.05,
        duration: 150,
      });
      buttonGlow.clear();
      buttonGlow.fillStyle(0x44ffcc, 0.25);
      buttonGlow.fillRoundedRect(-115, -35, 230, 70, 35);
    });
    
    hitArea.on('pointerout', () => {
      this.tweens.add({
        targets: this.playButton,
        scaleX: 1,
        scaleY: 1,
        duration: 150,
      });
      buttonGlow.clear();
      buttonGlow.fillStyle(0x44ffcc, 0.15);
      buttonGlow.fillRoundedRect(-110, -30, 220, 60, 30);
    });
    
    hitArea.on('pointerdown', () => {
      this.startGame();
    });
    
    // Subtle float animation
    this.tweens.add({
      targets: this.playButton,
      y: buttonY - 5,
      duration: 2000,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
  }

  private createFooter(): void {
    const { width, height } = this.cameras.main;
    
    // Controls hint
    const controls = this.add.text(width / 2, height - 80, 
      'WASD / Arrow Keys / Mouse to move  •  Space / Click to boost', {
      fontSize: '13px',
      fontFamily: 'Georgia, serif',
      color: '#556677',
    });
    controls.setOrigin(0.5);
    controls.setDepth(10);
    
    // Version / Phase
    const version = this.add.text(width / 2, height - 50,
      'Developed by Hamake Technologies LTDA • 2026', {
      fontSize: '11px',
      fontFamily: 'Georgia, serif',
      color: '#445566',
    });
    version.setOrigin(0.5);
    version.setDepth(10);
  }

  private startGame(): void {
    // Get values
    const name = this.nameInput.value.trim() || 'Hiro';
    const roomCode = this.roomCodeInput.value.trim().toUpperCase();
    
    // Clean up HTML inputs
    this.nameInput.remove();
    this.roomCodeInput.remove();
    
    // Transition to game scene with room code
    this.cameras.main.fadeOut(500, 0, 0, 0);
    
    this.time.delayedCall(500, () => {
      this.scene.start('GameScene', { playerName: name, roomCode: roomCode || undefined });
    });
  }

  update(time: number, delta: number): void {
    this.animTime = time / 1000;
    this.updateFloatingOrbs(delta);
  }

  private updateFloatingOrbs(delta: number): void {
    const deltaS = delta / 1000;
    const { width, height } = this.cameras.main;
    
    this.orbGraphics.clear();
    
    for (const orb of this.floatingOrbs) {
      // Update position
      orb.x += orb.vx * deltaS;
      orb.y += orb.vy * deltaS;
      
      // Wrap around screen
      if (orb.x < -20) orb.x = width + 20;
      if (orb.x > width + 20) orb.x = -20;
      if (orb.y < -20) orb.y = height + 20;
      if (orb.y > height + 20) orb.y = -20;
      
      // Pulsing alpha
      const pulse = Math.sin(this.animTime * 2 + orb.x * 0.01) * 0.15;
      const alpha = orb.alpha + pulse;
      
      // Draw outer glow
      this.orbGraphics.fillStyle(orb.color, alpha * 0.3);
      this.orbGraphics.fillCircle(orb.x, orb.y, orb.size * 2);
      
      // Draw core
      this.orbGraphics.fillStyle(orb.color, alpha);
      this.orbGraphics.fillCircle(orb.x, orb.y, orb.size);
    }
  }

  shutdown(): void {
    // Clean up HTML input if scene is stopped
    if (this.nameInput && this.nameInput.parentNode) {
      this.nameInput.remove();
    }
  }
}
