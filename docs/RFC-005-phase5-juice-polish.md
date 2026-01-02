# RFC-005: Phase 5 - Juice & Polish

## Overview

This document details the implementation of Phase 5 - Juice & Polish for Tōrō (The River of Souls). This phase adds visual polish, player identity (names), a main menu scene, and post-processing bloom effects.

## Status: ✅ Complete

## Implementation Summary

### 1. Main Menu Scene

A beautiful, atmospheric main menu that matches the game's ethereal Japanese folklore theme.

#### Visual Design
- **Background**: Radial gradient from deep purple-blue to dark center
- **Grid overlay**: Subtle 60px grid with low opacity
- **Vignette**: Soft darkening at edges for depth
- **Floating orbs**: 25 ambient particles that drift and pulse

```typescript
// Floating orb structure
private floatingOrbs: Array<{
  x: number;
  y: number;
  vx: number;        // Drift velocity
  vy: number;
  size: number;      // 2-8px
  alpha: number;     // 0.2-0.6
  color: number;     // Cyan or gold
}>;
```

#### Title Section
- Japanese kanji "灯籠" (Tōrō) with animated glow effect
- Romanized subtitle "T Ō R Ō" with letter spacing
- Tagline: "The River of Souls" in italics

```typescript
// Title glow animation
this.tweens.add({
  targets: titleGlow,
  alpha: { from: 0.2, to: 0.5 },
  scaleX: { from: 1, to: 1.05 },
  scaleY: { from: 1, to: 1.05 },
  duration: 2000,
  yoyo: true,
  repeat: -1,
});
```

#### Name Input
- HTML `<input>` element for smooth text entry
- 16 character limit
- Styled to match game aesthetic (dark background, cyan border)
- Focus effects with glow shadow
- Enter key starts game
- Placeholder: "Wandering Soul"

```typescript
// Input styling
Object.assign(this.nameInput.style, {
  backgroundColor: 'rgba(10, 15, 25, 0.9)',
  border: '2px solid rgba(68, 255, 204, 0.4)',
  borderRadius: '8px',
  textAlign: 'center',
  // ... focus transitions
});
```

#### Play Button
- Rounded container with glow halo
- Hover effect: scale up + intensified glow
- Float animation (subtle up/down)
- Lantern emoji decorations: "🏮 BEGIN JOURNEY 🏮"

### 2. Player Names System

Full player identity system from menu through gameplay.

#### Shared Types Updates

```typescript
// PlayerState - added name
interface PlayerState {
  id: string;
  name: string;      // NEW: Display name
  // ... other fields
}

// ScoreboardEntry - added name
interface ScoreboardEntry {
  id: string;
  name: string;      // NEW: Display name
  score: number;
  kills: number;
  bodyLength: number;
}

// DeathEvent - added killer name
interface DeathEvent {
  // ... existing fields
  killerName?: string;  // NEW: For death message
}

// JoinOptions - new type
interface JoinOptions {
  name: string;
}
```

#### Server-Side Implementation

Players now join in two stages:
1. **Connect**: Player socket connects, server creates player entity
2. **Join**: Player sends `joinGame` with their name, becomes visible to others

```typescript
// Player state extension
interface ServerPlayerState extends PlayerState {
  // ... existing fields
  hasJoined: boolean;  // NEW: Only show players who joined
}

// Connection handler
socket.on('joinGame', (options: JoinOptions) => {
  const player = players.get(playerId);
  if (player && !player.hasJoined) {
    player.name = sanitizeName(options.name);
    player.hasJoined = true;
    socket.broadcast.emit('playerJoined', playerId, player.name);
  }
});

// Game snapshot only includes joined players
function buildGameSnapshot(): GameSnapshot {
  for (const [id, player] of players) {
    if (!player.hasJoined) continue;  // Filter un-joined
    // ... include in snapshot
  }
}
```

#### Client-Side Integration

**Scene data passing:**
```typescript
// MainMenuScene -> GameScene
this.scene.start('GameScene', { playerName: name });

// GameScene receives
init(data: SceneData): void {
  this.playerName = data?.playerName || 'Wandering Soul';
}

// Join on connect
this.socket.on('connected', (state) => {
  this.socket.emit('joinGame', { name: this.playerName });
});
```

**Other player name tags:**
```typescript
// Name text above other players' lanterns
const nameText = this.add.text(0, -35, state.name, {
  fontSize: '12px',
  fontFamily: 'Georgia, serif',
  color: '#ffffff',
  backgroundColor: '#00000088',
  padding: { x: 4, y: 2 },
});
nameText.setOrigin(0.5);
container.add([glow, core, nameText]);
```

**Scoreboard with names:**
```typescript
// Updated scoreboard display
const displayName = data.name.substring(0, 12);
entry.setText(`${medal} ${rank}. ${displayName} - ${data.score}`);
```

**Death messages with names:**
```typescript
// Shows killer's name instead of ID
case 'head_collision':
  return event.killerName 
    ? `Crashed into ${event.killerName}'s procession`
    : 'Crashed into another player';
```

### 3. Bloom Post-Processing Pipeline

WebGL shader-based bloom effect for enhanced visual polish.

#### Shader Implementation

```glsl
// Bloom fragment shader
precision mediump float;

uniform sampler2D uMainSampler;
uniform vec2 uResolution;
uniform float uBloomIntensity;   // 0.6 default
uniform float uBloomThreshold;   // 0.35 default
uniform float uBlurSize;         // 2.0 default

// 9-tap Gaussian blur
vec3 blur9(sampler2D image, vec2 uv, vec2 resolution, vec2 direction) {
    vec3 color = vec3(0.0);
    // Gaussian weights for smooth blur
    color += texture2D(image, uv).rgb * 0.2270270270;
    // ... offset samples with weights
    return color;
}

void main() {
    vec4 originalColor = texture2D(uMainSampler, outTexCoord);
    
    // Extract bright pixels
    float luminance = dot(originalColor.rgb, vec3(0.299, 0.587, 0.114));
    float bloomMask = smoothstep(uBloomThreshold, uBloomThreshold + 0.2, luminance);
    
    // Blur bright parts (horizontal + vertical)
    vec3 blurred = (blur9(..., horizontal) + blur9(..., vertical)) * 0.5;
    
    // Blend bloom with original
    vec3 bloom = blurred * bloomMask * uBloomIntensity;
    gl_FragColor = vec4(originalColor.rgb + bloom, originalColor.a);
}
```

#### Pipeline Registration

```typescript
// BloomPipeline class
export class BloomPipeline extends Phaser.Renderer.WebGL.Pipelines.PostFXPipeline {
  constructor(game: Phaser.Game) {
    super({
      game,
      name: 'BloomPipeline',
      fragShader: BLOOM_FRAG_SHADER,
    });
  }

  onPreRender(): void {
    this.set1f('uBloomIntensity', this._bloomIntensity);
    this.set1f('uBloomThreshold', this._bloomThreshold);
    this.set1f('uBlurSize', this._blurSize);
    this.set2f('uResolution', this.renderer.width, this.renderer.height);
  }
}

// Register in main.ts
export function registerBloomPipeline(game: Phaser.Game): void {
  if (game.renderer instanceof Phaser.Renderer.WebGL.WebGLRenderer) {
    game.renderer.pipelines.addPostPipeline('BloomPipeline', BloomPipeline);
  }
}
```

#### Application to Camera

```typescript
// In GameScene.create()
private setupBloom(): void {
  if (this.game.renderer instanceof Phaser.Renderer.WebGL.WebGLRenderer) {
    this.cameras.main.setPostPipeline('BloomPipeline');
  }
}
```

### 4. Navigation Enhancements

#### ESC to Menu
```typescript
// In GameScene.setupInput()
this.input.keyboard?.on('keydown-ESC', () => {
  this.returnToMenu();
});

private returnToMenu(): void {
  this.shutdown();
  this.scene.start('MainMenuScene');
}
```

#### Scene Flow
```
MainMenuScene -> [Enter name] -> [Click Play] -> GameScene
                                                     |
                                              [Press ESC]
                                                     |
                                                     v
                                            MainMenuScene
```

## Socket Events

### New Client-to-Server Events

| Event | Payload | Description |
|-------|---------|-------------|
| `joinGame` | `JoinOptions` | Player joins with chosen name |

### Updated Server-to-Client Events

| Event | Payload | Description |
|-------|---------|-------------|
| `playerJoined` | `playerId, playerName` | Now includes player name |

## Files Created

- `client/src/scenes/MainMenuScene.ts` - Main menu with name input
- `client/src/pipelines/BloomPipeline.ts` - WebGL bloom shader

## Files Modified

- `shared/types.ts` - Added `name` to PlayerState, ScoreboardEntry; added `JoinOptions`, `killerName`
- `server/src/index.ts` - Two-stage join, name tracking, `hasJoined` filtering
- `client/src/main.ts` - Registered both scenes and bloom pipeline
- `client/src/scenes/GameScene.ts` - Name display, bloom setup, ESC handler
- `client/src/network/SnapshotInterpolation.ts` - Added `name` to InterpolatedPlayer

## Testing Checklist

- [x] Main menu displays with ethereal aesthetic
- [x] Floating orbs animate and pulse
- [x] Name input accepts text (max 16 chars)
- [x] Enter key starts game from input
- [x] Play button hover effect works
- [x] Play button starts game
- [x] Player name passed to GameScene
- [x] `joinGame` sent on connection
- [x] Other players show name tags
- [x] Scoreboard shows names (not IDs)
- [x] Death messages show killer names
- [x] Bloom effect renders on WebGL
- [x] ESC returns to main menu
- [x] HTML input cleaned up on scene exit

## Visual Enhancements Summary

| Feature | Effect |
|---------|--------|
| Menu background | Radial gradient + grid + vignette |
| Floating orbs | Ambient particles with drift + pulse |
| Title glow | Pulsing scale + alpha animation |
| Play button | Hover glow + float animation |
| Bloom shader | Soft glow on bright elements |
| Name tags | Semi-transparent labels above players |

## Performance Considerations

- Bloom shader uses simple 9-tap blur (lightweight)
- Floating orbs limited to 25 particles
- Name tags use native Phaser text (GPU accelerated)
- HTML input only exists during menu scene
- `hasJoined` filter prevents ghost players in snapshots

## Future Enhancements (Not Implemented)

The following were considered but deferred:
- **Fog of War**: Visibility radius masking
- **Player Classes**: Kitsune, Paper Guide, Stone Tōrō
- **Sound Effects**: Collection, death, ambient audio
- **Mobile Controls**: Touch joystick support
