// Builds the 3D campus from the OpenStreetMap plan: painted ground over the real slope,
// extruded buildings with windows, roofs, doors and department signboards, trees from the
// forest generator, street furniture, sports equipment, walls, the main gate, and the
// Annapurna range on the northern horizon.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GeoBuilder } from '../render/geoBuilder.ts';
import { loadPbr } from '../render/textures.ts';
import type { PhysicsWorld } from '../physics/physics.ts';
import type { GraphicsPreset } from '../core/settings.ts';
import type { FoliageAtlas } from '../render/foliageAtlas.ts';
import { broadleaf, bush, pine, type PlantModel } from '../world/treeGen.ts';
import { barkMaterial, foliageDepthMaterial, foliageMaterial } from '../render/foliageMaterial.ts';
import { mulberry32, range, hash2 } from '../world/rng.ts';
import { signTexture } from '../world/build.ts';
import {
  DATA, GATE, WORLD_HALF, buildingAt, centroid, orientedRect, pointInPoly, polyArea, segDist,
  type BuildingData, type Pt,
} from './geo.ts';
import { CLS, type CampusGround } from './ground.ts';
import { classGrid, paintPlan } from './paint.ts';

export interface Entrance {
  /** Where a person stands in front of the door, facing out. */
  x: number;
  z: number;
  y: number;
  /** Yaw for a character facing outward (model +Z faces (sin f, 0, cos f)). */
  facing: number;
  /** Door centre on the wall. */
  doorX: number;
  doorZ: number;
  building: BuildingData;
}

export interface CampusWorld {
  group: THREE.Group;
  /** Moves with the camera (mountains). */
  backdrop: THREE.Group;
  mapCanvas: HTMLCanvasElement;
  entrances: Map<BuildingData, Entrance>;
  entranceFor(b: BuildingData, label?: string): Entrance;
  flag: THREE.Mesh | null;
  update(t: number, camera: THREE.Camera): void;
}

export interface WorldOptions {
  ground: CampusGround;
  physics: PhysicsWorld;
  preset: GraphicsPreset;
  atlas: FoliageAtlas;
  barkBroad: { map: THREE.Texture; normalMap: THREE.Texture; roughnessMap: THREE.Texture };
  barkPine: { map: THREE.Texture; normalMap: THREE.Texture; roughnessMap: THREE.Texture };
  progress: (f: number, label: string) => void;
}

const STOREY = 3.2;

export async function buildCampus(o: WorldOptions): Promise<CampusWorld> {
  const { ground, physics, preset } = o;
  const group = new THREE.Group();
  group.name = 'campus';

  // ------------------------------------------------------------------ ground
  o.progress(0.05, 'Painting the campus grounds');
  const texSize = preset.textureSize >= 1024 ? 4096 : 2048;
  const groundCanvas = paintPlan(texSize, 'ground');
  const clsCanvas = paintPlan(1024, 'class');
  ground.cls = classGrid(clsCanvas);
  ground.clsN = 1024;
  const mapCanvas = paintPlan(1024, 'map');
  const groundTex = new THREE.CanvasTexture(groundCanvas);
  groundTex.colorSpace = THREE.SRGBColorSpace;
  groundTex.anisotropy = 8;
  groundTex.generateMipmaps = true;
  const detail = detailTexture();
  group.add(groundMesh(ground, groundTex, detail));
  group.add(outerGround(ground, detail));
  await nextFrame();

  // ------------------------------------------------------------------ buildings
  o.progress(0.25, 'Raising the buildings');
  const [concrete, tin] = await Promise.all([loadPbr('concrete_floor_worn_001'), loadPbr('corrugated_iron_02')]);
  const mats = {
    facade: new THREE.MeshStandardMaterial({ map: facadeTexture(), vertexColors: true, roughness: 0.82 }),
    shop: new THREE.MeshStandardMaterial({ map: shopTexture(), vertexColors: true, roughness: 0.85 }),
    plain: new THREE.MeshStandardMaterial({ map: plasterTexture(), vertexColors: true, roughness: 0.9, side: THREE.DoubleSide }),
    flat: new THREE.MeshStandardMaterial({ map: concrete.map, normalMap: concrete.normalMap, roughnessMap: concrete.roughnessMap, vertexColors: true, side: THREE.DoubleSide }),
    tin: new THREE.MeshStandardMaterial({ map: tin.map, normalMap: tin.normalMap, roughnessMap: tin.roughnessMap, vertexColors: true, metalness: 0.35, side: THREE.DoubleSide }),
  };
  const B = { facade: new GeoBuilder(), shop: new GeoBuilder(), plain: new GeoBuilder(), flat: new GeoBuilder(), tin: new GeoBuilder() };
  const kit = new Kit();
  const rng = mulberry32(2044);
  const footprints: { b: BuildingData; floor: number; top: number }[] = [];
  for (const b of DATA.buildings) {
    if (Math.abs(centroid(b.pts)[0]) > WORLD_HALF + 40 || Math.abs(centroid(b.pts)[1]) > WORLD_HALF + 40) continue;
    const info = building(b, ground, B, kit, physics, rng);
    if (info) footprints.push({ b, ...info });
  }
  for (const [k, g] of Object.entries(B)) {
    if (!g.vertexCount) continue;
    const m = new THREE.Mesh(g.build(), mats[k as keyof typeof mats]);
    m.castShadow = true;
    m.receiveShadow = true;
    m.name = `buildings-${k}`;
    group.add(m);
  }
  await nextFrame();

  // Entrances with doors and signboards.
  const entrances = new Map<BuildingData, Entrance>();
  const floorOf = new Map(footprints.map((f) => [f.b, f]));
  const signGroup = new THREE.Group();
  group.add(signGroup);
  const entranceFor = (b: BuildingData, label?: string): Entrance => {
    const hit = entrances.get(b);
    if (hit) return hit;
    const e = findEntrance(b, ground, floorOf.get(b)?.floor ?? ground.heightAt(...centroid(b.pts)));
    entrances.set(b, e);
    addDoor(signGroup, e, label ?? b.name ?? '', floorOf.get(b)?.floor ?? e.y, physics);
    return e;
  };
  for (const b of DATA.buildings) if (b.inside && b.name && !/[^\x20-\x7e]/.test(b.name) && polyArea(b.pts) !== 0) entranceFor(b, signName(b.name));

  // ------------------------------------------------------------------ walls, gate, props
  o.progress(0.45, 'Building walls and the main gate');
  boundaryWall(kit, ground, physics);
  for (const l of DATA.lines) {
    if (l.kind === 'wall') linearBarrier(kit, ground, physics, l.pts, 'wall');
    if (l.kind === 'fence') linearBarrier(kit, ground, physics, l.pts, 'fence');
  }
  mainGate(group, kit, ground, physics);
  o.progress(0.55, 'Placing benches, lamps and statues');
  let flag: THREE.Mesh | null = null;
  for (const p of DATA.points) {
    if (Math.abs(p.x) > WORLD_HALF || Math.abs(p.z) > WORLD_HALF) continue;
    const y = ground.heightAt(p.x, p.z);
    switch (p.kind) {
      case 'bench': bench(kit, p.x, y, p.z, pathAngle(p.x, p.z), physics); break;
      case 'lamp': lamp(kit, p.x, y, p.z, physics); break;
      case 'statue': statue(group, kit, p.x, y, p.z, p.name ?? '', physics); break;
      case 'fountain': fountain(kit, p.x, y, p.z, physics); break;
      case 'flagpole': flag = flagpole(group, kit, p.x, y, p.z, physics); break;
      case 'board': board(group, kit, p.x, y, p.z, pathAngle(p.x, p.z), physics); break;
      case 'bin': kit.cyl('green', 0.28, 0.8, p.x, y, p.z, 10); break;
      case 'tap': tap(kit, p.x, y, p.z); break;
      case 'watertower': waterTower(kit, p.x, y, p.z, physics); break;
      default: break;
    }
  }
  if (!flag) {
    // The campus flag in front of the administration block.
    const admin = DATA.points.find((q) => q.name === 'Administration Block');
    if (admin) flag = flagpole(group, kit, admin.x + 4, ground.heightAt(admin.x + 4, admin.z - 14), admin.z - 14, physics);
  }
  for (const a of DATA.areas) if (a.kind === 'pitch' || a.kind === 'ground') sports(kit, ground, physics, a.pts, (a.sport ?? '').split(';')[0], a.kind);
  // Rooftop water tanks on the town's flat-roofed houses.
  for (const f of footprints) {
    if (f.b.inside || f.b.roofShape === 'pitched' || polyArea(f.b.pts) === 0) continue;
    if (hash2(f.top * 13, f.floor * 7, 3) > 0.55) continue;
    const [cx, cz] = centroid(f.b.pts);
    if (!pointInPoly(cx, cz, f.b.pts)) continue;
    kit.cyl('tank', 0.65, 1.3, cx + 1, f.top + 0.9, cz, 12);
  }
  kit.build(group);
  await nextFrame();

  // ------------------------------------------------------------------ trees
  o.progress(0.65, 'Planting trees');
  plantTrees(group, o, ground, physics);
  await nextFrame();

  // ------------------------------------------------------------------ backdrop
  o.progress(0.9, 'Lifting the Annapurnas');
  const backdrop = mountains();

  return {
    group,
    backdrop,
    mapCanvas,
    entrances,
    entranceFor,
    flag,
    update(t: number, camera: THREE.Camera) {
      backdrop.position.set(camera.position.x, 0, camera.position.z);
      if (flag) {
        const pos = flag.geometry.getAttribute('position') as THREE.BufferAttribute;
        const base = flag.userData.base as Float32Array;
        for (let i = 0; i < pos.count; i += 1) {
          const u = base[i * 3];
          pos.setZ(i, Math.sin(u * 3.2 - t * 5.5) * 0.12 * u + Math.sin(u * 7 - t * 9) * 0.03 * u);
        }
        pos.needsUpdate = true;
      }
    },
  };
}

function nextFrame(): Promise<void> {
  return new Promise((r) => requestAnimationFrame(() => r()));
}

function signName(n: string): string {
  return n.replace('Addministrative', 'Administration Block').replace('Maintainance', 'Maintenance');
}

// ==================================================================== ground meshes

function groundMesh(g: CampusGround, tex: THREE.Texture, detail: THREE.Texture): THREE.Mesh {
  const n = g.n;
  const pos = new Float32Array(n * n * 3);
  const uv = new Float32Array(n * n * 2);
  for (let zi = 0; zi < n; zi += 1) {
    for (let xi = 0; xi < n; xi += 1) {
      const i = zi * n + xi;
      const x = g.origin + xi * g.cell;
      const z = g.origin + zi * g.cell;
      pos[i * 3] = x;
      pos[i * 3 + 1] = g.heights[i];
      pos[i * 3 + 2] = z;
      uv[i * 2] = xi / (n - 1);
      uv[i * 2 + 1] = 1 - zi / (n - 1);
    }
  }
  const idx: number[] = [];
  for (let zi = 0; zi < n - 1; zi += 1) {
    for (let xi = 0; xi < n - 1; xi += 1) {
      const a = zi * n + xi;
      const b = a + 1;
      const c = a + n;
      const d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 });
  detailPatch(mat, detail, 1);
  const m = new THREE.Mesh(geo, mat);
  m.receiveShadow = true;
  m.name = 'ground';
  return m;
}

/** Terraced fields and hillside beyond the playable square, out to the fog. */
function outerGround(g: CampusGround, detail: THREE.Texture): THREE.Mesh {
  const R = 1500;
  const n = 81;
  const geo = new THREE.PlaneGeometry(R * 2, R * 2, n - 1, n - 1);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const col = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i += 1) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const inner = Math.max(Math.abs(x), Math.abs(z)) < WORLD_HALF - 25;
    const out = Math.max(0, Math.hypot(x, z) - WORLD_HALF);
    let y = g.demAt(x, z) + Math.pow(out / 600, 2) * 40 * (0.6 + 0.4 * Math.sin(Math.atan2(z, x) * 3 + 1));
    if (inner) y -= 6;
    pos.setY(i, y);
    const f = hash2(Math.floor(x / 40), Math.floor(z / 30), 5);
    c.set(f > 0.66 ? '#7e7d4f' : f > 0.33 ? '#6b7f41' : '#4f6634');
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 });
  detailPatch(mat, detail, 0.3);
  const m = new THREE.Mesh(geo, mat);
  m.receiveShadow = true;
  m.name = 'outer-ground';
  return m;
}

/** Breaks up texture magnification with two octaves of world-space noise. */
function detailPatch(mat: THREE.MeshStandardMaterial, detail: THREE.Texture, strength: number): void {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.tDetail = { value: detail };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vDetailXZ;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvDetailXZ = (modelMatrix * vec4(transformed, 1.0)).xz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D tDetail;\nvarying vec2 vDetailXZ;')
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        {
          float d1 = texture2D(tDetail, vDetailXZ * 0.42).r;
          float d2 = texture2D(tDetail, vDetailXZ * 0.061).g;
          float d3 = texture2D(tDetail, vDetailXZ * 0.0123).b;
          diffuseColor.rgb *= mix(1.0, 0.8 + 0.34 * d1 + (d2 - 0.5) * 0.3 + (d3 - 0.5) * 0.25, ${strength.toFixed(2)});
        }`,
      );
  };
  mat.customProgramCacheKey = () => `campus-detail-${strength}`;
}

function detailTexture(): THREE.Texture {
  const s = 256;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(s, s);
  const rng = mulberry32(77);
  // Value noise per channel at different frequencies, tileable.
  const chan = (freq: number) => {
    const g = new Float32Array(freq * freq).map(() => rng());
    return (x: number, y: number) => {
      const fx = (x / s) * freq;
      const fy = (y / s) * freq;
      const ix = Math.floor(fx);
      const iy = Math.floor(fy);
      const tx = fx - ix;
      const ty = fy - iy;
      const at = (a: number, b: number) => g[((b + freq) % freq) * freq + ((a + freq) % freq)];
      const sx = tx * tx * (3 - 2 * tx);
      const sy = ty * ty * (3 - 2 * ty);
      return (at(ix, iy) * (1 - sx) + at(ix + 1, iy) * sx) * (1 - sy) + (at(ix, iy + 1) * (1 - sx) + at(ix + 1, iy + 1) * sx) * sy;
    };
  };
  const r1 = chan(64), r2 = chan(16), g1 = chan(8), g2 = chan(24), b1 = chan(4), b2 = chan(12);
  for (let y = 0; y < s; y += 1) {
    for (let x = 0; x < s; x += 1) {
      const i = (y * s + x) * 4;
      img.data[i] = (r1(x, y) * 0.6 + r2(x, y) * 0.4) * 255;
      img.data[i + 1] = (g1(x, y) * 0.6 + g2(x, y) * 0.4) * 255;
      img.data[i + 2] = (b1(x, y) * 0.6 + b2(x, y) * 0.4) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

// ==================================================================== building textures

function facadeTexture(): THREE.Texture {
  // One storey, one bay: plastered wall, a framed window with a sill, and a floor band.
  const s = 256;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d')!;
  plaster(ctx, s, s);
  ctx.fillStyle = 'rgba(0,0,0,0.10)';
  ctx.fillRect(0, s - 18, s, 18); // floor band (bottom of the storey)
  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  ctx.fillRect(0, s - 21, s, 3);
  const wx = 52, wy = 54, ww = 152, wh = 118;
  ctx.fillStyle = '#3b3328';
  ctx.fillRect(wx - 8, wy - 8, ww + 16, wh + 16);
  const g = ctx.createLinearGradient(wx, wy, wx + ww, wy + wh);
  g.addColorStop(0, '#4c5c66');
  g.addColorStop(0.45, '#2a333a');
  g.addColorStop(0.55, '#55656e');
  g.addColorStop(1, '#232b31');
  ctx.fillStyle = g;
  ctx.fillRect(wx, wy, ww, wh);
  ctx.fillStyle = '#3b3328';
  ctx.fillRect(wx + ww / 2 - 4, wy, 8, wh);
  ctx.fillRect(wx, wy + wh * 0.32, ww, 6);
  // Window grille, typical of Nepali campus blocks.
  ctx.strokeStyle = 'rgba(30,26,20,0.75)';
  ctx.lineWidth = 2;
  for (let x = wx + 12; x < wx + ww; x += 15) {
    ctx.beginPath();
    ctx.moveTo(x, wy);
    ctx.lineTo(x, wy + wh);
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(wx - 14, wy + wh + 8, ww + 28, 8); // sill shadow
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.fillRect(wx - 14, wy + wh + 6, ww + 28, 4);
  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  ctx.fillRect(wx - 12, wy - 22, ww + 24, 10); // chajja (window hood) shadow
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  ctx.fillRect(wx - 12, wy - 24, ww + 24, 4);
  stain(ctx, s);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function shopTexture(): THREE.Texture {
  // Town houses: smaller windows, a shutter on some ground floors.
  const s = 256;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d')!;
  plaster(ctx, s, s);
  ctx.fillStyle = '#2f3438';
  ctx.fillRect(70, 70, 116, 100);
  ctx.fillStyle = '#6d5a3f';
  ctx.fillRect(62, 62, 132, 8);
  ctx.fillRect(62, 170, 132, 8);
  ctx.fillRect(62, 62, 8, 116);
  ctx.fillRect(186, 62, 8, 116);
  ctx.fillRect(124, 70, 6, 100);
  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  ctx.fillRect(0, s - 14, s, 14);
  stain(ctx, s);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function plasterTexture(): THREE.Texture {
  const s = 256;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d')!;
  plaster(ctx, s, s);
  stain(ctx, s);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function plaster(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  const rng = mulberry32(w * 31 + h);
  for (let i = 0; i < 3500; i += 1) {
    const v = 215 + Math.floor(rng() * 40);
    ctx.fillStyle = `rgba(${v},${v},${v - 4},0.35)`;
    ctx.fillRect(rng() * w, rng() * h, 1 + rng() * 3, 1 + rng() * 3);
  }
}

/** Monsoon streaks running down from sills and the roof line. */
function stain(ctx: CanvasRenderingContext2D, s: number): void {
  const rng = mulberry32(s + 5);
  for (let i = 0; i < 26; i += 1) {
    const x = rng() * s;
    const len = 20 + rng() * 120;
    const g = ctx.createLinearGradient(0, 0, 0, len);
    g.addColorStop(0, 'rgba(60,58,48,0.16)');
    g.addColorStop(1, 'rgba(60,58,48,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x, 0, 2 + rng() * 6, len);
  }
}

// ==================================================================== buildings

const HOUSE_COLOURS = ['#efe9dc', '#f2e2c4', '#e9c9b5', '#dfe6e8', '#f0d9a8', '#e8d1d8', '#d6e3cf', '#f4efe6', '#e7b98b', '#cfd8e4'];

function building(
  b: BuildingData, ground: CampusGround, B: Record<'facade' | 'shop' | 'plain' | 'flat' | 'tin', GeoBuilder>, kit: Kit, physics: PhysicsWorld, rng: () => number,
): { floor: number; top: number } | null {
  let pts = b.pts.slice();
  if (pts.length < 3) return null;
  let area = polyArea(pts);
  if (Math.abs(area) < 4) return null;
  if (area < 0) {
    pts = pts.reverse();
    area = -area;
  }
  let gmin = Infinity;
  let gsum = 0;
  for (const [x, z] of pts) {
    const h = ground.heightAt(x, z);
    gmin = Math.min(gmin, h);
    gsum += h;
  }
  const floor = gsum / pts.length;
  const y0 = gmin - 0.6;
  const name = b.name ?? '';
  const small = area < 45;
  let storeys: number;
  if (b.levels) storeys = b.levels;
  else if (!b.inside) storeys = small ? 1 : 2 + Math.floor(hash2(pts[0][0], pts[0][1], 1) * 2.6);
  else if (/workshop|lab|garage|store|power|room|toilet|guard|parking|stationery|tennis/i.test(name) || b.kind === 'temple') storeys = 1;
  else if (area > 700) storeys = 3;
  else if (area > 220) storeys = 2;
  else storeys = 1;
  const workshop = b.inside && storeys === 1 && area > 60 && /workshop|lab|garage|store|power/i.test(name);
  const storeyH = b.height && b.levels ? b.height / b.levels : workshop ? 5 : STOREY;
  const height = b.height ?? storeys * storeyH;
  const top = floor + height;
  const wall = new THREE.Color(b.wall ?? (b.inside ? '#f3eccf' : HOUSE_COLOURS[Math.floor(hash2(pts[0][0] * 3, pts[0][1], 2) * HOUSE_COLOURS.length)]));
  // Slight per-building variation so a row of cream blocks does not look cloned.
  wall.offsetHSL(0, 0, (rng() - 0.5) * 0.05);
  const facade = b.inside ? B.facade : B.shop;
  const bay = workshop ? 4.6 : b.inside ? 3.3 : 3.0;

  for (let i = 0; i < pts.length; i += 1) {
    const a = pts[i];
    const c = pts[(i + 1) % pts.length];
    const dx = c[0] - a[0];
    const dz = c[1] - a[1];
    const len = Math.hypot(dx, dz);
    if (len < 0.05) continue;
    const nx = dz / len;
    const nz = -dx / len;
    const n = new THREE.Vector3(nx, 0, nz);
    const windows = len >= 2.6 && !small;
    const target = windows ? facade : B.plain;
    const u1 = windows ? Math.max(1, Math.round(len / bay)) : len / 3;
    const v0 = (y0 - floor) / storeyH;
    const v1 = height / storeyH;
    const A0 = new THREE.Vector3(a[0], y0, a[1]);
    const A1 = new THREE.Vector3(a[0], top, a[1]);
    const C0 = new THREE.Vector3(c[0], y0, c[1]);
    const C1 = new THREE.Vector3(c[0], top, c[1]);
    const ia = target.vert(A0, n, 0, windows ? v0 : y0 / 3, 0.92, 0, wall);
    const ib = target.vert(A1, n, 0, windows ? v1 : top / 3, 1, 0, wall);
    const ic = target.vert(C1, n, u1, windows ? v1 : top / 3, 1, 0, wall);
    const id = target.vert(C0, n, u1, windows ? v0 : y0 / 3, 0.92, 0, wall);
    target.quad(ia, ib, ic, id);
    // Collision: one thin box per wall segment.
    if (len > 0.3) {
      physics.tag(physics.addBox({
        x: (a[0] + c[0]) / 2 - nx * 0.25, y: (y0 + top) / 2, z: (a[1] + c[1]) / 2 - nz * 0.25,
        hx: len / 2, hy: (top - y0) / 2, hz: 0.3, rotY: Math.atan2(-dz, dx),
      }), 'rock');
    }
  }

  // Roof.
  const roofCol = new THREE.Color(b.roof ?? (b.inside ? '#8a8c8c' : '#9a958c'));
  const r = orientedRect(pts);
  const rectFill = area / (4 * r.hl * r.hw);
  const pitched = (b.roofShape === 'pitched' || workshop || (b.inside && storeys === 1 && area < 400)) && rectFill > 0.8 && r.hw > 1.5;
  if (pitched) hipRoof(B.tin, r, top, roofCol);
  else {
    flatRoof(B.flat, pts, top + 0.02, roofCol);
    if (!small) parapet(B.plain, pts, top, b.inside ? 0.9 : 0.75, wall);
  }
  if (b.kind === 'temple') {
    // A small shikhara spire for the Saraswati temple.
    const [cx, cz] = centroid(pts);
    kit.cone('red', 1.4, 3.2, cx, top, cz, 4);
    kit.cyl('gold', 0.12, 0.8, cx, top + 3.1, cz, 6);
  }
  return { floor, top };
}

function flatRoof(g: GeoBuilder, pts: Pt[], y: number, col: THREE.Color): void {
  const contour = pts.map((p) => new THREE.Vector2(p[0], p[1]));
  const tris = THREE.ShapeUtils.triangulateShape(contour, []);
  const up = new THREE.Vector3(0, 1, 0);
  for (const [i0, i1, i2] of tris) {
    const p0 = contour[i0], p1 = contour[i1], p2 = contour[i2];
    const cross = (p1.x - p0.x) * (p2.y - p0.y) - (p1.y - p0.y) * (p2.x - p0.x);
    const order = cross < 0 ? [p0, p1, p2] : [p0, p2, p1];
    const ids = order.map((p) => g.vert(new THREE.Vector3(p.x, y, p.y), up, p.x / 3, p.y / 3, 1, 0, col));
    g.tri(ids[0], ids[1], ids[2]);
  }
}

function parapet(g: GeoBuilder, pts: Pt[], top: number, h: number, col: THREE.Color): void {
  for (let i = 0; i < pts.length; i += 1) {
    const a = pts[i];
    const c = pts[(i + 1) % pts.length];
    const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
    if (len < 0.05) continue;
    const n = new THREE.Vector3((c[1] - a[1]) / len, 0, -(c[0] - a[0]) / len);
    const ia = g.vert(new THREE.Vector3(a[0], top, a[1]), n, 0, 0, 0.9, 0, col);
    const ib = g.vert(new THREE.Vector3(a[0], top + h, a[1]), n, 0, h / 3, 1, 0, col);
    const ic = g.vert(new THREE.Vector3(c[0], top + h, c[1]), n, len / 3, h / 3, 1, 0, col);
    const id = g.vert(new THREE.Vector3(c[0], top, c[1]), n, len / 3, 0, 0.9, 0, col);
    g.quad(ia, ib, ic, id);
  }
}

function hipRoof(g: GeoBuilder, r: ReturnType<typeof orientedRect>, top: number, col: THREE.Color): void {
  const L = r.hl + 0.55;
  const W = r.hw + 0.55;
  const rise = Math.min(3.2, W * 0.42);
  const ridge = Math.max(0, L - W);
  const ca = Math.cos(r.angle);
  const sa = Math.sin(r.angle);
  const P = (u: number, v: number, h: number) => new THREE.Vector3(r.cx + u * ca - v * sa, top + h, r.cz + u * sa + v * ca);
  const c00 = P(-L, -W, 0), c10 = P(L, -W, 0), c11 = P(L, W, 0), c01 = P(-L, W, 0);
  const r0 = P(-ridge, 0, rise), r1 = P(ridge, 0, rise);
  const face = (ps: THREE.Vector3[], uvs: [number, number][]) => {
    const n = new THREE.Vector3().subVectors(ps[1], ps[0]).cross(new THREE.Vector3().subVectors(ps[2], ps[0])).normalize();
    let order = ps.map((_, i) => i);
    if (n.y < 0) {
      n.negate();
      order = order.reverse();
    }
    const ids = order.map((i) => g.vert(ps[i], n, uvs[i][0], uvs[i][1], 1, 0, col));
    if (ids.length === 3) g.tri(ids[0], ids[1], ids[2]);
    else g.quad(ids[0], ids[1], ids[2], ids[3]);
  };
  const slope = Math.hypot(W, rise) / 1.5;
  face([c00, c10, r1, r0], [[-L / 1.5, 0], [L / 1.5, 0], [ridge / 1.5, slope], [-ridge / 1.5, slope]]);
  face([c11, c01, r0, r1], [[L / 1.5, 0], [-L / 1.5, 0], [-ridge / 1.5, slope], [ridge / 1.5, slope]]);
  face([c10, c11, r1], [[-W / 1.5, 0], [W / 1.5, 0], [0, slope]]);
  face([c01, c00, r0], [[-W / 1.5, 0], [W / 1.5, 0], [0, slope]]);
}

/** Picks the wall that faces the nearest path, and the spot in front of it. */
function findEntrance(b: BuildingData, ground: CampusGround, floor: number): Entrance {
  let pts = b.pts.slice();
  if (polyArea(pts) < 0) pts = pts.reverse();
  let best: Entrance | null = null;
  let bestScore = Infinity;
  for (let i = 0; i < pts.length; i += 1) {
    const a = pts[i];
    const c = pts[(i + 1) % pts.length];
    const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
    if (len < 3) continue;
    const nx = (c[1] - a[1]) / len;
    const nz = -(c[0] - a[0]) / len;
    const mx = (a[0] + c[0]) / 2;
    const mz = (a[1] + c[1]) / 2;
    const qx = mx + nx * 3;
    const qz = mz + nz * 3;
    let score = nearestPathDist(qx, qz) - Math.min(len, 12) * 0.15;
    const other = buildingAt(qx, qz);
    if (other && other !== b && pointInPoly(qx, qz, other.pts)) score += 100;
    if (ground.classAt(qx, qz) === CLS.building) score += 50;
    if (score < bestScore) {
      bestScore = score;
      best = { x: mx + nx * 2.4, z: mz + nz * 2.4, y: ground.heightAt(mx + nx * 2.4, mz + nz * 2.4), facing: Math.atan2(nx, nz), doorX: mx, doorZ: mz, building: b };
    }
  }
  if (!best) {
    const [cx, cz] = centroid(pts);
    best = { x: cx + 6, z: cz, y: ground.heightAt(cx + 6, cz), facing: Math.PI / 2, doorX: cx, doorZ: cz, building: b };
  }
  best.y = Math.max(best.y, floor - 1.5);
  return best;
}

let pathSegs: [Pt, Pt][] | null = null;
function nearestPath(x: number, z: number): { d: number; ang: number } {
  if (!pathSegs) {
    pathSegs = [];
    for (const l of DATA.lines) {
      if (!['footway', 'path', 'service', 'steps', 'pedestrian', 'residential', 'primary', 'track'].includes(l.kind)) continue;
      for (let i = 0; i < l.pts.length - 1; i += 1) pathSegs.push([l.pts[i], l.pts[i + 1]]);
    }
  }
  let d = Infinity;
  let ang = 0;
  for (const [a, b] of pathSegs) {
    if (Math.abs(a[0] - x) > 80 && Math.abs(b[0] - x) > 80) continue;
    const r = segDist(x, z, a, b);
    if (r.d < d) {
      d = r.d;
      ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    }
  }
  return { d, ang };
}
function nearestPathDist(x: number, z: number): number {
  return nearestPath(x, z).d;
}
/** Yaw that puts an object's long side parallel to the nearest path. */
function pathAngle(x: number, z: number): number {
  return -nearestPath(x, z).ang;
}

function addDoor(group: THREE.Group, e: Entrance, label: string, floor: number, physics: PhysicsWorld): void {
  const yaw = e.facing;
  const fx = Math.sin(yaw);
  const fz = Math.cos(yaw);
  const door = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 2.3), new THREE.MeshStandardMaterial({ color: '#4a3424', roughness: 0.7 }));
  door.position.set(e.doorX + fx * 0.04, floor + 1.15, e.doorZ + fz * 0.04);
  door.rotation.y = yaw;
  group.add(door);
  const frame = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 2.5), new THREE.MeshStandardMaterial({ color: '#2b2722', roughness: 0.8 }));
  frame.position.set(e.doorX + fx * 0.03, floor + 1.25, e.doorZ + fz * 0.03);
  frame.rotation.y = yaw;
  group.add(frame);
  // Entrance step.
  const step = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.5, 1.4), new THREE.MeshStandardMaterial({ color: '#9b968c', roughness: 0.9 }));
  step.position.set(e.doorX + fx * 0.7, floor - 0.2, e.doorZ + fz * 0.7);
  step.rotation.y = yaw;
  step.receiveShadow = true;
  group.add(step);
  physics.addBox({ x: step.position.x, y: step.position.y, z: step.position.z, hx: 1.4, hy: 0.25, hz: 0.7, rotY: yaw });
  if (!label) return;
  const tex = signTexture(
    [
      { text: 'IOE · PASHCHIMANCHAL CAMPUS', size: 30, weight: 600, color: '#f2d27a', gap: 8 },
      { text: label.toUpperCase(), size: label.length > 34 ? 38 : 50, weight: 700, color: '#ffffff' },
    ],
    { w: 1024, h: 200, bg: '#1d3f78', border: '#f2d27a' },
  );
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 0.86), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 }));
  sign.position.set(e.doorX + fx * 0.08, floor + 2.95, e.doorZ + fz * 0.08);
  sign.rotation.y = yaw;
  group.add(sign);
}

// ==================================================================== kit: merged primitives

type KitMat = 'stone' | 'concrete' | 'metal' | 'white' | 'wood' | 'green' | 'bronze' | 'water' | 'red' | 'gold' | 'tank' | 'net' | 'light' | 'brick' | 'blue';

const KIT_COLOURS: Record<KitMat, { color: string; roughness: number; metalness?: number; emissive?: string; transparent?: boolean; opacity?: number }> = {
  stone: { color: '#8f8a80', roughness: 0.92 },
  concrete: { color: '#b3ada2', roughness: 0.9 },
  metal: { color: '#3c3f42', roughness: 0.5, metalness: 0.6 },
  white: { color: '#e8e6df', roughness: 0.6 },
  wood: { color: '#6a4a30', roughness: 0.8 },
  green: { color: '#2f6b3c', roughness: 0.6 },
  bronze: { color: '#6b4f2e', roughness: 0.35, metalness: 0.85 },
  water: { color: '#3d6f84', roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.85 },
  red: { color: '#a8322a', roughness: 0.7 },
  gold: { color: '#c9a03a', roughness: 0.3, metalness: 0.9 },
  tank: { color: '#1d1f22', roughness: 0.5 },
  net: { color: '#e8e8e8', roughness: 0.8, transparent: true, opacity: 0.55 },
  light: { color: '#fff6dc', roughness: 0.4, emissive: '#5a5240' },
  brick: { color: '#9a5a44', roughness: 0.9 },
  blue: { color: '#2d5b9a', roughness: 0.6 },
};

class Kit {
  private buckets = new Map<KitMat, THREE.BufferGeometry[]>();
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();

  add(mat: KitMat, g: THREE.BufferGeometry, x: number, y: number, z: number, ry = 0, rx = 0, rz = 0): void {
    this.e.set(rx, ry, rz, 'YXZ');
    this.q.setFromEuler(this.e);
    this.m.compose(new THREE.Vector3(x, y, z), this.q, new THREE.Vector3(1, 1, 1));
    const geo = g.index ? g.toNonIndexed() : g;
    geo.deleteAttribute('uv');
    geo.applyMatrix4(this.m);
    let list = this.buckets.get(mat);
    if (!list) this.buckets.set(mat, (list = []));
    list.push(geo);
  }

  /** Box resting on y (bottom face at y). */
  box(mat: KitMat, w: number, h: number, d: number, x: number, y: number, z: number, ry = 0): void {
    this.add(mat, new THREE.BoxGeometry(w, h, d), x, y + h / 2, z, ry);
  }

  /** Box placed with a local offset rotated by ry around (x, z). */
  boxAt(mat: KitMat, w: number, h: number, d: number, x: number, y: number, z: number, ry: number, ox: number, oz: number): void {
    const c = Math.cos(ry);
    const s = Math.sin(ry);
    this.box(mat, w, h, d, x + ox * c + oz * s, y, z - ox * s + oz * c, ry);
  }

  cyl(mat: KitMat, r: number, h: number, x: number, y: number, z: number, seg = 8, r2 = r): void {
    this.add(mat, new THREE.CylinderGeometry(r2, r, h, seg), x, y + h / 2, z);
  }

  cone(mat: KitMat, r: number, h: number, x: number, y: number, z: number, seg = 8): void {
    this.add(mat, new THREE.ConeGeometry(r, h, seg), x, y + h / 2, z, Math.PI / seg);
  }

  build(group: THREE.Group): void {
    for (const [mat, list] of this.buckets) {
      const geo = mergeGeometries(list, false);
      if (!geo) continue;
      const c = KIT_COLOURS[mat];
      const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
        color: c.color, roughness: c.roughness, metalness: c.metalness ?? 0, emissive: c.emissive ?? '#000000',
        transparent: c.transparent ?? false, opacity: c.opacity ?? 1, side: mat === 'net' ? THREE.DoubleSide : THREE.FrontSide,
      }));
      m.castShadow = mat !== 'water' && mat !== 'net';
      m.receiveShadow = true;
      m.name = `kit-${mat}`;
      group.add(m);
    }
    this.buckets.clear();
  }
}

// ==================================================================== props

function bench(kit: Kit, x: number, y: number, z: number, ry: number, physics: PhysicsWorld): void {
  kit.boxAt('concrete', 1.8, 0.08, 0.45, x, y + 0.42, z, ry, 0, 0);
  kit.boxAt('concrete', 1.8, 0.4, 0.08, x, y + 0.5, z, ry, 0, -0.22);
  kit.boxAt('concrete', 0.12, 0.42, 0.4, x, y, z, ry, -0.75, 0);
  kit.boxAt('concrete', 0.12, 0.42, 0.4, x, y, z, ry, 0.75, 0);
  physics.addBox({ x, y: y + 0.3, z, hx: 0.9, hy: 0.3, hz: 0.25, rotY: ry });
}

function lamp(kit: Kit, x: number, y: number, z: number, physics: PhysicsWorld): void {
  kit.cyl('metal', 0.07, 5.2, x, y, z, 8, 0.05);
  kit.box('metal', 0.9, 0.06, 0.08, x + 0.4, y + 5.1, z);
  kit.box('light', 0.4, 0.12, 0.22, x + 0.8, y + 4.98, z);
  physics.addCylinder(x, y, z, 1.5, 0.1);
}

function statue(group: THREE.Group, kit: Kit, x: number, y: number, z: number, name: string, physics: PhysicsWorld): void {
  if (/motorbike/i.test(name)) {
    kit.box('stone', 2.6, 0.5, 1.2, x, y, z);
    kit.box('red', 1.6, 0.35, 0.3, x, y + 0.9, z);
    kit.box('metal', 0.5, 0.25, 0.32, x + 0.3, y + 1.2, z);
    for (const s of [-0.75, 0.75]) kit.add('metal', new THREE.TorusGeometry(0.32, 0.08, 6, 14), x + s, y + 0.85, z);
    physics.addBox({ x, y: y + 0.6, z, hx: 1.3, hy: 0.6, hz: 0.6 });
    return;
  }
  if (/sculpture|model|mithila/i.test(name)) {
    kit.box('stone', 1.8, 0.7, 1.8, x, y, z);
    kit.add('concrete', new THREE.TorusKnotGeometry(0.45, 0.16, 48, 8), x, y + 1.5, z);
    physics.addBox({ x, y: y + 0.9, z, hx: 0.9, hy: 0.9, hz: 0.9 });
    return;
  }
  // Memorial bust on a stepped plinth.
  kit.box('stone', 2.4, 0.3, 2.4, x, y, z);
  kit.box('white', 1.3, 1.5, 1.3, x, y + 0.3, z);
  kit.add('bronze', new THREE.CylinderGeometry(0.42, 0.55, 0.55, 14), x, y + 2.08, z);
  kit.add('bronze', new THREE.SphereGeometry(0.27, 14, 10), x, y + 2.62, z);
  kit.add('bronze', new THREE.CylinderGeometry(0.1, 0.12, 0.16, 8), x, y + 2.38, z);
  physics.addBox({ x, y: y + 1.1, z, hx: 1.2, hy: 1.1, hz: 1.2 });
  void group;
}

function fountain(kit: Kit, x: number, y: number, z: number, physics: PhysicsWorld): void {
  kit.cyl('stone', 3.0, 0.6, x, y, z, 24);
  kit.cyl('water', 2.75, 0.04, x, y + 0.58, z, 24);
  kit.cyl('stone', 0.35, 1.6, x, y + 0.6, z, 12);
  kit.cyl('stone', 1.0, 0.18, x, y + 2.1, z, 16, 0.6);
  physics.addCylinder(x, y, z, 0.4, 3.0);
}

function flagpole(group: THREE.Group, kit: Kit, x: number, y: number, z: number, physics: PhysicsWorld): THREE.Mesh {
  kit.box('stone', 1.6, 0.4, 1.6, x, y, z);
  kit.cyl('white', 0.07, 9, x, y + 0.4, z, 8, 0.045);
  kit.add('gold', new THREE.SphereGeometry(0.1, 8, 6), x, y + 9.45, z);
  physics.addCylinder(x, y, z, 4.5, 0.12);
  // Nepal's flag: two stacked pennants, crimson with a blue border, white moon and sun.
  const c = document.createElement('canvas');
  c.width = 400;
  c.height = 490;
  const ctx = c.getContext('2d')!;
  const outline = (inset: number) => {
    ctx.beginPath();
    ctx.moveTo(inset, inset);
    ctx.lineTo(400 - inset * 2.3, 245 - inset * 0.6);
    ctx.lineTo(135 + inset * 0.3, 245 - inset * 0.6);
    ctx.lineTo(400 - inset * 2.3, 490 - inset);
    ctx.lineTo(inset, 490 - inset);
    ctx.closePath();
  };
  outline(0);
  ctx.fillStyle = '#003893';
  ctx.fill();
  outline(16);
  ctx.fillStyle = '#dc143c';
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  const star = (cx: number, cy: number, r1: number, r2: number, n: number) => {
    ctx.beginPath();
    for (let i = 0; i < n * 2; i += 1) {
      const r = i % 2 ? r2 : r1;
      const a = (i / (n * 2)) * Math.PI * 2 - Math.PI / 2;
      ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.fill();
  };
  // Crescent moon with rays (upper pennant), sun (lower pennant).
  ctx.beginPath();
  ctx.arc(110, 130, 48, 0, Math.PI);
  ctx.arc(110, 112, 54, Math.PI * 0.92, Math.PI * 0.08, true);
  ctx.fill();
  star(110, 112, 30, 18, 8);
  star(110, 375, 58, 34, 12);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const geo = new THREE.PlaneGeometry(1.6, 1.96, 16, 4);
  geo.translate(0.8, 0, 0);
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const base = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i += 1) {
    base[i * 3] = pos.getX(i);
    base[i * 3 + 1] = pos.getY(i);
  }
  const flag = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.8, transparent: false }));
  flag.userData.base = base;
  flag.position.set(x + 0.05, y + 8.3, z);
  flag.castShadow = true;
  group.add(flag);
  return flag;
}

function board(group: THREE.Group, kit: Kit, x: number, y: number, z: number, ry: number, physics: PhysicsWorld): void {
  kit.boxAt('metal', 0.08, 2.2, 0.08, x, y, z, ry, -1, 0);
  kit.boxAt('metal', 0.08, 2.2, 0.08, x, y, z, ry, 1, 0);
  const tex = signTexture(
    [
      { text: 'WRC INFORMATION BOARD', size: 44, weight: 700, color: '#ffffff', gap: 18 },
      { text: 'Notices · Exam routine · Results', size: 30, color: '#f2d27a', gap: 10 },
      { text: 'Pashchimanchal Campus, Lamachaur', size: 26, color: '#d8dde6' },
    ],
    { w: 768, h: 420, bg: '#24463a', border: '#c9b98a' },
  );
  const m = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.2, 0.06), [
    new THREE.MeshStandardMaterial({ color: '#2d2a24' }), new THREE.MeshStandardMaterial({ color: '#2d2a24' }),
    new THREE.MeshStandardMaterial({ color: '#2d2a24' }), new THREE.MeshStandardMaterial({ color: '#2d2a24' }),
    new THREE.MeshStandardMaterial({ map: tex }), new THREE.MeshStandardMaterial({ map: tex }),
  ]);
  m.position.set(x, y + 1.6, z);
  m.rotation.y = ry;
  m.castShadow = true;
  group.add(m);
  physics.addBox({ x, y: y + 1.1, z, hx: 1.1, hy: 1.1, hz: 0.1, rotY: ry });
}

function tap(kit: Kit, x: number, y: number, z: number): void {
  kit.box('concrete', 0.9, 0.15, 0.6, x, y, z);
  kit.cyl('metal', 0.04, 0.9, x, y + 0.15, z, 6);
  kit.box('metal', 0.2, 0.04, 0.04, x + 0.08, y + 0.95, z);
}

function waterTower(kit: Kit, x: number, y: number, z: number, physics: PhysicsWorld): void {
  for (const [dx, dz] of [[-1.5, -1.5], [1.5, -1.5], [1.5, 1.5], [-1.5, 1.5]]) kit.box('concrete', 0.35, 9, 0.35, x + dx, y, z + dz);
  kit.cyl('concrete', 2.6, 3.6, x, y + 9, z, 20);
  kit.cone('concrete', 2.7, 0.8, x, y + 12.6, z, 20);
  physics.addCylinder(x, y, z, 6, 2.6);
}

function sports(kit: Kit, ground: CampusGround, physics: PhysicsWorld, pts: Pt[], sport: string, kind: string): void {
  const r = orientedRect(pts);
  const ca = Math.cos(r.angle);
  const sa = Math.sin(r.angle);
  const at = (u: number, v: number) => [r.cx + u * ca - v * sa, r.cz + u * sa + v * ca] as const;
  const ry = -r.angle;
  if (sport === 'basketball') {
    for (const s of [-1, 1]) {
      const [x, z] = at(s * (r.hl - 0.6), 0);
      const y = ground.heightAt(x, z);
      kit.cyl('metal', 0.09, 3.3, x, y, z, 8);
      const [bx, bz] = at(s * (r.hl - 1.5), 0);
      kit.box('white', 0.06, 1.05, 1.8, bx, y + 2.9, bz, ry);
      const [hx, hz] = at(s * (r.hl - 1.85), 0);
      kit.add('red', new THREE.TorusGeometry(0.23, 0.02, 6, 16), hx, y + 3.05, hz, 0, Math.PI / 2);
      physics.addCylinder(x, y, z, 1.7, 0.12);
    }
  } else if (sport === 'soccer' || (kind === 'ground' && r.hl > 25)) {
    if (kind === 'ground' && sport !== 'soccer') return;
    for (const s of [-1, 1]) {
      for (const v of [-3.66, 3.66]) {
        const [x, z] = at(s * (r.hl - 0.9), v);
        kit.cyl('white', 0.06, 2.44, x, ground.heightAt(x, z), z, 8);
        physics.addCylinder(x, ground.heightAt(x, z), z, 1.22, 0.08);
      }
      const [x, z] = at(s * (r.hl - 0.9), 0);
      kit.add('white', new THREE.BoxGeometry(0.1, 0.1, 7.4), x, ground.heightAt(x, z) + 2.44, z, ry);
      const [nx, nz] = at(s * (r.hl - 0.1), 0);
      kit.add('net', new THREE.BoxGeometry(1.6, 2.4, 7.3), nx, ground.heightAt(nx, nz) + 1.2, nz, ry);
    }
  } else if (sport === 'volleyball' || sport === 'tennis') {
    const h = sport === 'volleyball' ? 2.43 : 1.0;
    for (const v of [-1, 1]) {
      const [x, z] = at(0, v * (r.hw - 0.3));
      kit.cyl('metal', 0.05, h + 0.1, x, ground.heightAt(x, z), z, 6);
      physics.addCylinder(x, ground.heightAt(x, z), z, h / 2, 0.08);
    }
    const [x, z] = at(0, 0);
    kit.add('net', new THREE.BoxGeometry(0.02, sport === 'volleyball' ? 1 : 0.9, (r.hw - 0.3) * 2), x, ground.heightAt(x, z) + h - 0.45, z, ry);
  }
}

// ==================================================================== walls and gate

function linearBarrier(kit: Kit, ground: CampusGround, physics: PhysicsWorld, pts: Pt[], kind: 'wall' | 'fence', gaps: { x: number; z: number; r: number }[] = []): void {
  const h = kind === 'wall' ? 1.6 : 1.4;
  for (let i = 0; i < pts.length - 1; i += 1) {
    const a = pts[i];
    const b = pts[i + 1];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const steps = Math.max(1, Math.ceil(len / 3));
    for (let s = 0; s < steps; s += 1) {
      const t0 = s / steps;
      const t1 = (s + 1) / steps;
      const x0 = a[0] + (b[0] - a[0]) * t0, z0 = a[1] + (b[1] - a[1]) * t0;
      const x1 = a[0] + (b[0] - a[0]) * t1, z1 = a[1] + (b[1] - a[1]) * t1;
      const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
      if (gaps.some((g) => Math.hypot(g.x - mx, g.z - mz) < g.r)) continue;
      if (Math.abs(mx) > WORLD_HALF - 4 || Math.abs(mz) > WORLD_HALF - 4) continue;
      const seg = Math.hypot(x1 - x0, z1 - z0);
      const ry = Math.atan2(-(z1 - z0), x1 - x0);
      const y = Math.min(ground.heightAt(x0, z0), ground.heightAt(x1, z1)) - 0.3;
      if (kind === 'wall') {
        kit.box('white', seg + 0.02, h + 0.3, 0.24, mx, y, mz, ry);
        kit.box('brick', seg + 0.04, 0.1, 0.32, mx, y + h + 0.3, mz, ry);
      } else {
        kit.box('metal', 0.07, h + 0.3, 0.07, x0, y, z0, ry);
        for (const hh of [0.45, 0.9, 1.35]) kit.box('metal', seg, 0.03, 0.03, mx, y + 0.3 + hh, mz, ry);
      }
      physics.addBox({ x: mx, y: y + (h + 0.3) / 2, z: mz, hx: seg / 2, hy: (h + 0.3) / 2 + 0.4, hz: 0.18, rotY: ry });
    }
  }
}

/** Boundary wall along the campus outline, open wherever a road or footpath crosses it. */
function boundaryWall(kit: Kit, ground: CampusGround, physics: PhysicsWorld): void {
  const ring = [...DATA.boundary, DATA.boundary[0]];
  const gaps: { x: number; z: number; r: number }[] = [{ x: GATE[0], z: GATE[1], r: 9 }];
  for (const l of DATA.lines) {
    if (!['footway', 'path', 'service', 'steps', 'pedestrian', 'residential', 'track', 'primary'].includes(l.kind)) continue;
    for (let i = 0; i < l.pts.length - 1; i += 1) {
      for (let j = 0; j < ring.length - 1; j += 1) {
        const p = intersect(l.pts[i], l.pts[i + 1], ring[j], ring[j + 1]);
        if (p) gaps.push({ x: p[0], z: p[1], r: Math.max(3.2, l.w * 0.9 + 1.5) });
      }
    }
    // Paths that end right at the boundary.
    for (const e of [l.pts[0], l.pts[l.pts.length - 1]]) {
      for (let j = 0; j < ring.length - 1; j += 1) if (segDist(e[0], e[1], ring[j], ring[j + 1]).d < 2.5) gaps.push({ x: e[0], z: e[1], r: 3.5 });
    }
  }
  linearBarrier(kit, ground, physics, ring, 'wall', gaps);
}

function intersect(a: Pt, b: Pt, c: Pt, d: Pt): Pt | null {
  const r = [b[0] - a[0], b[1] - a[1]];
  const s = [d[0] - c[0], d[1] - c[1]];
  const den = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(den) < 1e-9) return null;
  const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den;
  const u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return [a[0] + r[0] * t, a[1] + r[1] * t];
}

/** The main gate: two pillars and an arch carrying the campus name, over the road from Lamachaur Marg. */
function mainGate(group: THREE.Group, kit: Kit, ground: CampusGround, physics: PhysicsWorld): void {
  // Find the campus road leaving the junction and orient the gate across it.
  let best: { x: number; z: number; ang: number; d: number } | null = null;
  for (const l of DATA.lines) {
    if (l.kind !== 'service' && l.kind !== 'residential' && l.kind !== 'footway') continue;
    for (let i = 0; i < l.pts.length - 1; i += 1) {
      const r = segDist(GATE[0], GATE[1], l.pts[i], l.pts[i + 1]);
      if (!best || r.d < best.d) best = { x: r.px, z: r.pz, ang: Math.atan2(l.pts[i + 1][1] - l.pts[i][1], l.pts[i + 1][0] - l.pts[i][0]), d: r.d };
    }
  }
  const toCentre = Math.atan2(-GATE[1], -GATE[0]);
  const ang = best && best.d < 30 ? best.ang : toCentre;
  const gx = best && best.d < 30 ? (best.x + GATE[0]) / 2 : GATE[0];
  const gz = best && best.d < 30 ? (best.z + GATE[1]) / 2 : GATE[1];
  // Road direction ang; pillars sit either side, across it.
  const px = -Math.sin(ang);
  const pz = Math.cos(ang);
  const span = 4.6;
  const y = ground.heightAt(gx, gz);
  for (const s of [-1, 1]) {
    const x = gx + px * span * s;
    const z = gz + pz * span * s;
    kit.box('brick', 1.1, 5.6, 1.1, x, y - 0.4, z, -ang);
    kit.box('white', 1.4, 0.25, 1.4, x, y + 5.2, z, -ang);
    physics.addBox({ x, y: y + 2.4, z, hx: 0.55, hy: 2.8, hz: 0.55, rotY: -ang });
  }
  kit.box('brick', 0.7, 1.3, span * 2 + 1.1, gx, y + 4.0, gz, -ang);
  const tex = signTexture(
    [
      { text: 'त्रिभुवन विश्वविद्यालय · इन्जिनियरिङ अध्ययन संस्थान', size: 34, color: '#f2d27a', gap: 10 },
      { text: 'INSTITUTE OF ENGINEERING', size: 46, weight: 700, color: '#ffffff', gap: 6 },
      { text: 'PASHCHIMANCHAL CAMPUS · LAMACHAUR, POKHARA', size: 34, weight: 600, color: '#ffffff' },
    ],
    { w: 1400, h: 230, bg: '#7a1f1f', border: '#f2d27a' },
  );
  for (const side of [1, -1]) {
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(span * 2 + 0.8, 1.2), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 }));
    const nx = Math.cos(ang) * side;
    const nz = Math.sin(ang) * side;
    sign.position.set(gx + nx * 0.37, y + 4.65, gz + nz * 0.37);
    sign.rotation.y = Math.atan2(nx, nz);
    group.add(sign);
  }
}

// ==================================================================== trees

function plantTrees(group: THREE.Group, o: WorldOptions, ground: CampusGround, physics: PhysicsWorld): void {
  const { atlas, preset } = o;
  const r = atlas.regions;
  const models: PlantModel[] = [
    broadleaf(411, 11, r.leafA, 'mid'),
    broadleaf(412, 14, r.leafB, 'mid'),
    broadleaf(413, 9, r.leafA, 'mid'),
    broadleaf(414, 16, r.leafB, 'mid'),
    broadleaf(415, 12, r.leafA, 'mid'),
    pine(311, atlas, 17, 'mid'),
    pine(312, atlas, 21, 'mid'),
  ];
  const bushes: PlantModel[] = [bush(431, r.leafA, 1.5), bush(432, r.leafB, 1.1), bush(433, r.leafA, 1.9)];
  const leafMat = foliageMaterial({ map: atlas.texture, name: 'campus-leaves', windScale: 0.3, translucency: 0.5, roughness: 0.7 });
  const leafDepth = foliageDepthMaterial(atlas.texture, 0.42, 0.3);
  const barkB = barkMaterial(o.barkBroad.map, o.barkBroad.normalMap, o.barkBroad.roughnessMap, 0.3, 'campus-bark', 0.4);
  const barkP = barkMaterial(o.barkPine.map, o.barkPine.normalMap, o.barkPine.roughnessMap, 0.22, 'campus-bark-pine', 0.3);

  const rng = mulberry32(1987);
  const trees: { x: number; z: number; m: number; s: number }[] = [];
  const shrubs: { x: number; z: number; m: number; s: number }[] = [];
  const clear = (x: number, z: number, rad: number) => {
    for (const [dx, dz] of [[0, 0], [rad, 0], [-rad, 0], [0, rad], [0, -rad]]) {
      const c = ground.classAt(x + dx, z + dz);
      if (c !== CLS.grass && c !== CLS.soil) return false;
    }
    return true;
  };
  const broad = () => Math.floor(rng() * 5);
  // Mapped trees.
  for (const p of DATA.points) if (p.kind === 'tree' && clear(p.x, p.z, 0.8)) trees.push({ x: p.x, z: p.z, m: broad(), s: range(rng, 0.85, 1.2) });
  const density = preset.vegetationDensity;
  // Parks, lawns and the orchard.
  for (const a of DATA.areas) {
    const per = a.kind === 'park' ? 140 : a.kind === 'orchard' ? 60 : a.kind === 'scrub' ? 50 : a.kind === 'grass' ? 380 : 0;
    if (!per) continue;
    const rect = orientedRect(a.pts);
    const area = Math.abs(polyArea(a.pts));
    const n = Math.round((area / per) * density);
    for (let i = 0; i < n * 3 && n > 0; i += 1) {
      const u = range(rng, -rect.hl, rect.hl);
      const v = range(rng, -rect.hw, rect.hw);
      const x = rect.cx + u * Math.cos(rect.angle) - v * Math.sin(rect.angle);
      const z = rect.cz + u * Math.sin(rect.angle) + v * Math.cos(rect.angle);
      if (!pointInPoly(x, z, a.pts) || !clear(x, z, 2.5)) continue;
      if (a.kind === 'scrub' || (a.kind === 'park' && rng() < 0.4)) shrubs.push({ x, z, m: Math.floor(rng() * bushes.length), s: range(rng, 0.8, 1.4) });
      else trees.push({ x, z, m: a.kind === 'orchard' ? 2 : broad(), s: range(rng, a.kind === 'orchard' ? 0.55 : 0.8, a.kind === 'orchard' ? 0.75 : 1.25) });
      if ((i + 1) / 3 >= n) break;
    }
  }
  // A row of trees just inside the boundary wall.
  const ring = DATA.boundary;
  const [ccx, ccz] = centroid(ring);
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    for (let s = 4; s < len; s += 9 / density) {
      const t = s / len;
      let x = a[0] + (b[0] - a[0]) * t;
      let z = a[1] + (b[1] - a[1]) * t;
      const dx = ccx - x;
      const dz = ccz - z;
      const d = Math.hypot(dx, dz);
      x += (dx / d) * 4;
      z += (dz / d) * 4;
      if (clear(x, z, 2.5) && rng() < 0.75) trees.push({ x, z, m: rng() < 0.25 ? 5 + Math.floor(rng() * 2) : broad(), s: range(rng, 0.9, 1.3) });
    }
  }
  // Shrubs at the foot of campus buildings.
  for (const bd of DATA.buildings) {
    if (!bd.inside) continue;
    for (let i = 0; i < bd.pts.length; i += 1) {
      const a = bd.pts[i];
      const b = bd.pts[(i + 1) % bd.pts.length];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 6) continue;
      for (let s = 2; s < len - 2; s += 4.5) {
        if (rng() > 0.35 * density) continue;
        const t = s / len;
        const [cx, cz] = centroid(bd.pts);
        let x = a[0] + (b[0] - a[0]) * t;
        let z = a[1] + (b[1] - a[1]) * t;
        const dx = x - cx;
        const dz = z - cz;
        const d = Math.hypot(dx, dz) || 1;
        x += (dx / d) * 2.2;
        z += (dz / d) * 2.2;
        if (clear(x, z, 0.6)) shrubs.push({ x, z, m: Math.floor(rng() * bushes.length), s: range(rng, 0.7, 1.1) });
      }
    }
  }
  // Lamachaur beyond the wall: gardens, field edges and hillside trees.
  const outsideN = Math.round(1500 * density);
  for (let i = 0; i < outsideN * 4 && trees.length < 5000; i += 1) {
    const x = range(rng, -WORLD_HALF + 5, WORLD_HALF - 5);
    const z = range(rng, -WORLD_HALF + 5, WORLD_HALF - 5);
    if (pointInPoly(x, z, ring)) continue;
    // Clumped: keep candidates where a coarse noise field is high.
    if (hash2(Math.floor(x / 35), Math.floor(z / 35), 9) < 0.45) continue;
    if (!clear(x, z, 3)) continue;
    trees.push({ x, z, m: rng() < 0.3 ? 5 + Math.floor(rng() * 2) : broad(), s: range(rng, 0.8, 1.35) });
  }

  // Instanced meshes per model part.
  const dummy = new THREE.Object3D();
  const col = new THREE.Color();
  const place = (list: { x: number; z: number; m: number; s: number }[], ms: PlantModel[], collide: boolean) => {
    ms.forEach((model, mi) => {
      const mine = list.filter((t) => t.m === mi);
      if (!mine.length) return;
      const parts: [THREE.BufferGeometry, THREE.Material, THREE.Material | null][] = [];
      if (model.bark) parts.push([model.bark.build(), model.kind === 'pine' ? barkP : barkB, null]);
      if (model.foliage) parts.push([model.foliage.build(), leafMat, leafDepth]);
      for (const [geo, mat, depth] of parts) {
        const mesh = new THREE.InstancedMesh(geo, mat, mine.length);
        mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(mine.length * 3), 3);
        mine.forEach((t, i) => {
          dummy.position.set(t.x, ground.heightAt(t.x, t.z) - 0.05, t.z);
          dummy.rotation.set(0, hash2(t.x * 7, t.z * 7, 4) * Math.PI * 2, 0);
          dummy.scale.setScalar(t.s);
          dummy.updateMatrix();
          mesh.setMatrixAt(i, dummy.matrix);
          const v = 0.86 + hash2(t.x, t.z, 6) * 0.26;
          col.setRGB(v, v * (0.97 + hash2(t.z, t.x, 8) * 0.06), v * 0.92);
          mesh.setColorAt(i, col);
        });
        mesh.castShadow = preset.shadows;
        mesh.receiveShadow = true;
        mesh.frustumCulled = false;
        if (depth) mesh.customDepthMaterial = depth;
        group.add(mesh);
      }
      if (collide && model.trunkRadius > 0) {
        for (const t of mine) physics.tag(physics.addCylinder(t.x, ground.heightAt(t.x, t.z) - 0.2, t.z, 1.8, model.trunkRadius * t.s + 0.05), 'wood');
      }
    });
  };
  place(trees, models, true);
  place(shrubs, bushes, false);
}

// ==================================================================== mountains

/**
 * The view north from Lamachaur: green foothills, then the snow wall of the Annapurna
 * range with the fishtail summit of Machhapuchhre almost due north-north-east. Drawn as a
 * camera-centred ring inside the sky dome, with its own aerial-perspective colouring.
 */
function mountains(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'backdrop';
  // Bearings are degrees clockwise from north; heights are metres at radius R (angle ≈ h / R).
  const R = 940;
  const peaks: { b: number; h: number; w: number; sharp?: number }[] = [
    { b: -62, h: 150, w: 10 }, // Dhaulagiri, far to the west-north-west
    { b: -38, h: 140, w: 9 },
    { b: -18, h: 168, w: 7 }, // Annapurna South
    { b: -11, h: 150, w: 6 }, // Hiunchuli
    { b: -2, h: 178, w: 7 }, // Annapurna I behind
    { b: 9, h: 205, w: 3.2, sharp: 2.4 }, // Machhapuchhre
    { b: 12, h: 190, w: 2.4, sharp: 2.4 }, // its second "fish tail" summit
    { b: 24, h: 172, w: 8 }, // Annapurna IV / II
    { b: 34, h: 182, w: 7 },
    { b: 52, h: 150, w: 9 }, // Lamjung Himal
    { b: 72, h: 140, w: 10 }, // Manaslu, faint in the east
  ];
  const ridge = (deg: number) => {
    let h = 0;
    for (const p of peaks) {
      const d = Math.abs(deg - p.b) / p.w;
      h = Math.max(h, p.h * Math.exp(-Math.pow(d, p.sharp ?? 1.4)));
    }
    const rough = Math.sin(deg * 1.7) * 6 + Math.sin(deg * 4.3 + 1) * 4 + Math.sin(deg * 9.1) * 2.5;
    return Math.max(0, h + rough * (h / 180));
  };
  const foot = (deg: number) => 52 + Math.sin(deg * 0.09 + 0.6) * 16 + Math.sin(deg * 0.31) * 8 + Math.sin(deg * 1.1) * 3;

  const strip = (fn: (deg: number) => number, radius: number, rows: number, colour: (t: number, h: number, deg: number) => THREE.Color, from: number, to: number, step: number) => {
    const cols = Math.round((to - from) / step) + 1;
    const pos: number[] = [];
    const cl: number[] = [];
    const idx: number[] = [];
    for (let i = 0; i < cols; i += 1) {
      const deg = from + i * step;
      const a = (deg * Math.PI) / 180;
      const top = fn(deg);
      for (let j = 0; j <= rows; j += 1) {
        const t = j / rows;
        const y = -40 + (top + 40) * t;
        // North is -z; bearings run clockwise (east = +x).
        pos.push(Math.sin(a) * radius, y, -Math.cos(a) * radius);
        const c = colour(t, top, deg);
        cl.push(c.r, c.g, c.b);
      }
    }
    for (let i = 0; i < cols - 1; i += 1) {
      for (let j = 0; j < rows; j += 1) {
        const a = i * (rows + 1) + j;
        const b = a + rows + 1;
        idx.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(cl, 3));
    geo.setIndex(idx);
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, side: THREE.DoubleSide }));
    m.frustumCulled = false;
    return m;
  };
  const haze = new THREE.Color('#b9c8d3');
  const snow = new THREE.Color('#f4f6fa');
  const rock = new THREE.Color('#7f8a99');
  const himal = strip(ridge, R, 14, (t, h, deg) => {
    const y = -40 + (h + 40) * t;
    const snowLine = 70 + Math.sin(deg * 2.3) * 10;
    const c = rock.clone().lerp(snow, THREE.MathUtils.smoothstep(y, snowLine - 10, snowLine + 25));
    // Shadowed couloirs on the west faces.
    const shade = 0.88 + 0.12 * Math.sin(deg * 6.1 + t * 3);
    c.multiplyScalar(shade);
    return c.lerp(haze, 0.35 + (1 - t) * 0.35);
  }, -90, 90, 0.5);
  himal.renderOrder = -2;
  g.add(himal);
  const hills = strip(foot, R - 30, 4, (t) => new THREE.Color('#3f5a3a').lerp(new THREE.Color('#7f9a8c'), 0.45 - t * 0.2), -180, 180, 2);
  hills.renderOrder = -1;
  g.add(hills);
  return g;
}
