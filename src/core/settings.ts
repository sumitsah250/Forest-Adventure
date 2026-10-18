// Player-facing settings with graphics presets. Persisted per browser.

export type Quality = 'low' | 'medium' | 'high';

export interface GraphicsPreset {
  pixelRatio: number;
  antialias: boolean;
  shadows: boolean;
  shadowMapSize: number;
  shadowRange: number;
  textureSize: number;
  terrainLow: boolean;
  /** Fraction of trees and ground cover placed. */
  vegetationDensity: number;
  /** Full-detail tree radius in metres. */
  treeNear: number;
  /** Radius of the close-up ("hero") tree models with woody limbs, roots and dead branches. */
  treeHero: number;
  /** Impostor tree radius in metres. */
  treeFar: number;
  groundCoverRange: number;
  ambientOcclusion: boolean;
  grading: boolean;
  headlightShadows: boolean;
}

export const PRESETS: Record<Quality, GraphicsPreset> = {
  low: {
    pixelRatio: 0.75,
    antialias: false,
    shadows: true,
    shadowMapSize: 1024,
    shadowRange: 45,
    textureSize: 512,
    terrainLow: true,
    vegetationDensity: 0.62,
    treeNear: 38,
    treeHero: 14,
    treeFar: 230,
    groundCoverRange: 34,
    ambientOcclusion: false,
    grading: false,
    headlightShadows: false,
  },
  medium: {
    pixelRatio: 1,
    antialias: true,
    shadows: true,
    shadowMapSize: 2048,
    shadowRange: 65,
    textureSize: 1024,
    terrainLow: false,
    vegetationDensity: 0.85,
    treeNear: 55,
    treeHero: 20,
    treeFar: 300,
    groundCoverRange: 52,
    ambientOcclusion: false,
    grading: true,
    headlightShadows: false,
  },
  high: {
    pixelRatio: 1.5,
    antialias: true,
    shadows: true,
    shadowMapSize: 4096,
    shadowRange: 85,
    textureSize: 1024,
    terrainLow: false,
    vegetationDensity: 1,
    treeNear: 80,
    treeHero: 34,
    treeFar: 420,
    groundCoverRange: 66,
    ambientOcclusion: true,
    grading: true,
    headlightShadows: true,
  },
};

export interface Settings {
  quality: Quality;
  mouseSensitivity: number;
  invertY: boolean;
  fov: number;
  masterVolume: number;
  showFps: boolean;
}

const KEY = 'hollow-creek.settings.v1';

const DEFAULTS: Settings = {
  quality: 'medium',
  mouseSensitivity: 1,
  invertY: false,
  fov: 68,
  masterVolume: 0.8,
  showFps: false,
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    // Storage unavailable (private mode); fall back to defaults.
  }
  return { ...DEFAULTS, quality: detectQuality() };
}

/**
 * First-run default: integrated and mobile GPUs start on Low (measured ~10-15 ms at
 * 720p on Intel Iris Xe; Medium is ~25-28 ms there), discrete GPUs on Medium.
 */
export function detectQuality(): Quality {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return 'low';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    if (/intel|uhd|iris|mali|adreno|powervr|apple gpu|radeon\(tm\) graphics|vega \d|swiftshader|llvmpipe/i.test(name)) return 'low';
    return 'medium';
  } catch {
    return 'medium';
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Ignore: settings still apply for this session.
  }
}

/** Allows forcing a preset from the URL, e.g. ?quality=low (used by tests). */
export function qualityOverride(): Quality | null {
  const q = new URLSearchParams(location.search).get('quality');
  return q === 'low' || q === 'medium' || q === 'high' ? q : null;
}
