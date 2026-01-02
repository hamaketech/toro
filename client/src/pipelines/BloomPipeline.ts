import Phaser from 'phaser';

/**
 * Simple bloom post-processing pipeline for Phaser 3
 * 
 * Creates a soft glow effect around bright elements by:
 * 1. Extracting bright pixels
 * 2. Applying a blur
 * 3. Blending back with the original image
 */

const BLOOM_FRAG_SHADER = `
precision mediump float;

uniform sampler2D uMainSampler;
uniform vec2 uResolution;
uniform float uBloomIntensity;
uniform float uBloomThreshold;
uniform float uBlurSize;

varying vec2 outTexCoord;

vec3 blur9(sampler2D image, vec2 uv, vec2 resolution, vec2 direction) {
    vec3 color = vec3(0.0);
    vec2 off1 = vec2(1.3846153846) * direction;
    vec2 off2 = vec2(3.2307692308) * direction;
    color += texture2D(image, uv).rgb * 0.2270270270;
    color += texture2D(image, uv + (off1 / resolution)).rgb * 0.3162162162;
    color += texture2D(image, uv - (off1 / resolution)).rgb * 0.3162162162;
    color += texture2D(image, uv + (off2 / resolution)).rgb * 0.0702702703;
    color += texture2D(image, uv - (off2 / resolution)).rgb * 0.0702702703;
    return color;
}

void main() {
    vec2 uv = outTexCoord;
    vec4 originalColor = texture2D(uMainSampler, uv);
    
    // Calculate luminance
    float luminance = dot(originalColor.rgb, vec3(0.299, 0.587, 0.114));
    
    // Extract bright parts
    float bloomMask = smoothstep(uBloomThreshold, uBloomThreshold + 0.2, luminance);
    
    // Apply blur to bright parts (simple 2-pass approximation in single pass)
    vec3 blurredH = blur9(uMainSampler, uv, uResolution, vec2(uBlurSize, 0.0));
    vec3 blurredV = blur9(uMainSampler, uv, uResolution, vec2(0.0, uBlurSize));
    vec3 blurred = (blurredH + blurredV) * 0.5;
    
    // Blend bloom with original
    vec3 bloom = blurred * bloomMask * uBloomIntensity;
    vec3 finalColor = originalColor.rgb + bloom;
    
    // Subtle color enhancement for the bloom
    finalColor = mix(finalColor, finalColor * vec3(1.05, 1.02, 1.1), bloomMask * 0.3);
    
    gl_FragColor = vec4(finalColor, originalColor.a);
}
`;

/**
 * Bloom post-processing pipeline
 */
export class BloomPipeline extends Phaser.Renderer.WebGL.Pipelines.PostFXPipeline {
  private _bloomIntensity = 0.6;
  private _bloomThreshold = 0.35;
  private _blurSize = 2.0;

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

  /** Set bloom intensity (0-2, default 0.6) */
  setIntensity(value: number): this {
    this._bloomIntensity = value;
    return this;
  }

  /** Set brightness threshold for bloom (0-1, default 0.35) */
  setThreshold(value: number): this {
    this._bloomThreshold = value;
    return this;
  }

  /** Set blur size in pixels (default 2.0) */
  setBlurSize(value: number): this {
    this._blurSize = value;
    return this;
  }
}

/**
 * Register the bloom pipeline with Phaser
 */
export function registerBloomPipeline(game: Phaser.Game): void {
  if (game.renderer instanceof Phaser.Renderer.WebGL.WebGLRenderer) {
    game.renderer.pipelines.addPostPipeline('BloomPipeline', BloomPipeline);
    console.log('BloomPipeline registered successfully');
  } else {
    console.warn('BloomPipeline requires WebGL renderer');
  }
}

