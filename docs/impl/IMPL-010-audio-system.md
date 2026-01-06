# IMPL-010: Audio System

> Sound effects and ambient audio for engagement

**Priority:** 🟢 MEDIUM  
**Effort:** 2 days  
**Impact:** Significantly improves game feel and engagement

---

## Problem

The game is completely silent:
- No feedback for collecting food
- No satisfaction sound for kills
- No warning sounds for danger
- No ambient atmosphere

Silent games feel unfinished and less engaging.

---

## Solution

Add layered audio:
1. **Sound Effects** - Collection, death, boost
2. **Spatial Audio** - Volume based on distance
3. **Ambient Background** - Ethereal water sounds
4. **Music Toggle** - User control

---

## Audio Assets Needed

| File | Duration | Size | Purpose |
|------|----------|------|---------|
| `collect.mp3` | ~200ms | ~5KB | Normal food collection |
| `collect-gold.mp3` | ~300ms | ~8KB | Golden food (brighter tone) |
| `boost.mp3` | ~150ms | ~5KB | Boost activation |
| `death.mp3` | ~500ms | ~10KB | Player death |
| `kill.mp3` | ~400ms | ~8KB | You killed someone |
| `warning.mp3` | ~200ms | ~5KB | Near collision |
| `ambient.mp3` | ~30s loop | ~200KB | Background river ambience |

**Total:** ~240KB (acceptable for web game)

---

## Implementation Guide

### Step 1: Create AudioManager

Create `client/src/audio/AudioManager.ts`:

```typescript
import Phaser from 'phaser';

interface SoundConfig {
  key: string;
  volume: number;
  variations?: number; // Number of pitch variations
  spatial?: boolean;   // Use distance-based volume
}

export class AudioManager {
  private scene: Phaser.Scene;
  private sounds: Map<string, Phaser.Sound.BaseSound[]> = new Map();
  
  // Volume settings
  private masterVolume = 1.0;
  private sfxVolume = 0.7;
  private musicVolume = 0.3;
  private enabled = true;
  
  // Ambient music
  private ambient: Phaser.Sound.BaseSound | null = null;
  
  // Cooldowns to prevent sound spam
  private lastPlayTime: Map<string, number> = new Map();
  private cooldowns: Map<string, number> = new Map([
    ['collect', 50],      // 50ms between collect sounds
    ['warning', 200],     // 200ms between warnings
    ['boost', 100],
  ]);
  
  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.loadSettings();
  }
  
  /**
   * Preload audio assets
   * Call in scene preload()
   */
  preload(): void {
    this.scene.load.audio('collect', '/audio/collect.mp3');
    this.scene.load.audio('collect-gold', '/audio/collect-gold.mp3');
    this.scene.load.audio('boost', '/audio/boost.mp3');
    this.scene.load.audio('death', '/audio/death.mp3');
    this.scene.load.audio('kill', '/audio/kill.mp3');
    this.scene.load.audio('warning', '/audio/warning.mp3');
    this.scene.load.audio('ambient', '/audio/ambient.mp3');
  }
  
  /**
   * Initialize sounds after preload
   * Call in scene create()
   */
  create(): void {
    // Create sound instances
    this.createSound('collect', 5);      // 5 instances for rapid collection
    this.createSound('collect-gold', 3);
    this.createSound('boost', 2);
    this.createSound('death', 2);
    this.createSound('kill', 2);
    this.createSound('warning', 3);
    
    // Start ambient if enabled
    if (this.enabled && this.musicVolume > 0) {
      this.startAmbient();
    }
  }
  
  private createSound(key: string, instances: number): void {
    const sounds: Phaser.Sound.BaseSound[] = [];
    
    for (let i = 0; i < instances; i++) {
      const sound = this.scene.sound.add(key, {
        volume: this.sfxVolume * this.masterVolume,
      });
      sounds.push(sound);
    }
    
    this.sounds.set(key, sounds);
  }
  
  /**
   * Play a sound effect
   */
  play(key: string, options?: { volume?: number; rate?: number }): void {
    if (!this.enabled) return;
    
    // Check cooldown
    const now = Date.now();
    const lastPlayed = this.lastPlayTime.get(key) || 0;
    const cooldown = this.cooldowns.get(key) || 0;
    
    if (now - lastPlayed < cooldown) return;
    this.lastPlayTime.set(key, now);
    
    // Find available sound instance
    const instances = this.sounds.get(key);
    if (!instances || instances.length === 0) return;
    
    const sound = instances.find(s => !s.isPlaying) || instances[0];
    
    // Apply options
    const config: Phaser.Types.Sound.SoundConfig = {
      volume: (options?.volume ?? 1) * this.sfxVolume * this.masterVolume,
      rate: options?.rate ?? 1,
    };
    
    sound.play(config);
  }
  
  /**
   * Play sound with spatial (distance-based) volume
   */
  playSpatial(
    key: string,
    x: number,
    y: number,
    listenerX: number,
    listenerY: number,
    maxDistance: number = 800
  ): void {
    if (!this.enabled) return;
    
    const dx = x - listenerX;
    const dy = y - listenerY;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    if (distance > maxDistance) return;
    
    // Volume falloff
    const distanceVolume = 1 - (distance / maxDistance);
    const volume = Math.pow(distanceVolume, 1.5); // Exponential falloff
    
    // Optional: Stereo panning
    const pan = Math.max(-1, Math.min(1, dx / (maxDistance * 0.5)));
    
    this.play(key, { volume });
  }
  
  /**
   * Convenience methods for specific sounds
   */
  playCollect(isGolden: boolean): void {
    const key = isGolden ? 'collect-gold' : 'collect';
    const rate = 0.9 + Math.random() * 0.2; // Slight pitch variation
    this.play(key, { rate });
  }
  
  playDeath(): void {
    this.play('death', { volume: 1.2 });
  }
  
  playKill(): void {
    this.play('kill', { volume: 1.0 });
  }
  
  playBoost(): void {
    const rate = 0.95 + Math.random() * 0.1;
    this.play('boost', { rate });
  }
  
  playWarning(urgency: number = 1): void {
    this.play('warning', { volume: urgency, rate: 1 + urgency * 0.2 });
  }
  
  /**
   * Ambient music control
   */
  startAmbient(): void {
    if (this.ambient?.isPlaying) return;
    
    this.ambient = this.scene.sound.add('ambient', {
      loop: true,
      volume: this.musicVolume * this.masterVolume,
    });
    
    this.ambient.play();
  }
  
  stopAmbient(): void {
    if (this.ambient?.isPlaying) {
      this.ambient.stop();
    }
  }
  
  /**
   * Volume controls
   */
  setMasterVolume(volume: number): void {
    this.masterVolume = Math.max(0, Math.min(1, volume));
    this.updateAllVolumes();
    this.saveSettings();
  }
  
  setSfxVolume(volume: number): void {
    this.sfxVolume = Math.max(0, Math.min(1, volume));
    this.updateAllVolumes();
    this.saveSettings();
  }
  
  setMusicVolume(volume: number): void {
    this.musicVolume = Math.max(0, Math.min(1, volume));
    if (this.ambient) {
      (this.ambient as any).volume = this.musicVolume * this.masterVolume;
    }
    this.saveSettings();
  }
  
  private updateAllVolumes(): void {
    for (const instances of this.sounds.values()) {
      for (const sound of instances) {
        (sound as any).volume = this.sfxVolume * this.masterVolume;
      }
    }
  }
  
  /**
   * Enable/disable all audio
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    
    if (!enabled) {
      this.stopAmbient();
      // Stop all playing sounds
      for (const instances of this.sounds.values()) {
        for (const sound of instances) {
          if (sound.isPlaying) sound.stop();
        }
      }
    } else if (this.musicVolume > 0) {
      this.startAmbient();
    }
    
    this.saveSettings();
  }
  
  isEnabled(): boolean {
    return this.enabled;
  }
  
  /**
   * Persist settings
   */
  private saveSettings(): void {
    localStorage.setItem('toro-audio', JSON.stringify({
      enabled: this.enabled,
      masterVolume: this.masterVolume,
      sfxVolume: this.sfxVolume,
      musicVolume: this.musicVolume,
    }));
  }
  
  private loadSettings(): void {
    try {
      const saved = localStorage.getItem('toro-audio');
      if (saved) {
        const settings = JSON.parse(saved);
        this.enabled = settings.enabled ?? true;
        this.masterVolume = settings.masterVolume ?? 1.0;
        this.sfxVolume = settings.sfxVolume ?? 0.7;
        this.musicVolume = settings.musicVolume ?? 0.3;
      }
    } catch {
      // Use defaults
    }
  }
}
```

### Step 2: Integrate into GameScene

```typescript
import { AudioManager } from '../audio/AudioManager';

class GameScene extends Phaser.Scene {
  private audio!: AudioManager;
  
  preload(): void {
    // ... existing preloads ...
    
    // Preload audio
    this.audio = new AudioManager(this);
    this.audio.preload();
  }
  
  create(): void {
    // ... existing code ...
    
    // Initialize audio
    this.audio.create();
    
    // Listen for game events
    this.socket.on('foodCollected', (foodId: string, playerId: string) => {
      if (playerId === this.playerId) {
        const food = this.getFoodById(foodId);
        if (food) {
          this.audio.playCollect(food.value > 1);
        }
      }
    });
    
    this.socket.on('playerDied', (event: DeathEvent) => {
      const isLocalPlayer = event.playerId === this.playerId;
      const isLocalKiller = event.killerId === this.playerId;
      
      if (isLocalPlayer) {
        this.audio.playDeath();
      } else if (isLocalKiller) {
        this.audio.playKill();
      } else {
        // Spatial death sound for nearby players
        this.audio.playSpatial(
          'death',
          event.x,
          event.y,
          this.localPlayer?.x || 0,
          this.localPlayer?.y || 0,
          600
        );
      }
    });
  }
  
  update(time: number, delta: number): void {
    // ... existing code ...
    
    // Play boost sound when starting boost
    if (this.isBoosting && !this.wasBoostingLastFrame) {
      this.audio.playBoost();
    }
    this.wasBoostingLastFrame = this.isBoosting;
  }
}
```

### Step 3: Create Audio Files (Or Use Placeholder)

If you don't have audio files yet, you can use Web Audio API to generate placeholder sounds:

```typescript
// Placeholder sound generator (for development)
function generateTone(frequency: number, duration: number, type: OscillatorType = 'sine'): string {
  const audioContext = new AudioContext();
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, audioContext.currentTime);
  
  gain.gain.setValueAtTime(0.5, audioContext.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + duration);
  
  oscillator.connect(gain);
  gain.connect(audioContext.destination);
  
  oscillator.start();
  oscillator.stop(audioContext.currentTime + duration);
  
  // This is just for testing - in production use actual audio files
  return '';
}
```

### Step 4: Add Audio Toggle UI

```typescript
// Simple mute button
createAudioToggle(): void {
  const button = this.add.text(
    this.cameras.main.width - 50,
    10,
    this.audio.isEnabled() ? '🔊' : '🔇',
    { fontSize: '24px' }
  );
  
  button.setScrollFactor(0);
  button.setDepth(1000);
  button.setInteractive();
  
  button.on('pointerdown', () => {
    this.audio.setEnabled(!this.audio.isEnabled());
    button.setText(this.audio.isEnabled() ? '🔊' : '🔇');
  });
}
```

---

## Mobile Considerations

- Start audio after first user interaction (browser requirement)
- Use short, compressed audio files
- Test on mobile Safari (most restrictive)

```typescript
// Unlock audio on first touch
create(): void {
  this.input.once('pointerdown', () => {
    if (this.sound.locked) {
      this.sound.unlock();
    }
    this.audio.startAmbient();
  });
}
```

---

## Testing Checklist

- [ ] Collection sound plays when eating food
- [ ] Golden food has distinct sound
- [ ] Death sound plays on your death
- [ ] Kill sound plays when you kill someone
- [ ] Distant sounds are quieter (spatial audio)
- [ ] Ambient music loops seamlessly
- [ ] Mute button works
- [ ] Settings persist across sessions
- [ ] Audio works on mobile (after touch)
- [ ] No audio glitches or stuttering

---

## AI Implementation Prompt

```
Implement audio system for Tōrō following docs/impl/IMPL-010-audio-system.md.

Current state:
- No audio system exists
- Game is completely silent

Tasks:
1. Create AudioManager class with pooled sound instances
2. Add preload and create methods for audio assets
3. Implement play, playSpatial, and convenience methods
4. Integrate into GameScene with socket events
5. Add ambient music with loop
6. Add mute toggle UI
7. Persist audio settings to localStorage
8. Handle mobile audio unlock

Note: Audio files may not exist yet. Set up the system to work with them when added.
The system should gracefully handle missing audio files.
```


