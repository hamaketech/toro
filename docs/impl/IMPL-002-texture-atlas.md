# IMPL-002: Texture Atlas

> Reduce draw calls by combining all sprites into a single texture

**Priority:** 🔴 CRITICAL  
**Effort:** 1 day  
**Impact:** 2-5x FPS improvement on mobile

---

## Problem

Each sprite texture requires a separate draw call. With hundreds of food and segments:
- 200 food × 1 draw call = 200 draw calls
- 500 segments × 1 draw call = 500 draw calls
- Total: 700+ draw calls per frame

Mobile GPUs struggle above 100-200 draw calls.

---

## Solution

Combine all game sprites into a **single texture atlas**. Phaser can batch all sprites using the same atlas into a single draw call.

---

## Implementation Guide

### Step 1: Create Atlas Source Images

Ensure you have all sprite sources in `client/public/images/`:
- `ghost.svg` - Food (Hitodama)
- `ghost-black.svg` - Food outline variant
- `lantern.svg` - Local player head
- `lantern-black.svg` - Lantern outline
- `devil-mask.svg` - Other player heads
- `devil-mask-black.svg` - Devil mask outline

### Step 2: Install TexturePacker CLI or Use Free Alternative

**Option A: Free Phaser Atlas Packer**

Create `scripts/pack-atlas.js`:

```javascript
const fs = require('fs');
const path = require('path');
const sharp = require('sharp'); // npm install sharp

const IMAGES_DIR = './client/public/images';
const OUTPUT_DIR = './client/public/atlas';
const ATLAS_SIZE = 1024; // Power of 2
const PADDING = 2;

async function packAtlas() {
  // Ensure output directory exists
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const files = fs.readdirSync(IMAGES_DIR).filter(f => f.endsWith('.svg') || f.endsWith('.png'));
  const frames = {};
  const images = [];

  // Load and convert all images
  for (const file of files) {
    const name = path.basename(file, path.extname(file));
    const buffer = await sharp(path.join(IMAGES_DIR, file))
      .resize(64, 64, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
    
    const metadata = await sharp(buffer).metadata();
    images.push({ name, buffer, width: metadata.width, height: metadata.height });
  }

  // Simple row packing
  let x = PADDING;
  let y = PADDING;
  let rowHeight = 0;

  for (const img of images) {
    if (x + img.width + PADDING > ATLAS_SIZE) {
      x = PADDING;
      y += rowHeight + PADDING;
      rowHeight = 0;
    }

    frames[img.name] = {
      frame: { x, y, w: img.width, h: img.height },
      rotated: false,
      trimmed: false,
      spriteSourceSize: { x: 0, y: 0, w: img.width, h: img.height },
      sourceSize: { w: img.width, h: img.height }
    };

    rowHeight = Math.max(rowHeight, img.height);
    x += img.width + PADDING;
  }

  // Create composite image
  const composites = images.map(img => ({
    input: img.buffer,
    left: frames[img.name].frame.x,
    top: frames[img.name].frame.y
  }));

  await sharp({
    create: {
      width: ATLAS_SIZE,
      height: ATLAS_SIZE,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    }
  })
  .composite(composites)
  .png()
  .toFile(path.join(OUTPUT_DIR, 'toro.png'));

  // Create JSON metadata
  const atlas = {
    frames,
    meta: {
      app: 'toro-atlas-packer',
      version: '1.0',
      image: 'toro.png',
      format: 'RGBA8888',
      size: { w: ATLAS_SIZE, h: ATLAS_SIZE },
      scale: '1'
    }
  };

  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'toro.json'),
    JSON.stringify(atlas, null, 2)
  );

  console.log('Atlas created:', Object.keys(frames).length, 'frames');
}

packAtlas().catch(console.error);
```

**Option B: Use TexturePacker GUI**

1. Download TexturePacker (free version works)
2. Add all images from `client/public/images/`
3. Export as "Phaser 3" format
4. Save to `client/public/atlas/toro.png` and `toro.json`

### Step 3: Load Atlas in Phaser

Modify `client/src/scenes/GameScene.ts` preload:

```typescript
preload(): void {
  // Load texture atlas instead of individual images
  this.load.atlas(
    'toro',
    '/atlas/toro.png',
    '/atlas/toro.json'
  );
  
  // Keep individual loads as fallback (development)
  // this.load.svg('ghost', '/images/ghost.svg', { width: 64, height: 64 });
  // this.load.svg('lantern', '/images/lantern.svg', { width: 64, height: 64 });
  // this.load.svg('devil-mask', '/images/devil-mask.svg', { width: 64, height: 64 });
}
```

### Step 4: Update Sprite Creation to Use Atlas

**Before (individual textures):**
```typescript
const sprite = this.add.sprite(x, y, 'ghost');
```

**After (atlas):**
```typescript
const sprite = this.add.sprite(x, y, 'toro', 'ghost');
```

Update all sprite creations:

```typescript
// Food
const foodSprite = this.add.sprite(food.x, food.y, 'toro', 'ghost');

// Local player head
const lanternSprite = this.add.sprite(player.x, player.y, 'toro', 'lantern');

// Other player head
const enemyHead = this.add.sprite(player.x, player.y, 'toro', 'devil-mask');

// Body segments (use 'ghost' frame for all)
const segment = this.add.sprite(seg.x, seg.y, 'toro', 'ghost');
```

### Step 5: Update Object Pools

If you've implemented IMPL-001 (Object Pooling), update the pools:

```typescript
// FoodPool.ts
constructor(scene: Phaser.Scene, maxFood: number = 200) {
  this.corePool = new SpritePool(scene, 'toro', 'ghost', maxFood);
  this.glowPool = new SpritePool(scene, 'toro', 'ghost', maxFood);
}

// SegmentPool.ts
constructor(scene: Phaser.Scene, maxSegments: number = 500) {
  this.pool = new SpritePool(scene, 'toro', 'ghost', maxSegments);
}
```

### Step 6: Add Additional Frames (Optional)

Create additional visual variations in the atlas:

```
toro.json frames:
- ghost           (cyan food)
- ghost-golden    (golden food - could be tinted or separate sprite)
- lantern         (player head)
- lantern-glow    (optional glow sprite)
- devil-mask      (enemy head)
- segment         (body segment, if different from ghost)
- particle        (for effects)
- trail           (for boost trail)
```

### Step 7: Verify Batching

Add debug display to verify draw calls reduced:

```typescript
// In update()
if (this.game.config.renderType === Phaser.WEBGL) {
  const renderer = this.game.renderer as Phaser.Renderer.WebGL.WebGLRenderer;
  console.log('Draw calls:', renderer.drawCount);
}
```

Before atlas: 500-1000 draw calls
After atlas: 10-50 draw calls

---

## Vite Configuration

Update `client/vite.config.ts` to copy atlas files:

```typescript
import { defineConfig } from 'vite';

export default defineConfig({
  publicDir: 'public',
  build: {
    assetsDir: 'assets',
    rollupOptions: {
      output: {
        assetFileNames: (assetInfo) => {
          // Keep atlas in predictable location
          if (assetInfo.name?.includes('toro.')) {
            return 'atlas/[name][extname]';
          }
          return 'assets/[name]-[hash][extname]';
        }
      }
    }
  }
});
```

---

## Testing Checklist

- [ ] Atlas loads successfully (no console errors)
- [ ] All sprites display correctly (food, players, segments)
- [ ] Colors/tints still work properly
- [ ] Draw call count reduced to <100
- [ ] Mobile FPS improved significantly
- [ ] No texture bleeding/artifacts at sprite edges

---

## Troubleshooting

### Sprites appear white/missing
- Verify atlas JSON frame names match your code
- Check that atlas path is correct

### Texture bleeding
- Increase padding in atlas (4px instead of 2px)
- Use "extrude" option in TexturePacker

### Mobile still slow
- Reduce atlas size (512x512 for low-end)
- Use mipmaps for distant sprites

---

## AI Implementation Prompt

```
Implement texture atlas for Tōrō game following docs/impl/IMPL-002-texture-atlas.md.

Current state:
- Game loads individual SVG files (ghost.svg, lantern.svg, devil-mask.svg)
- Sprites created with this.add.sprite(x, y, 'ghost')
- 500+ draw calls per frame on busy screens

Tasks:
1. Create atlas packing script or use manual packer
2. Generate toro.png and toro.json atlas files
3. Update GameScene preload to load atlas
4. Update all sprite creations to use atlas frames
5. Update object pools to use atlas
6. Verify draw calls reduced to <50

The atlas should include: ghost, lantern, devil-mask frames at minimum.
Maintain all existing visual effects (tinting, scaling, alpha).
```


