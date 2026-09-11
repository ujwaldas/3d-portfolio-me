import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Component, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import * as THREE from "three";
import type { LayoutMode } from "../hooks/useMedia";
import { buildConstellation, buildStarfield, loadImage, sampleFace, type FaceSample } from "./sampleFace";

const dbg =
  typeof location !== "undefined" && new URLSearchParams(location.search).has("debugPortrait");
const dbgLogged = new Set<string>();
function dbgOnce(key: string, fn: () => void) {
  if (!dbg || dbgLogged.has(key)) return;
  dbgLogged.add(key);
  fn();
}

export interface PortraitDebugInfo {
  mode?: string;
  mq1024?: boolean;
  mq768?: boolean;
  innerW?: number;
  innerH?: number;
  vvW?: number;
  vvH?: number;
  dpr?: number;
  wrapperRect?: string;
  canvasBuffer?: string;
  canvasCss?: string;
  tier?: string;
  cores?: number;
  mem?: number;
  counts?: string;
  image?: string;
  sample?: string;
  pointSizeRange?: string;
  glDpr?: number;
  contextLost?: boolean;
  error?: string;
}

/**
 * <ParticlePortrait src={...} />
 *
 * Image-agnostic "photograph materialising from a constellation".
 *
 *   src → loadImage → offscreen canvas → alpha mask (fallback: background key)
 *       → distance-transform depth + star colour remap → BufferGeometry → THREE.Points
 *
 * Coherence guarantees (the "one object" rules):
 *   • every portrait particle lives in ONE BufferGeometry inside ONE THREE.Group;
 *   • rotation / translation / uniform scale are applied to that group only – never per part;
 *   • the vertex shader applies no depth- or position-dependent displacement to portrait
 *     layers (breathing is a uniform scale; parallax comes from the group tilt + camera);
 *   • x/y are normalised with a single scale (aspect preserved); z is one continuous function;
 *   • camera aspect, canvas size and DPR are managed by react-three-fiber's ResizeObserver,
 *     and all size-dependent uniforms are recomputed from the same `size`/`dpr` values.
 *
 * Changing `src` disposes the previous geometries, regenerates the cloud and replays the intro.
 */

/* ----------------------------- tunables ---------------------------------- */
const FOV = 30; // long lens: less perspective distortion across the portrait's depth
const BASE_Z = 7;
const SPREAD = 0.55; // intro/outro dispersion in silhouette-height units ("slightly dispersed")

export type Quality = "auto" | "high" | "low";
interface Counts { face: number; spray: number; hero: number; escape: number; near: number; stars: number; nebula: boolean }

/** Particle budgets per breakpoint × device tier (THREE.Points handles these at 60 fps). */
const COUNTS: Record<LayoutMode, { high: Counts; low: Counts }> = {
  desktop: {
    high: { face: 60000, spray: 2400, hero: 34, escape: 240, near: 90, stars: 1400, nebula: true },
    low: { face: 32000, spray: 1400, hero: 28, escape: 160, near: 70, stars: 900, nebula: true },
  },
  tablet: {
    high: { face: 30000, spray: 1500, hero: 26, escape: 140, near: 70, stars: 900, nebula: true },
    low: { face: 18000, spray: 900, hero: 20, escape: 100, near: 50, stars: 600, nebula: false },
  },
  mobile: {
    high: { face: 14000, spray: 700, hero: 16, escape: 80, near: 40, stars: 500, nebula: true },
    low: { face: 8000, spray: 400, hero: 12, escape: 50, near: 30, stars: 320, nebula: false },
  },
};

function detectTier(): "high" | "low" {
  if (typeof navigator === "undefined") return "high";
  const nav = navigator as Navigator & { deviceMemory?: number };
  const cores = nav.hardwareConcurrency ?? 4;
  const mem = nav.deviceMemory ?? 8;
  return cores <= 4 || mem <= 4 ? "low" : "high";
}

/* ----------------------------- shaders ----------------------------------- */
const pointVert = /* glsl */ `
  uniform float uTime;
  uniform float uSize;
  uniform float uPixelRatio;
  uniform float uScatter;
  uniform float uSpread;
  uniform float uFlow;
  uniform float uDrift;
  uniform float uTwinkle;
  uniform float uOrbit;
  uniform float uBreath;
  uniform float uParallax;
  uniform float uFocus;
  uniform float uDof;
  uniform float uSizeGrow;
  uniform float uMaxPointSize;
  uniform vec2 uMouse;
  attribute vec3 aColor;
  attribute float aSize;
  attribute float aAlpha;
  attribute float aSeed;
  attribute float aBright;
  #ifdef USE_SCATTER
  attribute vec3 aScatter;
  #endif
  varying vec3 vColor;
  varying float vAlpha;
  varying float vBlur;
  varying float vBright;
  void main() {
    vColor = aColor;
    vBright = aBright;
    float alpha = aAlpha;
    vec3 p = position;

    // idle: tiny per-particle float; breathing is a UNIFORM scale (rigid – no shearing)
    float t = uTime * 0.7 + aSeed * 6.2831853;
    p += vec3(sin(t), cos(t * 1.31), sin(t * 0.73)) * (0.0045 + uDrift);
    p *= 1.0 + uBreath * sin(uTime * 0.55);

    #ifdef USE_SCATTER
    // materialise from dispersed stars (intro) / disperse (scroll end)
    float s = uScatter * uScatter;
    p += aScatter * s * uSpread;
    alpha *= 1.0 - 0.85 * uScatter;
    #ifdef USE_ORBIT
    // drift outward along the travel vector, then return
    float o = 0.5 - 0.5 * cos(uTime * (0.22 + 0.38 * aSeed) + aSeed * 6.2831853);
    o = o * o;
    p += aScatter * o * uOrbit;
    alpha *= 1.0 - 0.65 * o;
    #endif
    // late-scroll: travel toward / past the camera
    p += aScatter * uFlow * (0.6 + aSeed) * 1.2;
    p.z += uFlow * (1.5 + aSeed * 2.5);
    #endif

    // depth-weighted parallax – only used by the world-space starfield (0 for portrait layers)
    p.xy += uMouse * uParallax * (0.35 + p.z);

    float tw = 0.5 + 0.5 * sin(uTime * (1.1 + 1.3 * fract(aSeed * 13.7)) + aSeed * 40.0);
    alpha *= mix(1.0, 0.55 + 0.45 * tw, uTwinkle);

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    float dist = -mv.z;
    float blur = clamp(abs(dist - uFocus) * uDof, 0.0, 1.0);
    vBlur = blur;
    vAlpha = alpha * (1.0 - 0.5 * blur);
    float computedSize = aSize * uSize * uPixelRatio * (1.0 + uSizeGrow * blur) / max(0.1, dist);
    float ptMax = min(uMaxPointSize, 64.0);
    float ptMin = min(1.75, ptMax);
    gl_PointSize = clamp(computedSize, ptMin, ptMax);
    gl_Position = projectionMatrix * mv;
  }
`;

// star sprite: luminous gaussian core + wide soft halo (+ 4-point diffraction flare on bright stars)
const pointFrag = /* glsl */ `
  uniform float uOpacity;
  uniform float uHalo;
  uniform float uCoreR;
  uniform float uSpike;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vBlur;
  varying float vBright;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d2 = dot(c, c);
    if (d2 > 0.25) discard;
    float d = sqrt(d2);
    float coreR = uCoreR + 0.17 * vBlur;
    float core = exp(-2.0 * d2 / (coreR * coreR));
    float halo = exp(-0.9 * d2 / 0.0484);
    float spikes = 0.0;
    if (uSpike > 0.0 && vBright > 0.5) {
      float k = 9.0 / uSpike;
      spikes = 0.6 * (exp(-abs(c.x) * k) * exp(-c.y * c.y * 260.0) + exp(-abs(c.y) * k) * exp(-c.x * c.x * 260.0));
    }
    float a = (core + uHalo * halo * (1.0 - 0.5 * vBlur) + spikes) * smoothstep(0.5, 0.42, d);
    a *= vAlpha * uOpacity;
    if (a < 0.002) discard;
    gl_FragColor = vec4(vColor, a);
  }
`;

/* nebula: procedural fbm clouds on a far plane, additive & very subtle */
const nebulaVert = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const nebulaFrag = /* glsl */ `
  uniform float uTime;
  uniform float uAspect;
  uniform float uIntensity;
  uniform vec2 uMouse;
  varying vec2 vUv;
  float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 3; i++) { v += a * noise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
    return v;
  }
  void main() {
    vec2 uv = (vUv - 0.5) * vec2(uAspect, 1.0) - uMouse * 0.03;
    float t = uTime * 0.012;
    float n = fbm(uv * 1.5 + vec2(t, -t * 0.7));
    float n2 = fbm(uv * 3.0 - vec2(t * 0.5, t * 0.3) + n * 1.2);
    float cloud = smoothstep(0.32, 0.85, n * 0.6 + n2 * 0.5);
    float warmMix = smoothstep(0.55, 0.9, noise(uv * 0.8 + 3.0)) * 0.5;
    vec3 col = mix(vec3(0.15, 0.32, 0.72), vec3(0.62, 0.42, 0.24), warmMix) * cloud;
    float vig = 1.0 - smoothstep(0.32, 0.72, length(vUv - 0.5));
    gl_FragColor = vec4(col * uIntensity * vig, 1.0);
  }
`;

const lineVert = /* glsl */ `
  uniform float uTime;
  attribute vec3 aLineColor;
  attribute float aPhase;
  varying vec3 vColor;
  varying float vA;
  void main() {
    vColor = aLineColor;
    float w = sin(uTime * (0.3 + 0.5 * fract(aPhase * 7.13)) + aPhase * 6.2831853);
    vA = 0.25 + 0.75 * smoothstep(-0.35, 0.55, w);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const lineFrag = /* glsl */ `
  uniform float uOpacity;
  varying vec3 vColor;
  varying float vA;
  void main() {
    gl_FragColor = vec4(vColor, vA * uOpacity);
  }
`;

function makePointMaterial(opts: { scatter: boolean; orbit?: boolean; twinkle: number; halo: number; spike?: number }) {
  const defines: Record<string, string> = {};
  if (opts.scatter) defines.USE_SCATTER = "";
  if (opts.orbit) defines.USE_ORBIT = "";
  return new THREE.ShaderMaterial({
    vertexShader: pointVert,
    fragmentShader: pointFrag,
    defines,
    uniforms: {
      uTime: { value: 0 },
      uSize: { value: 30 },
      uPixelRatio: { value: 1 },
      uScatter: { value: 1 },
      uSpread: { value: SPREAD },
      uFlow: { value: 0 },
      uDrift: { value: 0 },
      uTwinkle: { value: opts.twinkle },
      uOrbit: { value: 0 },
      uBreath: { value: 0 },
      uParallax: { value: 0 },
      uFocus: { value: BASE_Z },
      uDof: { value: 0 },
      uSizeGrow: { value: 0 },
      uMaxPointSize: { value: 64 },
      uMouse: { value: new THREE.Vector2() },
      uOpacity: { value: 0 },
      uHalo: { value: opts.halo },
      uCoreR: { value: 0.16 },
      uSpike: { value: opts.spike ?? 0 },
    },
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending, // light accumulates → luminous, not painted dots
  });
}

function makeNebulaMaterial() {
  return new THREE.ShaderMaterial({
    vertexShader: nebulaVert,
    fragmentShader: nebulaFrag,
    uniforms: { uTime: { value: 0 }, uAspect: { value: 1 }, uIntensity: { value: 0 }, uMouse: { value: new THREE.Vector2() } },
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
  });
}
const NEBULA_Z = -9;

function makeLineMaterial() {
  return new THREE.ShaderMaterial({
    vertexShader: lineVert,
    fragmentShader: lineFrag,
    uniforms: { uTime: { value: 0 }, uOpacity: { value: 0 } },
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
  });
}

function makePointGeometry(d: {
  positions: Float32Array;
  colors?: Float32Array;
  sizes: Float32Array;
  alphas: Float32Array;
  seeds: Float32Array;
  scatter?: Float32Array;
  bright?: Float32Array;
  color?: [number, number, number];
}) {
  const g = new THREE.BufferGeometry();
  const n = d.sizes.length;
  g.setAttribute("position", new THREE.BufferAttribute(d.positions, 3));
  let colors = d.colors;
  if (!colors) {
    colors = new Float32Array(n * 3);
    const [r, gg, b] = d.color ?? [0.8, 0.9, 1];
    for (let i = 0; i < n; i++) {
      colors[i * 3] = r;
      colors[i * 3 + 1] = gg;
      colors[i * 3 + 2] = b;
    }
  }
  g.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));
  g.setAttribute("aSize", new THREE.BufferAttribute(d.sizes, 1));
  g.setAttribute("aAlpha", new THREE.BufferAttribute(d.alphas, 1));
  g.setAttribute("aSeed", new THREE.BufferAttribute(d.seeds, 1));
  g.setAttribute("aBright", new THREE.BufferAttribute(d.bright ?? new Float32Array(n), 1));
  if (d.scatter) g.setAttribute("aScatter", new THREE.BufferAttribute(d.scatter, 3));
  g.computeBoundingSphere();
  return g;
}

/* ----------------------------- helpers ----------------------------------- */
const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const easeOutCubic = (x: number) => 1 - Math.pow(1 - x, 3);
const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Portrait placement in world units, derived from the camera frustum at BASE_Z (aspect-safe). */
function computeLayout(width: number, height: number, aspect: number, mode: LayoutMode) {
  const w = Math.max(width, 2);
  const h = Math.max(height, 2);
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 0.75;
  const vh = 2 * BASE_Z * Math.tan((FOV * Math.PI) / 360);
  const vw = vh * (w / h);
  if (mode === "desktop") {
    const s = Math.min(0.8 * vh, (0.44 * vw) / safeAspect);
    return { scale: s, x: 0.24 * vw, y: -0.04 * vh, vh, vw };
  }
  if (mode === "tablet") {
    const s = Math.min(0.64 * vh, (0.5 * vw) / safeAspect);
    return { scale: s, x: 0.24 * vw, y: 0, vh, vw };
  }
  const s = Math.max(0.34 * vh, Math.min(0.46 * vh, (0.88 * vw) / safeAspect));
  const halfH = s * 0.5;
  const margin = 0.02 * vh;
  let y = 0.19 * vh;
  y = Math.min(y, vh * 0.5 - halfH - margin);
  y = Math.max(y, -vh * 0.5 + halfH + margin);
  return { scale: s, x: 0, y, vh, vw };
}

function resolveLayoutMode(): LayoutMode {
  if (typeof window === "undefined") return "desktop";
  const desktop = window.matchMedia("(min-width: 1024px)").matches;
  const tablet = window.matchMedia("(min-width: 768px)").matches;
  return desktop ? "desktop" : tablet ? "tablet" : "mobile";
}

function readMaxPointSize(gl: THREE.WebGLRenderer): number {
  const ctx = gl.getContext() as WebGLRenderingContext;
  const range = ctx.getParameter(ctx.ALIASED_POINT_SIZE_RANGE) as number[] | Float32Array;
  const max = Array.isArray(range) || range instanceof Float32Array ? range[1] : 64;
  return Number.isFinite(max) ? Math.min(max, 64) : 64;
}

function sampleFaceWithRetry(
  img: HTMLImageElement,
  opts: { count: number; maxSize: number; anchorCount: number; maxSourcePixels?: number },
) {
  try {
    return sampleFace(img, opts);
  } catch (first) {
    console.warn("[ParticlePortrait] sampleFace retry at 40% / 256px", first);
    return sampleFace(img, {
      count: Math.max(2000, Math.floor(opts.count * 0.4)),
      maxSize: 256,
      maxSourcePixels: 1_500_000,
      anchorCount: Math.max(30, Math.floor(opts.anchorCount * 0.5)),
    });
  }
}

function analysisMaxSize(mode: LayoutMode, faceCount: number, touchLayout: boolean): number {
  if (touchLayout || mode === "mobile") return 320;
  if (faceCount >= 40000) return 720;
  if (faceCount >= 20000) return 640;
  return 560;
}

function readViewportSize() {
  const vv = window.visualViewport;
  return {
    w: Math.max(vv?.width ?? window.innerWidth, 2),
    h: Math.max(vv?.height ?? window.innerHeight, 2),
  };
}

function safeDeviceDpr(touchLayout: boolean, mode: LayoutMode): number | [number, number] {
  if (touchLayout || mode === "mobile") {
    if (typeof window === "undefined") return 1;
    const raw = window.devicePixelRatio;
    const dpr = Number.isFinite(raw) && raw > 0 ? raw : 1;
    return Math.min(Math.max(dpr, 1), 2);
  }
  if (typeof window === "undefined") return [1, 1.75];
  return [1, 1.75];
}

/** Keep R3F size + camera aspect aligned with the host (fixes 0×0 canvas on iOS). */
function HostCanvasSync({ hostRef }: { hostRef: RefObject<HTMLDivElement | null> }) {
  const setSize = useThree((s) => s.setSize);
  const invalidate = useThree((s) => s.invalidate);
  const camera = useThree((s) => s.camera);
  const lastSize = useRef({ w: 0, h: 0 });
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const sync = () => {
      const rect = host.getBoundingClientRect();
      const vp = readViewportSize();
      const w = Math.round(rect.width >= 2 ? rect.width : vp.w);
      const h = Math.round(rect.height >= 2 ? rect.height : vp.h);
      if (w < 2 || h < 2) return;

      const last = lastSize.current;
      if (Math.abs(last.w - w) > 1 || Math.abs(last.h - h) > 1) {
        lastSize.current = { w, h };
        setSize(w, h);
      }

      const cam = camera as THREE.PerspectiveCamera;
      if (cam.isPerspectiveCamera) {
        const aspect = w / h;
        if (Math.abs(cam.aspect - aspect) > 0.001) {
          cam.aspect = aspect;
          cam.updateProjectionMatrix();
        }
      }

      invalidate();
    };

    const scheduleSync = (delayMs = 0) => {
      if (syncTimer.current) clearTimeout(syncTimer.current);
      syncTimer.current = setTimeout(() => {
        syncTimer.current = null;
        requestAnimationFrame(() => requestAnimationFrame(sync));
      }, delayMs);
    };

    sync();
    for (const delay of [50, 150, 350, 800]) scheduleSync(delay);

    const ro = new ResizeObserver(() => scheduleSync(0));
    ro.observe(host);
    const vv = window.visualViewport;
    const onViewportChange = () => scheduleSync(80);
    vv?.addEventListener("resize", onViewportChange);
    window.addEventListener("orientationchange", () => {
      lastSize.current = { w: 0, h: 0 };
      scheduleSync(150);
    });
    return () => {
      if (syncTimer.current) clearTimeout(syncTimer.current);
      ro.disconnect();
      vv?.removeEventListener("resize", onViewportChange);
    };
  }, [hostRef, setSize, camera, invalidate]);

  return null;
}

/* ----------------------------- scene ------------------------------------- */
interface SceneProps {
  src: string;
  progressRef?: RefObject<number>;
  mode: LayoutMode;
  touchLayout: boolean;
  reducedMotion: boolean;
  mouseEnabled: boolean;
  counts: Counts;
  onReady?: (info: { points: number }) => void;
  onError?: (err: unknown) => void;
  onIntroComplete?: () => void;
  onFirstFrame?: () => void;
  onDebugUpdate?: (patch: Partial<PortraitDebugInfo>) => void;
}

function Scene({
  src,
  progressRef,
  mode,
  touchLayout,
  reducedMotion,
  mouseEnabled,
  counts,
  onReady,
  onError,
  onIntroComplete,
  onFirstFrame,
  onDebugUpdate,
}: SceneProps) {
  const size = useThree((s) => s.size);
  const rawDpr = useThree((s) => s.viewport.dpr);
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const [domSize, setDomSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const el = gl.domElement;
    const measure = () => {
      const r = el.getBoundingClientRect();
      const w = Math.round(Math.max(r.width, el.clientWidth, 0));
      const h = Math.round(Math.max(r.height, el.clientHeight, 0));
      if (w >= 2 && h >= 2) setDomSize({ w, h });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.visualViewport?.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.visualViewport?.removeEventListener("resize", measure);
    };
  }, [gl]);

  const canvasW = Math.max(size.width, domSize.w, gl.domElement.clientWidth, 2);
  const canvasH = Math.max(size.height, domSize.h, gl.domElement.clientHeight, 2);
  const rendererDpr = Math.max(gl.getPixelRatio() || 1, 1);
  const dpr = Math.min(
    Math.max(Number.isFinite(rawDpr) && rawDpr > 0 ? rawDpr : rendererDpr, 1),
    touchLayout ? 2 : 1.75,
  );
  const maxPointSize = useMemo(() => readMaxPointSize(gl), [gl]);
  const firstFrameDone = useRef(false);
  const introDone = useRef(false);

  const [sample, setSample] = useState<FaceSample | null>(null);
  const instantIntro = reducedMotion || touchLayout;
  const st = useRef({ rotY: 0, rotX: 0, mx: 0, my: 0, intro: instantIntro ? 1 : 0 });

  useEffect(() => {
    if (instantIntro) st.current.intro = 1;
  }, [instantIntro, sample]);

  /* image → point cloud (re-runs whenever `src` or the particle budget changes) */
  useEffect(() => {
    let cancelled = false;
    setSample(null);
    st.current.intro = instantIntro ? 1 : 0;
    const anchorCount = mode === "mobile" ? 60 : 110;
    const maxSize = analysisMaxSize(mode, counts.face, touchLayout);
    loadImage(src)
      .then((img) => {
        if (cancelled) return;
        dbgOnce("image", () => {
          console.info("[ParticlePortrait:debug] image loaded", img.naturalWidth, img.naturalHeight, src);
          onDebugUpdate?.({ image: `${img.naturalWidth}x${img.naturalHeight} @ ${src}` });
        });
        try {
          const s = sampleFaceWithRetry(img, {
            count: counts.face,
            maxSize,
            anchorCount,
            maxSourcePixels: touchLayout ? 2_000_000 : undefined,
          });
          console.info(
            `[ParticlePortrait] ${src.split("/").pop()} → points=${s.count} bg=${s.bgMode} mask=${s.debug.maskPixels}px analysis=${s.debug.analysisSize.join("x")} aspect=${s.aspect.toFixed(3)} bottomCut=${s.debug.bottomCut} z=[${s.debug.zRange.map((v) => v.toFixed(3)).join(", ")}]`,
          );
          dbgOnce("sample", () => {
            console.info("[ParticlePortrait:debug] sampleFace ok", s.count, s.bgMode, s.debug.analysisSize);
            onDebugUpdate?.({
              sample: `points=${s.count} bg=${s.bgMode} analysis=${s.debug.analysisSize.join("x")}`,
            });
          });
          setSample(s);
          onReady?.({ points: s.count });
        } catch (err) {
          dbgOnce("sampleErr", () => {
            console.error("[ParticlePortrait:debug] sampleFace threw", err);
            onDebugUpdate?.({ sample: `ERROR: ${String(err)}` });
          });
          onError?.(err);
        }
      })
      .catch((err) => {
        dbgOnce("imageErr", () => {
          console.error("[ParticlePortrait:debug] image load failed", err);
          onDebugUpdate?.({ image: `ERROR: ${String(err)}` });
        });
        onError?.(err);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, counts.face, mode]);

  /* geometries (disposed on change) ---------------------------------------- */
  const faceGeom = useMemo(() => (sample ? makePointGeometry(sample) : null), [sample]);
  const constellation = useMemo(
    () =>
      sample
        ? buildConstellation(sample, { spray: counts.spray, hero: counts.hero, escape: counts.escape, near: counts.near })
        : null,
    [sample, counts.spray, counts.hero, counts.escape, counts.near],
  );
  const sprayGeom = useMemo(() => (constellation ? makePointGeometry(constellation.spray) : null), [constellation]);
  const heroGeom = useMemo(() => (constellation ? makePointGeometry(constellation.hero) : null), [constellation]);
  const escapeGeom = useMemo(() => (constellation ? makePointGeometry(constellation.escape) : null), [constellation]);
  const nearGeom = useMemo(() => (constellation ? makePointGeometry(constellation.stars) : null), [constellation]);
  const nodeGeom = useMemo(
    () => (constellation && constellation.nodes.count ? makePointGeometry(constellation.nodes) : null),
    [constellation],
  );
  const lineGeom = useMemo(() => {
    if (!constellation) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(constellation.linePositions, 3));
    g.setAttribute("aLineColor", new THREE.BufferAttribute(constellation.lineColors, 3));
    g.setAttribute("aPhase", new THREE.BufferAttribute(constellation.linePhases, 1));
    return g;
  }, [constellation]);
  const starData = useMemo(() => buildStarfield(counts.stars), [counts.stars]);
  const starGeom = useMemo(() => makePointGeometry(starData), [starData]);
  const nebulaGeom = useMemo(() => new THREE.PlaneGeometry(1, 1), []);

  useEffect(() => () => void faceGeom?.dispose(), [faceGeom]);
  useEffect(() => () => void sprayGeom?.dispose(), [sprayGeom]);
  useEffect(() => () => void heroGeom?.dispose(), [heroGeom]);
  useEffect(() => () => void nebulaGeom.dispose(), [nebulaGeom]);
  useEffect(() => () => void escapeGeom?.dispose(), [escapeGeom]);
  useEffect(() => () => void nearGeom?.dispose(), [nearGeom]);
  useEffect(() => () => void nodeGeom?.dispose(), [nodeGeom]);
  useEffect(() => () => void lineGeom?.dispose(), [lineGeom]);
  useEffect(() => () => void starGeom.dispose(), [starGeom]);

  /* materials (created once, disposed on unmount) --------------------------- */
  const mats = useMemo(
    () => ({
      face: makePointMaterial({ scatter: true, twinkle: 0.15, halo: 0.3 }),
      spray: makePointMaterial({ scatter: true, orbit: true, twinkle: 0.5, halo: 0.35 }),
      hero: makePointMaterial({ scatter: true, twinkle: 0.35, halo: 0.9, spike: 2.6 }),
      escape: makePointMaterial({ scatter: true, orbit: true, twinkle: 0.6, halo: 0.35 }),
      near: makePointMaterial({ scatter: true, twinkle: 0.8, halo: 0.35, spike: 1.2 }),
      node: makePointMaterial({ scatter: false, twinkle: 0.7, halo: 0.5, spike: 1.5 }),
      star: makePointMaterial({ scatter: false, twinkle: 0.8, halo: 0.3, spike: 1.0 }),
      line: makeLineMaterial(),
      nebula: makeNebulaMaterial(),
    }),
    [],
  );
  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats]);

  const invalidate = useThree((s) => s.invalidate);

  /* Face geometry mounts async after sampling; defaults are uScatter=1 / uOpacity=0 until useFrame runs. */
  useEffect(() => {
    if (!sample) return;
    const intro = instantIntro ? 1 : st.current.intro;
    mats.face.uniforms.uScatter.value = 0;
    mats.face.uniforms.uOpacity.value = Math.min(1, intro * 2);
    invalidate();
    const t = window.setTimeout(invalidate, 100);
    return () => window.clearTimeout(t);
  }, [sample, faceGeom, mats, instantIntro, invalidate, canvasW, canvasH]);

  const nebulaScale = useRef<[number, number]>([1, 1]);

  /* layout / sizing – recomputed from the live canvas size & DPR ------------ */
  const layout = useMemo(
    () => computeLayout(canvasW, canvasH, sample?.aspect ?? 0.75, mode),
    [canvasW, canvasH, sample?.aspect, mode],
  );

  useEffect(() => {
    dbgOnce("pointRange", () => {
      onDebugUpdate?.({ pointSizeRange: `[${readMaxPointSize(gl)}]` });
    });
    const facePxH = (layout.scale / layout.vh) * canvasH; // portrait height in CSS px
    const spacing = facePxH * Math.sqrt((sample?.coverage ?? 0.6) / counts.face); // mean star spacing (CSS px)
    const quadMin = mode === "mobile" ? 4.2 : 3;
    const quad = Math.max(quadMin, 1.8 * spacing); // sprite quad incl. halo
    const coreR = Math.max(0.12, 1.2 / (quad * dpr)); // core never thinner than ~1.2 device px
    const safeDpr = rendererDpr;
    const ptFloor = Math.min(1.75, maxPointSize);
    const iosPtBoost = ptFloor < 1.75 ? 1.75 / ptFloor : 1;
    for (const m of Object.values(mats)) {
      if (m.uniforms.uMaxPointSize) m.uniforms.uMaxPointSize.value = maxPointSize;
    }
    mats.face.uniforms.uSize.value = quad * BASE_Z * iosPtBoost;
    mats.face.uniforms.uCoreR.value = Math.min(0.34, coreR);
    mats.spray.uniforms.uSize.value = quad * 0.95 * BASE_Z;
    mats.spray.uniforms.uCoreR.value = Math.min(0.34, coreR);
    mats.escape.uniforms.uSize.value = Math.max(quad * 1.1, 4) * BASE_Z;
    mats.escape.uniforms.uCoreR.value = Math.max(coreR, 0.16);
    mats.hero.uniforms.uSize.value = Math.min(0.036 * canvasH * BASE_Z, maxPointSize);
    mats.hero.uniforms.uCoreR.value = 0.06;
    mats.near.uniforms.uSize.value = 0.011 * canvasH * BASE_Z;
    mats.node.uniforms.uSize.value = 0.015 * canvasH * BASE_Z;
    mats.star.uniforms.uSize.value = 0.0065 * canvasH * BASE_Z;
    // nebula plane covers the frustum at NEBULA_Z with margin for parallax
    const nebH = 2 * (BASE_Z - NEBULA_Z) * Math.tan((FOV * Math.PI) / 360) * 1.35;
    nebulaScale.current = [nebH * (canvasW / canvasH), nebH];
    mats.nebula.uniforms.uAspect.value = canvasW / canvasH;
    mats.nebula.uniforms.uIntensity.value = counts.nebula ? 0.34 : 0;

    // depth of field: portrait stays crisp; surrounding layers soften with distance from focus
    const k = 1 / Math.max(0.5, layout.scale);
    mats.face.uniforms.uDof.value = 0;
    mats.face.uniforms.uSizeGrow.value = 0;
    mats.spray.uniforms.uDof.value = 0.9 * k;
    mats.spray.uniforms.uSizeGrow.value = 0.8;
    mats.hero.uniforms.uDof.value = 0;
    mats.hero.uniforms.uSizeGrow.value = 0;
    mats.escape.uniforms.uDof.value = 1.2 * k;
    mats.escape.uniforms.uSizeGrow.value = 1.2;
    mats.near.uniforms.uDof.value = 1.4 * k;
    mats.near.uniforms.uSizeGrow.value = 1.4;
    mats.node.uniforms.uDof.value = 1.4 * k;
    mats.node.uniforms.uSizeGrow.value = 1.2;
    mats.star.uniforms.uDof.value = 0.1;
    mats.star.uniforms.uSizeGrow.value = 1.6;

    mats.face.uniforms.uBreath.value = reducedMotion ? 0 : 0.006;
    mats.star.uniforms.uParallax.value = 0.06; // only the world-space starfield shears with depth
    for (const m of Object.values(mats)) if (m.uniforms.uPixelRatio) m.uniforms.uPixelRatio.value = safeDpr;
  }, [layout, canvasW, canvasH, sample?.coverage, counts.face, counts.nebula, dpr, rendererDpr, mats, reducedMotion, gl, maxPointSize, onDebugUpdate, mode]);

  /* mouse ------------------------------------------------------------------- */
  const mouse = useRef({ x: 0, y: 0 });
  useEffect(() => {
    if (!mouseEnabled) return;
    const onMove = (e: PointerEvent) => {
      mouse.current.x = (e.clientX / window.innerWidth) * 2 - 1;
      mouse.current.y = -((e.clientY / window.innerHeight) * 2 - 1);
    };
    const onLeave = () => {
      mouse.current.x = 0;
      mouse.current.y = 0;
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerleave", onLeave);
    return () => {
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerleave", onLeave);
    };
  }, [mouseEnabled]);

  /* animation --------------------------------------------------------------- */
  const groupRef = useRef<THREE.Group>(null);
  const starsRef = useRef<THREE.Points>(null);
  const nebulaRef = useRef<THREE.Mesh>(null);
  const camTarget = useMemo(() => new THREE.Vector3(), []);
  const lookTarget = useMemo(() => new THREE.Vector3(), []);

  useFrame((state, dt) => {
    if (!firstFrameDone.current) {
      firstFrameDone.current = true;
      onFirstFrame?.();
    }
    const t = state.clock.elapsedTime;
    const s = st.current;
    const p = Math.min(1, Math.max(0, progressRef?.current ?? 0));
    const k = Math.min(1, dt * 4.5);

    if (sample) s.intro = instantIntro ? 1 : Math.min(1, s.intro + dt / 2.4);
    if (s.intro >= 1 && !introDone.current) {
      introDone.current = true;
      onIntroComplete?.();
    }
    const introT = easeOutCubic(s.intro);
    const introScatter = 1 - introT;

    const pe = reducedMotion ? 0 : easeInOut(p);
    const scrollScatter = reducedMotion ? 0 : smoothstep(0.74, 1, p);
    const flow = reducedMotion ? 0 : smoothstep(0.6, 1, p);
    const fade = 1 - smoothstep(0.8, 1, p);

    s.mx += ((mouseEnabled ? mouse.current.x : 0) - s.mx) * k;
    s.my += ((mouseEnabled ? mouse.current.y : 0) - s.my) * k;

    // ONE rigid transform for the whole portrait group: small tilt toward the cursor + scroll rotation
    const targetRotY = -0.85 * pe + s.mx * 0.12;
    const targetRotX = 0.08 * pe - s.my * 0.07;
    s.rotY += (targetRotY - s.rotY) * k;
    s.rotX += (targetRotX - s.rotX) * k;

    const g = groupRef.current;
    if (g) {
      g.rotation.set(s.rotX, s.rotY, 0);
      g.position.set(layout.x + s.mx * 0.04 * layout.scale, layout.y + s.my * 0.025 * layout.scale, 0);
      g.scale.setScalar(layout.scale);
    }

    // camera: on mobile portrait, frame the face directly; desktop/tablet use scroll dolly
    if (mode === "mobile") {
      camTarget.set(layout.x + s.mx * 0.08, layout.y * 0.55 + s.my * 0.06, BASE_Z * (0.92 - 0.12 * pe));
      lookTarget.set(layout.x, layout.y, 0);
    } else {
      camTarget.set(layout.x * 0.5 * pe + s.mx * 0.14, layout.y * 0.35 * pe + s.my * 0.1 - 0.15 * pe, BASE_Z * (1 - 0.26 * pe));
      lookTarget.set(layout.x * 0.55 * pe, layout.y * 0.5 * pe, 0);
    }
    camera.position.lerp(camTarget, k);
    camera.lookAt(lookTarget);
    const cam = camera as THREE.PerspectiveCamera;
    if (cam.isPerspectiveCamera && canvasW >= 2 && canvasH >= 2) {
      const aspect = canvasW / canvasH;
      if (Math.abs(cam.aspect - aspect) > 0.001) {
        cam.aspect = aspect;
        cam.updateProjectionMatrix();
      }
    }

    const focus = g ? camera.position.distanceTo(g.position) : BASE_Z;
    const { face, spray, hero, escape, near, node, star, line, nebula } = mats;
    for (const m of [face, spray, hero, escape, near, node, star]) {
      m.uniforms.uTime.value = t;
      m.uniforms.uFocus.value = focus;
      (m.uniforms.uMouse.value as THREE.Vector2).set(s.mx, s.my);
    }

    if (touchLayout) {
      face.uniforms.uScatter.value = 0;
      face.uniforms.uOpacity.value = fade;
    } else {
      face.uniforms.uScatter.value = Math.max(introScatter, scrollScatter);
      face.uniforms.uOpacity.value = Math.min(1, s.intro * 2) * fade;
    }

    // spray condenses inward from space slightly after the face; flies outward on scroll-out
    const sprayIntro = easeOutCubic(Math.max(0, s.intro - 0.1) / 0.9);
    spray.uniforms.uScatter.value = Math.max(1 - sprayIntro, smoothstep(0.66, 0.98, p));
    spray.uniforms.uOrbit.value = reducedMotion ? 0.15 : 0.35;
    spray.uniforms.uFlow.value = flow * 0.4;
    spray.uniforms.uDrift.value = 0.003;
    spray.uniforms.uOpacity.value = introT * (1 - smoothstep(0.88, 1, p));

    // hero stars fade in once the portrait has formed; travel with the constellation late in the scroll
    hero.uniforms.uScatter.value = 0.35 * (1 - easeOutCubic(Math.max(0, s.intro - 0.35) / 0.65));
    hero.uniforms.uFlow.value = flow * 0.8;
    hero.uniforms.uDrift.value = 0.004;
    hero.uniforms.uOpacity.value = 0.85 * easeOutCubic(Math.max(0, s.intro - 0.5) / 0.5) * (1 - smoothstep(0.85, 1, p));

    const escIntro = easeOutCubic(Math.max(0, s.intro - 0.15) / 0.85);
    escape.uniforms.uScatter.value = Math.max(1 - escIntro, smoothstep(0.62, 0.95, p));
    escape.uniforms.uOrbit.value = reducedMotion ? 0.35 : 1;
    escape.uniforms.uFlow.value = flow * 0.6;
    escape.uniforms.uDrift.value = 0.004;
    escape.uniforms.uOpacity.value = 0.95 * introT * (1 - smoothstep(0.85, 1, p));

    near.uniforms.uScatter.value = 0.6 * (1 - easeOutCubic(Math.max(0, s.intro - 0.3) / 0.7));
    near.uniforms.uFlow.value = flow;
    near.uniforms.uDrift.value = 0.006;
    near.uniforms.uOpacity.value = 0.9 * introT * (1 - smoothstep(0.9, 1, p));

    node.uniforms.uDrift.value = 0.006;
    node.uniforms.uOpacity.value = 0.9 * easeOutCubic(Math.max(0, s.intro - 0.45) / 0.55) * (1 - smoothstep(0.62, 0.9, p));

    line.uniforms.uTime.value = t;
    line.uniforms.uOpacity.value = 0.55 * easeOutCubic(Math.max(0, s.intro - 0.4) / 0.6) * (1 - smoothstep(0.62, 0.9, p));

    star.uniforms.uOpacity.value = 0.8;
    const stars = starsRef.current;
    if (stars) {
      stars.rotation.y = t * 0.006 + pe * 0.35 + s.mx * 0.02;
      stars.position.set(-s.mx * 0.3, -s.my * 0.2, 0);
    }

    nebula.uniforms.uTime.value = t;
    (nebula.uniforms.uMouse.value as THREE.Vector2).set(s.mx, s.my);
    const neb = nebulaRef.current;
    if (neb) {
      neb.scale.set(nebulaScale.current[0], nebulaScale.current[1], 1);
      neb.position.set(camera.position.x * 0.6, camera.position.y * 0.6, NEBULA_Z);
    }
  });

  return (
    <>
      {counts.nebula && (
        <mesh ref={nebulaRef} geometry={nebulaGeom} material={mats.nebula} frustumCulled={false} renderOrder={-2} />
      )}
      <points ref={starsRef} geometry={starGeom} material={mats.star} frustumCulled={false} renderOrder={-1} />
      {/* the complete portrait – every layer below – is ONE rigid group */}
      <group ref={groupRef}>
        {lineGeom && <lineSegments geometry={lineGeom} material={mats.line} frustumCulled={false} renderOrder={0} />}
        {nearGeom && <points geometry={nearGeom} material={mats.near} frustumCulled={false} renderOrder={1} />}
        {nodeGeom && <points geometry={nodeGeom} material={mats.node} frustumCulled={false} renderOrder={2} />}
        {sprayGeom && <points geometry={sprayGeom} material={mats.spray} frustumCulled={false} renderOrder={3} />}
        {escapeGeom && <points geometry={escapeGeom} material={mats.escape} frustumCulled={false} renderOrder={4} />}
        {faceGeom && <points geometry={faceGeom} material={mats.face} frustumCulled={false} renderOrder={5} />}
        {heroGeom && <points geometry={heroGeom} material={mats.hero} frustumCulled={false} renderOrder={6} />}
      </group>
    </>
  );
}

/* ----------------------------- boundary ---------------------------------- */
class GLBoundary extends Component<{ children: ReactNode; fallback?: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(err: unknown) {
    console.error("[ParticlePortrait] WebGL failed", err);
  }
  render() {
    return this.state.failed ? (this.props.fallback ?? null) : this.props.children;
  }
}

/* ----------------------------- public ------------------------------------ */
export interface ParticlePortraitProps {
  /** Any portrait image. Transparent PNG preferred; plain light/dark backgrounds are keyed automatically. */
  src: string;
  /** 0→1 scroll progress driving the cinematic transition (optional; static hero if omitted). */
  progressRef?: RefObject<number>;
  mode?: LayoutMode;
  reducedMotion?: boolean;
  mouseEnabled?: boolean;
  /** Pause rendering when false (e.g. hero off-screen). */
  active?: boolean;
  /** Touch / iOS layout — lower DPR, instant intro, reliable sizing. */
  touchLayout?: boolean;
  quality?: Quality;
  onReady?: (info: { points: number }) => void;
  onFirstFrame?: () => void;
  className?: string;
  /** Rendered if WebGL is unavailable. */
  fallback?: ReactNode;
}

function PortraitDebugBadge({ info }: { info: PortraitDebugInfo }) {
  const lines = [
    info.mode && `mode: ${info.mode}`,
    info.mq1024 !== undefined && `mq1024=${info.mq1024} mq768=${info.mq768}`,
    info.innerW !== undefined && `inner: ${info.innerW}x${info.innerH}`,
    info.vvW !== undefined && `vv: ${info.vvW}x${info.vvH} dpr=${info.dpr}`,
    info.wrapperRect && `wrap: ${info.wrapperRect}`,
    info.canvasBuffer && `buf: ${info.canvasBuffer}`,
    info.canvasCss && `css: ${info.canvasCss}`,
    info.tier && `tier: ${info.tier} (${info.cores}c ${info.mem}GB)`,
    info.counts && `counts: ${info.counts}`,
    info.image && `img: ${info.image}`,
    info.sample && `sample: ${info.sample}`,
    info.pointSizeRange && `ptRange: ${info.pointSizeRange}`,
    info.glDpr !== undefined && `glDpr: ${info.glDpr}`,
    info.contextLost !== undefined && `ctxLost: ${info.contextLost}`,
    info.error && `err: ${info.error}`,
  ].filter(Boolean);
  return (
    <div
      className="pointer-events-none fixed top-14 right-2 z-[60] max-h-[38vh] max-w-[min(88vw,300px)] overflow-y-auto rounded border border-amber-400/40 bg-black/90 px-2 py-1 font-mono text-[8px] leading-tight text-amber-100 opacity-80"
      aria-hidden
    >
      {lines.map((l) => (
        <div key={l}>{l}</div>
      ))}
    </div>
  );
}

export default function ParticlePortrait({
  src,
  progressRef,
  mode = "desktop",
  reducedMotion = false,
  mouseEnabled = true,
  active = true,
  touchLayout = false,
  quality = "auto",
  onReady,
  onFirstFrame,
  className,
  fallback,
}: ParticlePortraitProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const invalidateRef = useRef<() => void>(() => {});
  const tier = useMemo(
    () => (touchLayout || mode === "mobile" ? "low" : quality === "auto" ? detectTier() : quality),
    [mode, quality, touchLayout],
  );
  const counts = COUNTS[mode][tier];
  const [hostReady, setHostReady] = useState(false);
  const [portraitReady, setPortraitReady] = useState(false);
  const [introComplete, setIntroComplete] = useState(false);
  const [failed, setFailed] = useState(false);
  const [glRetry, setGlRetry] = useState(0);
  const [debugInfo, setDebugInfo] = useState<PortraitDebugInfo>({});

  useEffect(() => {
    setPortraitReady(false);
    setIntroComplete(false);
    setFailed(false);
    setHostReady(false);
  }, [src, glRetry]);

  useEffect(() => {
    const host = wrapperRef.current;
    if (!host) return;
    let frames = 0;
    let cancelled = false;
    const check = () => {
      const r = host.getBoundingClientRect();
      if (r.width >= 2 && r.height >= 2) {
        setHostReady(true);
        return true;
      }
      return false;
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(host);
    window.visualViewport?.addEventListener("resize", check);
    const tick = () => {
      if (cancelled || check()) return;
      if (frames++ < 90) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      ro.disconnect();
      window.visualViewport?.removeEventListener("resize", check);
    };
  }, []);

  useEffect(() => {
    if (!dbg) return;
    const nav = navigator as Navigator & { deviceMemory?: number };
    const cores = nav.hardwareConcurrency ?? 0;
    const mem = nav.deviceMemory ?? 0;
    const patch: PortraitDebugInfo = {
      mode: resolveLayoutMode(),
      mq1024: window.matchMedia("(min-width: 1024px)").matches,
      mq768: window.matchMedia("(min-width: 768px)").matches,
      innerW: window.innerWidth,
      innerH: window.innerHeight,
      vvW: window.visualViewport?.width,
      vvH: window.visualViewport?.height,
      dpr: window.devicePixelRatio,
      tier,
      cores,
      mem,
      counts: JSON.stringify(counts),
    };
    dbgOnce("env", () => console.info("[ParticlePortrait:debug] env", patch));
    setDebugInfo((d) => ({ ...d, ...patch }));
  }, [tier, counts, mode]);

  useEffect(() => {
    if (!dbg) return;
    const measure = () => {
      const wrap = wrapperRef.current?.getBoundingClientRect();
      const canvas = wrapperRef.current?.querySelector("canvas");
      const patch: Partial<PortraitDebugInfo> = {
        wrapperRect: wrap ? `${Math.round(wrap.width)}x${Math.round(wrap.height)}` : "n/a",
        canvasBuffer: canvas ? `${canvas.width}x${canvas.height}` : "n/a",
        canvasCss: canvas ? `${Math.round(canvas.clientWidth)}x${Math.round(canvas.clientHeight)}` : "n/a",
      };
      dbgOnce("layout", () => console.info("[ParticlePortrait:debug] layout", patch));
      setDebugInfo((d) => ({ ...d, ...patch }));
    };
    measure();
    const t = window.setInterval(measure, 1000);
    return () => window.clearInterval(t);
  }, [portraitReady, glRetry]);

  useEffect(() => {
    if (active) invalidateRef.current();
  }, [active]);

  const handleReady = (info: { points: number }) => {
    setPortraitReady(true);
    onReady?.(info);
  };

  const handleError = (err: unknown) => {
    console.error("[ParticlePortrait]", err);
    setFailed(true);
    if (dbg) setDebugInfo((d) => ({ ...d, error: String(err) }));
  };

  const shouldAnimate = active || !portraitReady || !introComplete;
  const showFallback = failed;
  const mountCanvas = hostReady;

  return (
    <div ref={wrapperRef} className={className} aria-hidden>
      {showFallback ? (
        fallback
      ) : mountCanvas ? (
        <GLBoundary fallback={null}>
          <Canvas
            key={glRetry}
            frameloop={shouldAnimate ? "always" : "never"}
            resize={{ scroll: false, debounce: { scroll: 50, resize: 50 } }}
            dpr={safeDeviceDpr(touchLayout, mode)}
            camera={{ position: [0, 0, BASE_Z], fov: FOV, near: 0.1, far: 100 }}
            gl={{
              antialias: false,
              alpha: true,
              powerPreference: "high-performance",
              stencil: false,
              failIfMajorPerformanceCaveat: false,
            }}
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }}
            onCreated={({ gl, invalidate }) => {
              invalidateRef.current = invalidate;
              const canvas = gl.domElement;
              gl.setClearColor(0x000000, 0);
              if (dbg) setDebugInfo((d) => ({ ...d, glDpr: gl.getPixelRatio() }));
              dbgOnce("webgl", () => {
                const range = readMaxPointSize(gl);
                console.info("[ParticlePortrait:debug] WebGL ok, pointSize max", range);
                setDebugInfo((d) => ({ ...d, pointSizeRange: String(range) }));
              });
              const onLost = (e: Event) => {
                e.preventDefault();
                console.warn("[ParticlePortrait] WebGL context lost");
                setDebugInfo((d) => ({ ...d, contextLost: true }));
                if (glRetry < 1) setGlRetry((n) => n + 1);
                else setFailed(true);
              };
              const onRestored = () => {
                console.info("[ParticlePortrait] WebGL context restored");
                setDebugInfo((d) => ({ ...d, contextLost: false }));
                invalidate();
              };
              canvas.addEventListener("webglcontextlost", onLost);
              canvas.addEventListener("webglcontextrestored", onRestored);
            }}
          >
            <HostCanvasSync hostRef={wrapperRef} />
            <Scene
              src={src}
              progressRef={progressRef}
              mode={mode}
              touchLayout={touchLayout}
              reducedMotion={reducedMotion}
              mouseEnabled={mouseEnabled}
              counts={counts}
              onReady={handleReady}
              onError={handleError}
              onIntroComplete={() => setIntroComplete(true)}
              onFirstFrame={onFirstFrame}
              onDebugUpdate={(patch) => setDebugInfo((d) => ({ ...d, ...patch }))}
            />
          </Canvas>
        </GLBoundary>
      ) : null}
      {dbg && <PortraitDebugBadge info={debugInfo} />}
    </div>
  );
}
