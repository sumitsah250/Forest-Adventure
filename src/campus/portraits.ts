// Portraits for the dialogue cards (and later the evidence board): a head-and-shoulders picture
// of each character, rendered once from the same 3D model that stands in the world. No art
// files, and a portrait always matches the character.
//
// Made behind the loading screen (main.ts), kept as small images. If anything fails the
// dialogue card falls back to initials.

import * as THREE from 'three';
import { createHumanoid, type Humanoid, type Outfit } from '../character/humanoid.ts';
import { dressExtras } from './props.ts';

const SIZE = 256;
const OUT = 96;

export class Portraits {
  private urls = new Map<string, string | null>();
  /** Full-size (256 x 256) pictures kept for the campus screens. */
  private full = new Map<string, HTMLCanvasElement>();
  private renderer: THREE.WebGLRenderer;

  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer;
  }

  /** The portrait made for a cast id, or null. */
  get(id: string): string | null {
    return this.urls.get(id) ?? null;
  }

  /** The 256 x 256 picture of a character made with `keep: true`, or null. */
  canvas(id: string): HTMLCanvasElement | null {
    return this.full.get(id) ?? null;
  }

  /**
   * Renders portraits for a list of characters (a few milliseconds each). A character is an
   * outfit for the standard model, or `make` for another rig (the player's own model).
   */
  makeAll(list: { id: string; outfit?: Outfit; make?: () => Humanoid; keep?: boolean; extras?: ('lanyard' | 'hood')[] }[]): void {
    const r = this.renderer;
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight('#ffffff', '#8a8f9a', 1.5));
    const key = new THREE.DirectionalLight('#fff2de', 2.6);
    key.position.set(-1.2, 1.6, 2.4);
    scene.add(key);
    const camera = new THREE.PerspectiveCamera(22, 1, 0.1, 10);
    camera.position.set(0.16, 1.7, 1.38);
    camera.lookAt(0, 1.655, 0);
    const target = new THREE.WebGLRenderTarget(SIZE, SIZE);
    const pixels = new Uint8Array(SIZE * SIZE * 4);
    const big = document.createElement('canvas');
    big.width = big.height = SIZE;
    const bctx = big.getContext('2d')!;
    const small = document.createElement('canvas');
    small.width = small.height = OUT;
    const sctx = small.getContext('2d')!;
    // The render target holds linear light; images want sRGB.
    const lut = new Uint8ClampedArray(256);
    for (let i = 0; i < 256; i += 1) lut[i] = Math.round(255 * Math.pow(i / 255, 1 / 2.2));
    const prevTarget = r.getRenderTarget();
    const prevColour = r.getClearColor(new THREE.Color());
    const prevAlpha = r.getClearAlpha();
    r.setClearColor(0x000000, 0);
    try {
      for (const { id, outfit, make, keep, extras } of list) {
        if (this.urls.has(id)) continue;
        try {
          const rig = outfit ? createHumanoid(outfit) : make!();
          if (extras) dressExtras(rig, extras);
          scene.add(rig.root);
          r.setRenderTarget(target);
          r.clear();
          r.render(scene, camera);
          r.readRenderTargetPixels(target, 0, 0, SIZE, SIZE, pixels);
          scene.remove(rig.root);
          const img = bctx.createImageData(SIZE, SIZE);
          for (let y = 0; y < SIZE; y += 1) {
            // WebGL rows run bottom to top.
            const src = (SIZE - 1 - y) * SIZE * 4;
            const dst = y * SIZE * 4;
            for (let x = 0; x < SIZE * 4; x += 4) {
              img.data[dst + x] = lut[pixels[src + x]];
              img.data[dst + x + 1] = lut[pixels[src + x + 1]];
              img.data[dst + x + 2] = lut[pixels[src + x + 2]];
              img.data[dst + x + 3] = pixels[src + x + 3];
            }
          }
          bctx.putImageData(img, 0, 0);
          if (keep) {
            const copy = document.createElement('canvas');
            copy.width = copy.height = SIZE;
            copy.getContext('2d')!.drawImage(big, 0, 0);
            this.full.set(id, copy);
          }
          sctx.clearRect(0, 0, OUT, OUT);
          sctx.drawImage(big, 0, 0, OUT, OUT);
          this.urls.set(id, small.toDataURL('image/png'));
        } catch (e) {
          console.warn(`Campus Quest: no portrait for ${id}`, e);
          this.urls.set(id, null);
        }
      }
    } finally {
      r.setRenderTarget(prevTarget);
      r.setClearColor(prevColour, prevAlpha);
      target.dispose();
    }
  }
}
