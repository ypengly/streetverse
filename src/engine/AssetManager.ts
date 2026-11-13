/**
 * AssetManager: caches textures/materials/geometries, reports loading progress, and owns disposal.
 *
 * Stage 1 builds all assets procedurally (no external files required). `loadGLTF` is the hook for
 * Stage 2+: it tries a real model and falls back to a supplied procedural builder on any failure,
 * so a missing file can never crash the game.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export type ProgressListener = (fraction: number, label: string) => void;

export class AssetManager {
  private textures = new Map<string, THREE.Texture>();
  private disposables = new Set<{ dispose(): void }>();
  private gltfLoader = new GLTFLoader();
  private total = 1;
  private done = 0;

  constructor(private readonly onProgress?: ProgressListener) {}

  /** Declare how many steps the loading screen should expect. */
  expect(total: number): void {
    this.total = Math.max(1, total);
    this.done = 0;
  }

  step(label: string): void {
    this.done = Math.min(this.total, this.done + 1);
    this.onProgress?.(this.done / this.total, label);
  }

  /** Return a cached texture, building it with `factory` on first use. */
  texture(key: string, factory: () => THREE.Texture): THREE.Texture {
    let tex = this.textures.get(key);
    if (!tex) {
      tex = factory();
      this.textures.set(key, tex);
    }
    return tex;
  }

  /** Register any geometry/material for disposal when the session ends. */
  track<T extends { dispose(): void }>(obj: T): T {
    this.disposables.add(obj);
    return obj;
  }

  /**
   * Load a GLB/GLTF. On any failure (missing file, parse error) returns `fallback()` instead and
   * reports the failure through `onFallback` so the caller can log it.
   */
  async loadGLTF(url: string, fallback: () => THREE.Object3D, onFallback?: (err: unknown) => void): Promise<THREE.Object3D> {
    try {
      const gltf = await this.gltfLoader.loadAsync(url);
      return gltf.scene;
    } catch (err) {
      onFallback?.(err);
      return fallback();
    }
  }

  dispose(): void {
    this.textures.forEach((t) => t.dispose());
    this.textures.clear();
    this.disposables.forEach((d) => d.dispose());
    this.disposables.clear();
  }
}

/** Procedural 2D canvas helpers. */
export function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  return [c, ctx];
}

function noise(ctx: CanvasRenderingContext2D, w: number, h: number, count: number, alpha: number, size: number, light: boolean): void {
  for (let i = 0; i < count; i++) {
    const v = light ? 150 + Math.random() * 90 : Math.random() * 60;
    ctx.fillStyle = `rgba(${v},${v},${v},${alpha})`;
    ctx.fillRect(Math.random() * w, Math.random() * h, size, size);
  }
}

/** Asphalt with painted edge lines and a dashed centre line. u = across road, v = along road. */
export function createRoadTexture(): THREE.Texture {
  const [c, ctx] = makeCanvas(512, 512);
  ctx.fillStyle = '#3a3d42';
  ctx.fillRect(0, 0, 512, 512);
  noise(ctx, 512, 512, 9000, 0.35, 2, true);
  noise(ctx, 512, 512, 7000, 0.4, 2, false);
  // Wear streaks where tires run.
  ctx.fillStyle = 'rgba(20,20,22,0.18)';
  ctx.fillRect(512 * 0.2, 0, 24, 512);
  ctx.fillRect(512 * 0.26, 0, 24, 512);
  ctx.fillRect(512 * 0.7, 0, 24, 512);
  ctx.fillRect(512 * 0.76, 0, 24, 512);
  // Edge lines.
  ctx.fillStyle = '#e9e9e4';
  ctx.fillRect(512 * 0.045, 0, 8, 512);
  ctx.fillRect(512 * 0.955 - 8, 0, 8, 512);
  // Dashed centre line.
  ctx.fillStyle = '#e8c547';
  for (let y = 0; y < 512; y += 128) ctx.fillRect(256 - 4, y, 8, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

export function createGrassTexture(): THREE.Texture {
  const [c, ctx] = makeCanvas(256, 256);
  ctx.fillStyle = '#4d7a3a';
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 6000; i++) {
    const g = 90 + Math.random() * 70;
    ctx.fillStyle = `rgba(${40 + Math.random() * 30},${g},${30 + Math.random() * 20},0.5)`;
    ctx.fillRect(Math.random() * 256, Math.random() * 256, 2, 3);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

export function createConcreteTexture(): THREE.Texture {
  const [c, ctx] = makeCanvas(128, 128);
  ctx.fillStyle = '#9a9a96';
  ctx.fillRect(0, 0, 128, 128);
  noise(ctx, 128, 128, 1500, 0.3, 2, true);
  noise(ctx, 128, 128, 1500, 0.3, 2, false);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}
