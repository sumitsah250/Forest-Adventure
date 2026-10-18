// Loads the CC0 Poly Haven props (glTF) once and hands out clones.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { assetUrl } from './textures.ts';

const loader = new GLTFLoader();
const shrunk = new WeakSet<object>();

/** Props are small on screen: keep their textures at most `max` pixels to save GPU memory. */
function downscale(t: THREE.Texture, max: number): void {
  const img = t.image as HTMLImageElement | ImageBitmap | HTMLCanvasElement | undefined;
  if (!img || shrunk.has(img) || !('width' in img) || img.width <= max) return;
  const c = document.createElement('canvas');
  const s = max / Math.max(img.width, img.height);
  c.width = Math.round(img.width * s);
  c.height = Math.round(img.height * s);
  c.getContext('2d')!.drawImage(img as CanvasImageSource, 0, 0, c.width, c.height);
  shrunk.add(c);
  t.image = c;
  t.needsUpdate = true;
}
const cache = new Map<string, Promise<THREE.Group>>();

export function loadModel(slug: string): Promise<THREE.Group> {
  let p = cache.get(slug);
  if (!p) {
    p = loader.loadAsync(assetUrl(`models/${slug}/${slug}.gltf.json`)).then((gltf) => {
      const root = gltf.scene;
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.castShadow = true;
          m.receiveShadow = true;
          const mats = Array.isArray(m.material) ? m.material : [m.material];
          for (const mat of mats) {
            const s = mat as THREE.MeshStandardMaterial;
            // Transmissive glass makes three.js re-render the whole scene into an extra
            // pass every frame; plain transparency looks the same at prop scale.
            const phys = mat as THREE.MeshPhysicalMaterial;
            if (phys.isMeshPhysicalMaterial && phys.transmission > 0) {
              phys.transmission = 0;
              phys.transparent = true;
              phys.opacity = Math.min(phys.opacity, 0.35);
              phys.depthWrite = false;
            }
            for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap'] as const) {
              const t = s[key];
              if (t) downscale(t, 512);
            }
            if (s.map) s.map.anisotropy = 4;
          }
        }
      });
      return root;
    });
    cache.set(slug, p);
  }
  return p;
}

/** Clone of a loaded model, optionally scaled so its largest dimension is `size` metres. */
export async function placeModel(slug: string, opts: { size?: number; sit?: boolean } = {}): Promise<THREE.Group> {
  const src = await loadModel(slug);
  const obj = src.clone(true);
  if (opts.size) {
    const box = new THREE.Box3().setFromObject(obj);
    const dim = box.getSize(new THREE.Vector3());
    const s = opts.size / Math.max(dim.x, dim.y, dim.z);
    obj.scale.multiplyScalar(s);
  }
  if (opts.sit !== false) {
    const box = new THREE.Box3().setFromObject(obj);
    obj.position.y -= box.min.y;
  }
  const wrapper = new THREE.Group();
  wrapper.add(obj);
  wrapper.name = slug;
  return wrapper;
}

export function modelSize(obj: THREE.Object3D): THREE.Vector3 {
  return new THREE.Box3().setFromObject(obj).getSize(new THREE.Vector3());
}
