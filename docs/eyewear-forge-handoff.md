# eyewear-forge — Founding Spec & Handoff

**Purpose:** convert 2D product photos of eyeglass frames into VTO-ready 3D
models in **GLB** format. Standalone product and repository; connects to the
VTO SDK only through the GLB contract defined in this document.

**This document is self-contained.** Copy it into the new repository as
`docs/SPEC.md` (or split §3 out as `spec/frame-glb-spec.md`). Everything a
fresh contributor needs — including the exact numeric conventions extracted
from the eyewearVTO codebase — is here.

---

## 1. Product definition

- **Input:** one front-view product photo of an eyeglass/sunglass frame
  (standard e-commerce shot: frame roughly centered, plain background).
  Optional later: a second 3/4 or side view to improve temple estimation.
- **Output:** a `.glb` conforming to the Frame GLB Contract (§3), plus a
  256×256 PNG thumbnail, plus a catalog JSON fragment (§3.6).
- **Mode:** asynchronous job. Conversion is a **one-time cost per SKU** —
  seconds-to-minutes latency is acceptable; correctness and VTO fit quality
  are not negotiable.
- **Human gate:** every conversion ends in a preview that a human approves or
  rejects (in the merchant dashboard, eventually). The pipeline's bar is
  "usually approvable," not "always perfect."

## 2. Approach: parametric-first (NOT generic image-to-3D ML)

Generic single-image mesh generators (TripoSR, Stable Fast 3D, TRELLIS,
Meshy) are near worst-case for eyewear: thin rims/temples blob or vanish,
transparent lenses confuse them, tiny asymmetries look broken on a face, the
unseen back half is hallucinated, and their output would still need a heavy
normalization pass to meet §3. Eyewear is a *parametric object family* —
so we extract parameters from the photo and drive a **procedural generator**,
whose output is *born* conforming to §3.

The proven seed for the generator already exists:
`eyewearVTO/app/scripts/generate-catalog.mjs` builds 8 distinct frame styles
(aviator, wayfarer, round, rectangle, cat-eye, browline, rimless, oversized)
as convention-correct GLBs from silhouette definitions, in Node + three.js,
with headless validation. eyewear-forge generalizes it from "8 hardcoded
silhouettes" to "arbitrary extracted lens contour + measured parameters."

### Pipeline

```
photo
 → [P1] segment      frame vs. background          rembg or SAM; commodity
 → [P2] contours     the two enclosed lens regions OpenCV: threshold, findContours,
                     + outer frame silhouette      hierarchy → holes = lenses
 → [P3] measure      lens w/h, bridge gap, rim     pure geometry off P2, normalized
                     thickness, frame aspect,      to frame width
                     lens centers, symmetry check
 → [P4] classify     rim style (full/half/rimless),  small classifier OR one
                     material (acetate/metal),       vision-LLM call returning
                     colors (sampled), browbar flag  strict JSON
 → [P5] generate     contour + params → 3D          Node + three.js; generalized
                     (extruded rims, bridge,         generate-catalog.mjs
                     templated temples, lens shells)
 → [P6] validate     §3 conformance + analyzer       tiny validator + the ported
                     cross-check                     glbAnalyzer (§5)
 → emit              .glb + thumb.png + catalog JSON → storage
```

- P1–P3: deterministic, milliseconds, **no GPU anywhere in v1**.
- P4 is the only ML. At catalog-onboarding volume, a vision-LLM call
  (`{material, rimStyle, colors[], browBar}` as constrained JSON) is fine;
  swap for a small local classifier if/when volume justifies it.
- **Temples are templated, not extracted.** Front photos don't show them and
  the VTO mostly occludes them. Ship 3–4 temple templates (straight acetate,
  thin metal + earhook, spring-hinge chunky), selected by P4's style class.
- P6 runs the *actual VTO analyzer* (ported module, §5) against the output
  as a second opinion: if `analyzeGlassesScene()` rejects our own GLB or
  derives a wildly different fit, the job fails loudly instead of shipping a
  frame that won't sit on a face.

### ML's future role (explicitly out of v1 scope)

- v1.5: project the source photo onto the parametric mesh as a texture
  (tortoiseshell patterns, gradients, translucent acetate).
- v2 (only if customers reject the parametric look): hybrid with a
  generative model, still normalized through §3 + P6.

## 3. The Frame GLB Contract  ⚠️ the load-bearing section

These are the **real values** currently enforced/assumed across the VTO
codebase (`generate-catalog.mjs`, `faceMath.ts`, `glbAnalyzer.ts`,
`GlassesSwap.tsx`). Version this section (`spec-version: 1`) and treat any
change as a breaking release coordinated with the VTO repo.

### 3.1 Units, axes, dimensions

| Property | Value | Enforced by |
|---|---|---|
| Units | **metres** | everything |
| Forward (toward wearer's face) | **+Z** | faceMath, analyzer |
| Temple arms extend along | **−Z** | generator, analyzer |
| Up | **+Y** | all |
| Model's right | **+X** | all |
| Outer temple-to-temple width | **0.14 m (140 mm), ±1 mm** | generator validation asserts `|width−140mm| < 1.0mm` |
| Triangle budget | hard reject > 500,000 (VTO analyzer limit); **target ≤ 100,000** | `glbAnalyzer.MAX_TRIANGLES` |

> Note: the VTO's analyzer normalizes uploads to
> `CANONICAL_FRAME_WIDTH_M = 0.14984` (the shipped sunglasses.glb's measured
> width — that model predates the generator convention). New forge output
> MUST use 0.14 m like the generator does; the VTO's `DEFAULT_FIT` and
> `MODEL_TO_CM = 84.24` visual tuning are calibrated against that family.

### 3.2 Origin placement

- X: centred (model symmetric about X=0).
- Y: **vertical centre of the lens/front slab at Y=0**.
- Z: **frontmost point of the front frame at Z=0** (the surface that faces
  away from the wearer; i.e. `boundingBox.max.z === 0`, all geometry in
  Z ≤ 0 … front slab near 0, temple tips most negative).

This is exactly what `generate-catalog.mjs` bakes (`shift = (−center.x,
−center.y, −box.max.z)`). The VTO then seats the frame on the face via
`MODEL_SEAT_OFFSET_M = [0, −0.03078, 0.00206]` + the nose-bridge anchor
`NOSE_BRIDGE_ANCHOR_CM = [0, 3.271, 5.236]` — forge does NOT need to
replicate those; they live on the VTO side of the contract. Forge just has
to nail the origin rule above.

### 3.3 Mesh & material naming (required by the VTO's tint + occlusion systems)

| Node | Naming rule | Why |
|---|---|---|
| Lens meshes | mesh **material** name must match `/lens/i` — use `lens_exterior` (world-facing shell) and `lens_interior` (face-facing shell), two thin stacked shells | `GlassesSwap.applyTint()` recolours materials matching `LENS_NAME_RE = /lens/i`; the exterior shell alone gets mirror boost |
| Temple arms | mesh names `TempleLeft`, `TempleRight` (regex `/Temple/`; `/Earhook/` also recognized for hook tips) | yaw-dependent temple occlusion & arm-pivot animation claim ONLY these meshes when present |
| Front frame | any names EXCEPT the above (generator uses `LensLeft`/`LensRight` for rims, `Bridge`, `BrowBar`) | must not be claimed as arm or lens |
| Root group | `<StyleName>Glasses` (cosmetic) | debugging |

⚠️ Two gotchas inherited from the current code:
- The generator's rim meshes are named `LensLeft`/`LensRight` but carry the
  *frame* material — the tint system keys on **material** names, not mesh
  names, so this is safe. Keep frame-material names free of the substring
  "lens".
- Do not name any front-frame mesh `Temple*` or the occlusion system will
  hide it at head-on yaw.

### 3.4 Geometry requirements

- Two separate lens shells per side (exterior/interior) ~0.5–1 mm apart,
  so tints can render interior/exterior differently without z-fighting
  (VTO pins their draw order).
- Rim/frame as watertight-ish extrusions; no degenerate triangles;
  double-sided not required (VTO renders as-authored).
- Temple arms: hinge at approximately `Z = −0.012` (the VTO's
  `ARM_HINGE_Z_M`), length such that the ear-contact zone lands near
  `Z ≈ −0.075…−0.1` (`EAR_TAPER_START_Z`/`EAR_TAPER_END_Z`) — i.e. temple
  length ≈ 0.09–0.11 m before width-normalization. Template temples to this.
- Materials: `MeshStandardMaterial`-compatible PBR (baseColor, metalness,
  roughness). Lens materials: `transparent: true`, sensible base opacity
  (VTO's tint system overrides at runtime).

### 3.5 The GlassesFit sidecar

The VTO's per-model fit type (from `glbAnalyzer.ts`) — forge emits one per
GLB as JSON, derived by running the ported analyzer on our own output (P6):

```ts
interface GlassesFit {
  unitScale: number                                  // 1.0 for conforming output
  preRotation: readonly [number, number, number]     // [0,0,0] for conforming output
  seatOffsetM: readonly [number, number, number]     // bridge-saddle → origin
  hingeZ: number                                     // frame/temple junction
  frontSectionZ: number                              // head-on visible temple stub
  earTaperStartZ: number                             // occlusion taper band
  earTaperEndZ: number
}
```

For a perfectly conforming GLB the VTO could fall back to its `DEFAULT_FIT`,
but shipping the analyzer-derived fit per model is strictly better (the VTO
already consumes `fit` on its `Frame` type) and doubles as P6 validation.

### 3.6 Catalog fragment (what the VTO consumes)

```json
{
  "id": "acme-aviator-gold",
  "name": "Acme Aviator Gold",
  "modelUrl": "<storage-url>.glb",
  "thumbUrl": "<storage-url>.png",
  "attribution": { "creator": "<merchant>", "license": "<terms>", "sourceUrl": "" },
  "fit": { /* GlassesFit, §3.5 */ }
}
```

Matches `Frame` in `eyewearVTO/app/src/vto/data/frames.ts` exactly.

## 4. Service design

### 4.1 API

```
POST /v1/convert            multipart: photo (+ optional params overrides)
  → 202 { jobId }
GET  /v1/jobs/{jobId}
  → { status: queued|processing|needs_review|failed|done,
      error?, result?: { glbUrl, thumbUrl, fit, catalogFragment,
                         extracted: { measurements, classification } } }
POST /v1/jobs/{jobId}/approve | /reject     (dashboard drives these)
```

- Auth: same Supabase project as the VTO licensing; converter access is a
  flag/quota on the customer row. v0 can run with a single admin token.
- Jobs table + files in Supabase Storage
  (`frames/{merchantId}/{sku}/model.glb|thumb.png|fit.json`).
- Queue: in-process worker at v1 (jobs take seconds); a real queue only if
  GPU steps arrive later.
- `extracted` is returned so the dashboard can show *why* the pipeline chose
  what it chose (contour overlay, sampled colors) — makes rejects debuggable.

### 4.2 Repository scaffold

```
eyewear-forge/
├── README.md
├── docs/SPEC.md                    ← this document
├── service/                        ← Python 3.12 + FastAPI
│   ├── pyproject.toml
│   ├── api/main.py                 ← routes, job store
│   ├── pipeline/
│   │   ├── segment.py              ← P1 (rembg; SAM behind a flag)
│   │   ├── contours.py             ← P2–P3 (OpenCV)
│   │   └── classify.py             ← P4 (VLM call or classifier)
│   └── worker/runner.py            ← orchestrates P1→P6, shells out to generator
├── generator/                      ← Node 20 + three.js (TypeScript)
│   ├── package.json
│   ├── src/buildFrame.ts           ← contour + params → THREE scene → GLB
│   ├── src/temples/                ← temple templates (3–4)
│   ├── src/materials.ts            ← PBR presets: acetate, metal, rimless-wire
│   ├── src/thumbnail.ts            ← 256×256 PNG (port png.mjs encoder)
│   ├── src/validate.ts             ← §3 asserts (width, origin, naming, tris)
│   └── src/analyzer/               ← ported glbAnalyzer (P6 cross-check)
├── golden/                         ← regression suite
│   ├── inputs/*.jpg                ← 10+ real frame photos
│   └── approved/*.glb              ← human-approved outputs, diffed in CI
└── .github/workflows/ci.yml       ← lint, test, golden-diff, spec validation
```

Python for P1–P4 (CV ecosystem), Node for P5–P6 (three.js + the ported
code). The runner shells `node generator/dist/cli.js --params job.json` —
a file-based interface between the halves; no FFI, trivially testable.

**All-Node alternative** (considered, not chosen): background removal via
`@imgly/background-removal`, contours via OpenCV.js — viable and
operationally simpler, but Python's CV ecosystem wins the moment
segmentation gets hard. Revisit only if deploying two runtimes becomes a
real burden.

### 4.3 Files to port FROM eyewearVTO (the actual handoff)

| Source (eyewearVTO) | Destination (forge) | Port notes |
|---|---|---|
| `app/scripts/generate-catalog.mjs` | `generator/src/buildFrame.ts` | The core. Generalize: `STYLES[n].outline()` becomes "contour passed in from P2"; keep `insetPolygon`, `normalizeOutline`, the width/origin normalization block, and the validation pattern verbatim. Convert to TS. |
| `app/scripts/lib/png.mjs` | `generator/src/thumbnail.ts` | Dependency-free PNG encoder; port as-is. |
| `app/src/vto/lib/glbAnalyzer.ts` | `generator/src/analyzer/` | Pure module, zero three.js imports by design — ports cleanly. Used in P6 as the independent fit cross-check. |
| `app/scripts/verify-glb-analyzer.mjs` | `generator/test/analyzer.test.ts` | Its calibration asserts become the analyzer port's regression test. |
| `app/scripts/generate-placeholder-glb.mjs` | reference only | FileReader shim for Node + GLTFExporter usage pattern. |
| `app/public/glasses/sunglasses.glb`, `eyeglasses.glb` | `golden/reference/` | Known-good VTO frames; P6 must pass them; useful for calibrating temple templates. |
| `app/public/glasses/spe20.glb`, `spe26.glb`, `spe52.glb`, `sun10.glb` | `golden/reference/` | Real-SKU frames, fully contract-conforming (verified: 140.0 mm, Z=0 front face, `Temple*`/`Earhook*` nodes, `lens_exterior`/`lens_interior` two-shell materials, 1.6–2.2k tris). The strongest calibration targets for the generator's output quality. |
| §3 of this doc | `docs/SPEC.md` / `spec/frame-glb-spec.md` | The contract. Also *backport* it to eyewearVTO's docs so both repos cite the same versioned text. |

### 4.4 Dependencies (v1)

- Python: `fastapi`, `uvicorn`, `rembg` (or `segment-anything` behind a
  flag), `opencv-python-headless`, `numpy`, `pillow`, `supabase`.
- Node: `three` (match eyewearVTO's `0.171.x` to keep exporter behaviour
  identical), `typescript`, `vitest`.
- No GPU, no CUDA, no model weights beyond rembg's small U²-Net.

## 5. Spike plan (go/no-go — do this before building the service)

> **Status update (2026-07-03): partially passed already.** Four real-SKU
> frames (SPE20, SPE26, SPE52, SUN10 — now in the eyewearVTO catalog and in
> `golden/reference/`) were produced with this parametric approach and came
> out fully contract-conforming. That validates the **generation half**
> (P5–P6): parametric output of real SKUs is achievable and VTO-ready.
> What the spike still has to prove is the **extraction half** (P1–P4):
> that lens contours, proportions, and materials can be derived from photos
> *automatically*, rather than by a human (or an LLM session) eyeballing the
> photo and writing parameters by hand. Spike days 1–2 below are therefore
> the remaining go/no-go; days 3–4 (VTO load test + Meshy control) are
> already answered and can be skipped.

**Budget: 3–4 days (now ~2 days — see status above). Outcome: a decision,
not a product.**

1. **Day 1:** collect 10 real frame photos (varied: acetate wayfarer, thin
   metal round, rimless, cat-eye, sunglasses with dark lenses, a browline,
   one half-rim, one with busy background). Run rembg + OpenCV contour
   extraction; eyeball the lens contours overlaid on the photos.
2. **Day 2:** hand-feed 3–4 extracted contours + hand-estimated params into
   a minimally-hacked `generate-catalog.mjs` (swap a `STYLES` entry's
   `outline()` for the extracted contour). Export GLBs.
3. **Day 3:** load the GLBs into the VTO (drag into the existing
   upload-frame flow — it runs the real analyzer + renders on a real face).
   Judge: does it *look like the photo* and *sit right on the face*?
4. **Day 3–4 (control):** run the same 10 photos through Meshy's API
   (~$2 total). Put its output through the same VTO upload flow. Compare
   honestly.

**Pass:** ≥ 7/10 parametric results are "approvable" (recognizably the
frame in the photo, sits correctly, no visual glitches) → build §4.
**Fail:** parametric looks toy-like AND Meshy looks materially better →
re-plan around a normalize-ML-output pipeline before writing any service
code. **Both bad:** the product needs the v1.5 texture-projection work
pulled forward; re-scope before committing.

## 6. Milestones after a passing spike

| # | Milestone | Est. | Definition of done |
|---|---|---|---|
| M1 | Generator CLI | 4–5 d | `node cli.js photo-params.json` → conforming GLB + thumb + fit; §3 validator + P6 analyzer cross-check green on golden set |
| M2 | Pipeline service | 3–4 d | `POST /convert` with a photo → `done` job with downloadable GLB; golden inputs run in CI |
| M3 | Supabase integration | 2 d | Output lands in Storage + `frames` row; auth via the shared project |
| M4 | Review loop | 2–3 d | needs_review state + approve/reject endpoints (+ minimal review UI, can be a static page before the full dashboard) |
| M5 | Temple templates + materials pass | 3 d | 3–4 temple styles, acetate/metal PBR presets, color fidelity vs. photo |
| M6 | Merchant dashboard | ~1 wk | upload → progress → preview (three.js viewer) → approve → appears in VTO catalog |

≈ 3–4 weeks post-spike, matching PLAN.md's Phase 4 estimate.

## 7. Risks specific to this repo

1. **Contour quality on busy/reflective photos** (P2) — the spike's day-1
   output tells you early. Mitigation: require plain-background photos at
   v1 (a reasonable merchant ask); SAM upgrade path behind a flag.
2. **"Toy look"** — parametric output reads as clip-art next to the photo.
   Mitigation: material fidelity (M5) matters more than silhouette
   precision; v1.5 texture projection is the real fix. The human review
   gate keeps bad ones out of catalogs meanwhile.
3. **Spec drift between repos** — the GLB contract exists in two places.
   Mitigation: `spec-version` field in every emitted `fit.json`; the VTO's
   analyzer port doubles as a compatibility test; backport §3 to eyewearVTO
   and change it only by coordinated version bump.
4. **Lens-vs-hole ambiguity for rimless/half-rim frames** (P2 hierarchy
   heuristics fail) — spike photo set deliberately includes both; if they
   fail, v1 scope excludes rimless (document it) rather than blocking ship.
