/**
 * Simple texture atlas packer for Tōrō
 * 
 * This script generates a texture atlas from the game's SVG images.
 * 
 * Usage: node scripts/pack-atlas.js
 * 
 * Requirements: npm install sharp
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Try to use sharp for image processing, fallback to manual JSON creation
let sharp;
try {
  sharp = (await import('sharp')).default;
} catch (e) {
  console.log('Sharp not installed. Creating JSON atlas without PNG.');
  console.log('Run "npm install --save-dev sharp" to enable full atlas generation.');
}

const IMAGES_DIR = path.join(__dirname, '../client/public/images');
const OUTPUT_DIR = path.join(__dirname, '../client/public/atlas');
const ATLAS_SIZE = 512; // Power of 2
const PADDING = 4;
const SPRITE_SIZE = 64; // Size to render each sprite at

async function packAtlas() {
  // Ensure output directory exists
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // Get all SVG files
  const files = fs.readdirSync(IMAGES_DIR).filter(f => f.endsWith('.svg'));
  
  if (files.length === 0) {
    console.log('No SVG files found in', IMAGES_DIR);
    return;
  }

  console.log(`Found ${files.length} SVG files:`, files);

  // Create frames metadata
  const frames = {};
  
  // Simple grid layout
  const cols = Math.ceil(Math.sqrt(files.length));
  const cellSize = SPRITE_SIZE + PADDING * 2;
  
  files.forEach((file, index) => {
    const name = path.basename(file, '.svg');
    const row = Math.floor(index / cols);
    const col = index % cols;
    const x = col * cellSize + PADDING;
    const y = row * cellSize + PADDING;
    
    frames[name] = {
      frame: { x, y, w: SPRITE_SIZE, h: SPRITE_SIZE },
      rotated: false,
      trimmed: false,
      spriteSourceSize: { x: 0, y: 0, w: SPRITE_SIZE, h: SPRITE_SIZE },
      sourceSize: { w: SPRITE_SIZE, h: SPRITE_SIZE }
    };
    
    console.log(`  ${name}: (${x}, ${y})`);
  });

  // Calculate atlas dimensions
  const rows = Math.ceil(files.length / cols);
  const atlasWidth = Math.min(ATLAS_SIZE, cols * cellSize);
  const atlasHeight = Math.min(ATLAS_SIZE, rows * cellSize);

  // Create atlas JSON
  const atlasJson = {
    frames,
    meta: {
      app: 'toro-atlas-packer',
      version: '1.0',
      image: 'toro.png',
      format: 'RGBA8888',
      size: { w: atlasWidth, h: atlasHeight },
      scale: '1'
    }
  };

  // Write JSON
  const jsonPath = path.join(OUTPUT_DIR, 'toro.json');
  fs.writeFileSync(jsonPath, JSON.stringify(atlasJson, null, 2));
  console.log(`\nCreated atlas JSON: ${jsonPath}`);

  // Generate PNG if sharp is available
  if (sharp) {
    try {
      console.log('\nGenerating PNG atlas...');
      
      // Create composites array
      const composites = [];
      
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const name = path.basename(file, '.svg');
        const frameData = frames[name];
        
        // Read and resize SVG
        const svgPath = path.join(IMAGES_DIR, file);
        const buffer = await sharp(svgPath)
          .resize(SPRITE_SIZE, SPRITE_SIZE, { 
            fit: 'contain', 
            background: { r: 0, g: 0, b: 0, alpha: 0 } 
          })
          .png()
          .toBuffer();
        
        composites.push({
          input: buffer,
          left: frameData.frame.x,
          top: frameData.frame.y
        });
      }

      // Create atlas PNG
      const pngPath = path.join(OUTPUT_DIR, 'toro.png');
      await sharp({
        create: {
          width: atlasWidth,
          height: atlasHeight,
          channels: 4,
          background: { r: 0, g: 0, b: 0, alpha: 0 }
        }
      })
      .composite(composites)
      .png()
      .toFile(pngPath);

      console.log(`Created atlas PNG: ${pngPath}`);
      console.log(`Atlas size: ${atlasWidth}x${atlasHeight}`);
    } catch (err) {
      console.error('Error generating PNG:', err.message);
      console.log('The JSON atlas was created. PNG generation failed.');
    }
  }

  console.log('\n✅ Atlas generation complete!');
  console.log('\nFrames included:');
  Object.keys(frames).forEach(name => {
    console.log(`  - ${name}`);
  });
}

// Run
packAtlas().catch(err => {
  console.error('Atlas packing failed:', err);
  process.exit(1);
});
