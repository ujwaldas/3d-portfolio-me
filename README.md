# Ujwal Das H S — Portfolio (face-constellation hero)

React + Vite + Tailwind v4 + Three.js (React Three Fiber) + Framer Motion.

## Replace the placeholder portrait

`src/assets/profile-cutout.png` is a **placeholder portrait**. Replace it with your own
transparent head-and-shoulders cutout (PNG with alpha). Nothing else needs to change.

- Alpha channel present → alpha is the silhouette mask (transparent = no particle). Brightness
  never gates particles, so dark hair / beard / eyes still become (dimmer, cooler) stars.
- No alpha channel → a plain light or dark background is keyed automatically (fallback only —
  shadows against a dark background can be lost; prefer a real alpha PNG).
- The sampler auto-crops to the subject, so padding around the head does not matter.
- Have an opaque photo on a plain background? `npm run face:alpha -- in.png src/assets/profile-cutout.png`.

## Verify offline (no browser needed)

```bash
npm run face:preview -- 12000 0  scripts/preview-front.png      # desktop density, front view
npm run face:preview -- 12000 35 scripts/preview-turn.png       # rotated 35° (shows the volume)
npm run face:preview -- 12000 35 scripts/preview-tilt.png 12    # + 12° pitch (worst case for seams)
npm run face:preview -- 4500  0  scripts/preview-mobile.png     # mobile density
```

Each run writes the render, a `*-compare.png` (source vs. particles) and prints:
- **continuity** – max vertical z-step between adjacent regions; must be well under `depth` (0.26).
  This is the objective "no broken neck" check.
- **tonal fidelity** – luminance correlation between render and source.
- **density report** – sparsest / median / densest particles per 1000 px² plus an ASCII density map
  (`@` = densest). Eyes, beard and hair should be `@%`, flat skin `+=`, plain clothing `-:`.

Tuning knobs (`SampleOptions`): `contrast` (unsharp amount for brightness, default 0.6) and `focus`
(exponent on the importance map – >1 pushes even more particles into detail, default 1).

## Swapping the portrait (image-agnostic pipeline)

`<ParticlePortrait src={...} />` (`src/three/ParticlePortrait.tsx`) derives *everything* from the image at
runtime. To use a different person/photo, replace the file (or point `profile.heroImage` at a new one) —
no coordinates, silhouettes or facial features are hardcoded. On `src` change the old geometries are
disposed, the cloud regenerates, and the materialise-from-stars intro replays.

Verified with an unrelated transparent portrait (curly hair + glasses):

```bash
npm run face:alpha   -- path/to/opaque-on-plain-bg.png scripts/test-alt-transparent.png   # optional: make an alpha PNG
FACE_SRC=scripts/test-alt-transparent.png npm run face:preview -- 12000 0 scripts/preview-alt.png
FACE_SRC=scripts/test-alt-transparent.png npm run face:preview -- 12000 38 scripts/preview-alt-turn.png
```

Input guidance: a **transparent PNG** is best. Opaque images on a plain light or dark background are keyed
automatically (marker-based watershed), but dark hair on a black background is inherently ambiguous — use a
transparent cutout or a light background in that case.

## Effect layers ("photograph materialising from a constellation")

| Layer | Source | Motion |
| --- | --- | --- |
| Face stars (8k–60k) | **importance-driven stippling**: importance = multi-scale local contrast (beard/hair texture) + feature gradients (eyes, nostrils, lips, hairline) + tonal + silhouette band → density map (Σ = budget) → serpentine Floyd–Steinberg error diffusion (even spacing, no clumps). Size ∝ (mean density / local density)^0.35 → tiny stars in detail, medium stars on flat skin. Brightness from unsharp-masked luminance with packing compensation (dense dark texture stays dark). Source hue × warm/cool split tone; distance-transform depth | intro materialise, uniform breathing, scroll rotate / dolly / disperse |
| Spray (0.6k–3.6k) | tiny particles spawned on the dense silhouette rim, exponential fall-off along outward normals, cool with warm minority | condense inward on intro, gentle outward/return drift, fly outward on scroll-out |
| Hero stars (20–56) | large gold / blue-white stars with 4-point flares, 70 % outside the silhouette, 30 % on its edge | slow twinkle, travel with the constellation late in the scroll |
| Escape particles | rest just outside the rim, inherit local colour | drift outward along a travel vector and return (`USE_ORBIT`) |
| Near stars / nodes | small twinkles in a shell following the silhouette; glowing nodes at link junctions | twinkle, late-scroll flow past camera |
| Links | proximity links (spatial hash) + macro polygons between hero stars + hero → silhouette | per-segment phase → smooth appear/disappear |
| Nebula | procedural fbm clouds on a far plane (deep blue with a warm pocket), additive, vignetted | slow drift, counter-parallax to the cursor; off on low-tier devices |
| Starfield | world space, warm/cool mix | slow rotation, depth-weighted mouse parallax |

Every portrait layer (face, spray, hero, escape, near, nodes, links) lives in **one** `THREE.Group`
and receives the same rigid transform – the portrait can never come apart.

Depth of field: every point computes blur = |viewDistance − focus| × strength; blur enlarges the sprite,
softens its edge and lowers alpha. Focus tracks the camera→portrait distance each frame.
Parallax is depth-weighted in the shader (`uMouse · uParallax · (0.35 + z)`), so near particles move more.

Particle budget: `quality="auto"` picks high/low from `hardwareConcurrency` / `deviceMemory`
(face stars: desktop 60k/32k · tablet 30k/18k · mobile 14k/8k; spray 3.6k → 0.6k). Sampling is a
one-time ~250 ms on load; rendering is 9 draw calls.

## How the hero works

| File | Role |
| --- | --- |
| `src/three/sampleFace.ts` | image → alpha mask → subject crop → stratified grid + edge-importance sampling → per-point colour/size/alpha/depth → anchors → constellation lines |
| `src/three/ParticlePortrait.tsx` | reusable R3F component: point/line shaders (DOF, parallax, orbit, breathing), face group + escape + nodes + links, starfield, scroll/mouse rig, per-breakpoint layout and particle budgets |
| `src/components/Hero.tsx` | 300svh scroll track + sticky stage; `scrollYProgress` drives the 3D rig via a ref and the copy via Framer transforms |
| `src/data/portfolio.ts` | all content |

Why it reads as *a photograph made of stars* and stays one object:

1. **Density** – 60k/32k desktop, 30k/18k tablet, 14k/8k mobile (auto by device tier); analysis resolution scales with density (560–720 px).
2. **Star sprites** – gaussian core ≈ 0.45 × spacing + wide soft halo, additive blending, a few
   brighter stars with a faint diffraction cross. No flat discs.
3. **Split-tone star colour** – source hue (normalised) blended 50/50 with a cool→warm ramp
   (`#6b9eff` shadows → `#ffdba3` highlights), brightness from luminance with a lifted floor; skin
   reads as warm-white stars, hair/beard/eyes as dim blue stars – the reference look, contrast preserved.
4. **Image-derived depth, one continuous function** – Euclidean distance transform of the mask
   (rounded inflation: thin parts like the neck sit slightly behind thick parts) + low-frequency
   luminance relief + micro detail. No head/neck/body cases, no landmarks.
5. **One rigid transform** – all portrait layers live in a single `THREE.Group`; breathing is a
   uniform scale, per-vertex parallax is off for portrait layers (only the world-space starfield
   shears with depth), DOF is off for the portrait (only surrounding layers soften).
6. **Long lens** – camera at z=7 / FOV 30 so the portrait's depth doesn't get perspective-magnified.
7. **Intelligent density** – particles go where the photograph carries information. Measured on
   the placeholder: eyes/beard ≈ 800 stars per 1000 px², forehead ≈ 400, plain shirt ≈ 170 (4.8×
   dynamic range); the density report (`npm run face:preview`) prints an ASCII map so you can see it.
8. **Constellation stays off the face** – hero stars are placed outside the silhouette and every
   link is rejected if it crosses the face interior (64×64 occupancy test).

## Performance / responsiveness

- Point counts, DPR caps (`[1,1.5]` mobile, `[1,1.75]` desktop) and near-star counts scale by breakpoint.
- Layout is computed in world units from the camera frustum: face right (desktop/tablet), face top + copy bottom (mobile).
- `prefers-reduced-motion`: no rotation/dolly/mouse, static 100svh hero.
- Canvas `frameloop` is set to `never` when the hero leaves the viewport.
- Mouse parallax disabled on coarse pointers.

## Deploy

`npm run build` → `dist/`. On Vercel: framework **Vite**, build `npm run build`, output `dist`.
