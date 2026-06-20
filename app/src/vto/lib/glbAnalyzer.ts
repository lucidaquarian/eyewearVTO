/**
 * glbAnalyzer — fully automatic fit analysis for USER-UPLOADED glasses GLBs.
 *
 * The shipped catalog GLBs follow strict authoring conventions (metres, +Y up,
 * front frame near z=0, temple arms toward −Z, hand-tuned seat offset — see
 * faceMath.ts). Uploads follow none of them: arbitrary units, any orientation,
 * often one merged mesh with no usable names. This module recovers the same
 * conventions from GEOMETRY alone, producing a per-model `GlassesFit` that
 * GlassesSwap applies in place of the global constants.
 *
 * Strategy — hypothesise, validate, re-scan:
 *   1. Sample the model's vertices in world space (caps below).
 *   2. Enumerate axis-aligned orientation hypotheses (identity, 180° flip,
 *      Z-up, temples-along-X, …). For each: rotate the sample, normalise the
 *      total width to the shipped frame width (units cancel out), slice the
 *      depth axis and read the X-mass profile — the front frame has vertex
 *      mass across the centre (bridge/rims/nose pads) while the temple-arm
 *      region only has mass at the two outer edges. That transition is the
 *      hinge. Derive the seat point (bridge-top, centre strip) and the ear
 *      taper band (a fixed fraction along the arm, calibrated on the shipped
 *      sunglasses so the band lands on the canonical ear).
 *   3. Run the validation suite (the "double checks"): plausible proportions,
 *      both arms present and balanced, front slab spans the width, bridge in
 *      the upper half. A hypothesis failing ANY check is discarded and the
 *      scan re-runs with the next hypothesis; the best-scoring passing
 *      hypothesis wins. If none passes the upload is rejected with a typed,
 *      user-readable error.
 *
 * PURE MODULE: no three.js (or any) runtime imports — three objects are
 * consumed through structural types only. This keeps it runnable headlessly
 * (scripts/verify-glb-analyzer.mjs) with plain Node, matching the repo's
 * verify-script convention.
 */

/**
 * Everything GlassesSwap needs to seat + occlude one model, replacing the
 * per-model constants in faceMath.ts (which become `DEFAULT_FIT` there for the
 * shipped frames). All values are in NORMALISED model space: metres-equivalent
 * (width = CANONICAL_FRAME_WIDTH_M), +Y up, front frame near z=0, arms −Z.
 */
export interface GlassesFit {
  /** Uniform scale taking the GLB's native units into normalised metres. */
  unitScale: number
  /**
   * XYZ euler (radians, three.js 'XYZ' order) applied BEFORE the scale to put
   * the model upright with the temple arms running toward −Z. Axis-aligned
   * (multiples of 90°); [0,0,0] for already-conventional models.
   */
  preRotation: readonly [number, number, number]
  /**
   * Bridge-saddle → origin offset in normalised metres (the per-model
   * replacement for MODEL_SEAT_OFFSET_M): translating the normalised model by
   * this puts its bridge contact at the local origin, so NOSE_BRIDGE_ANCHOR_CM
   * then lands it on the nose.
   */
  seatOffsetM: readonly [number, number, number]
  /** Frame/temple junction Z (replaces ARM_HINGE_Z_M). */
  hingeZ: number
  /** Head-on visible temple stub frontier (replaces TEMPLE_FRONT_SECTION_Z). */
  frontSectionZ: number
  /** Soft ear-taper band start, toward the lens (replaces EAR_TAPER_START_Z). */
  earTaperStartZ: number
  /** Soft ear-taper band end, behind the ear (replaces EAR_TAPER_END_Z). */
  earTaperEndZ: number
}

export type GlbAnalysisErrorCode =
  | 'empty' // no triangle geometry found
  | 'too-heavy' // beyond the triangle budget
  | 'not-glasses' // no orientation hypothesis passed the validation suite

/** Typed rejection; `message` is user-readable and shown in the upload UI. */
export class GlbAnalysisError extends Error {
  readonly code: GlbAnalysisErrorCode
  constructor(code: GlbAnalysisErrorCode, message: string) {
    super(message)
    this.name = 'GlbAnalysisError'
    this.code = code
  }
}

/**
 * Normalisation target: the shipped sunglasses' total frame width in metres.
 * Width-normalising every upload to this means the existing MODEL_TO_CM visual
 * tuning (and the yaw thresholds in FaceAnchor) carry over unchanged.
 */
export const CANONICAL_FRAME_WIDTH_M = 0.14984

/** Reject models beyond this triangle budget (mobile-GPU safety). */
export const MAX_TRIANGLES = 500_000

/** Cap the analysed vertex sample (analysis cost, not render cost). */
const MAX_SAMPLE_POINTS = 40_000

/**
 * Calibration constants, all in normalised metres / fractions. Values are
 * derived from the shipped sunglasses.glb so that analysing IT reproduces the
 * hand-tuned constants in faceMath.ts (verify-glb-analyzer.mjs asserts this).
 */
/** A slice "reaches the centre" when it has points with |x| below this. */
const CENTER_BAND_FRAC = 0.25 // × full width
/** Fraction of a slice's points that must sit in the centre band (front slab). */
const CENTER_OCCUPANCY_MIN = 0.05
/** Centre strip half-width used for the bridge-saddle search. */
const SEAT_STRIP_FRAC = 0.08 // × full width
/**
 * The bridge-saddle contact height as a fraction up the centre strip's Y range
 * (the strip spans nose-cutout edge → brow-bar top; the nose rests near its
 * lower third). 0.35 reproduces the shipped sunglasses' hand-tuned seat.
 */
const SEAT_RISE_FRAC = 0.35
/** Strip points within this of the saddle height contribute to the seat Z. */
const SEAT_Z_BAND_M = 0.005
/**
 * Canonical ear-front Z in normalised model space (the wearer's ear, fixed by
 * the width normalisation — canonical temple landmark ≈ −0.0873; see
 * EAR_TAPER_* in faceMath.ts which this reproduces). Clamped to the arm tip
 * for short-armed models.
 */
const EAR_CENTER_Z_M = -0.0875
/** Half-width of the soft ear-taper band. */
const EAR_BAND_HALF_M = 0.0125
/** Head-on front-stub length behind the hinge. */
const FRONT_SECTION_BEHIND_HINGE_M = 0.018

// ---------------------------------------------------------------------------
// Structural three.js shapes (no runtime three import — see module docs).
// ---------------------------------------------------------------------------

interface BufferAttributeLike {
  count: number
  getX(i: number): number
  getY(i: number): number
  getZ(i: number): number
}
interface GeometryLike {
  getAttribute(name: string): BufferAttributeLike | undefined
  index?: { count: number } | null
}
interface MeshLike {
  isMesh?: boolean
  geometry?: GeometryLike
  matrixWorld?: { elements: ArrayLike<number> }
}
export interface SceneLike {
  updateMatrixWorld(force?: boolean): void
  traverse(cb: (obj: unknown) => void): void
}

/**
 * Analyse a parsed GLTF scene. Throws GlbAnalysisError when the model cannot
 * be confidently fitted as glasses. Runs once at upload time (not per load —
 * the resulting fit is persisted with the upload).
 */
export function analyzeGlassesScene(scene: SceneLike): GlassesFit {
  scene.updateMatrixWorld(true)
  const { points, triCount } = sampleScenePoints(scene)
  if (triCount > MAX_TRIANGLES) {
    throw new GlbAnalysisError(
      'too-heavy',
      `Model has ~${Math.round(triCount / 1000)}k triangles (limit ${MAX_TRIANGLES / 1000}k). Please upload a lighter model.`,
    )
  }
  return analyzeGlassesPoints(points)
}

/**
 * Gather a world-space vertex sample across every mesh (uniform stride so no
 * single mesh dominates), plus the total triangle count for the budget check.
 */
export function sampleScenePoints(scene: SceneLike): {
  points: Float32Array
  triCount: number
} {
  const meshes: { attr: BufferAttributeLike; m: ArrayLike<number> }[] = []
  let totalVerts = 0
  let triCount = 0
  scene.traverse((obj) => {
    const mesh = obj as MeshLike
    if (!mesh.isMesh || !mesh.geometry || !mesh.matrixWorld) return
    const attr = mesh.geometry.getAttribute('position')
    if (!attr || attr.count === 0) return
    meshes.push({ attr, m: mesh.matrixWorld.elements })
    totalVerts += attr.count
    triCount += Math.floor((mesh.geometry.index?.count ?? attr.count) / 3)
  })
  const stride = Math.max(1, Math.ceil(totalVerts / MAX_SAMPLE_POINTS))
  const out: number[] = []
  for (const { attr, m } of meshes) {
    for (let i = 0; i < attr.count; i += stride) {
      const x = attr.getX(i)
      const y = attr.getY(i)
      const z = attr.getZ(i)
      // Column-major 4x4 (three.js Matrix4.elements layout).
      out.push(
        m[0]! * x + m[4]! * y + m[8]! * z + m[12]!,
        m[1]! * x + m[5]! * y + m[9]! * z + m[13]!,
        m[2]! * x + m[6]! * y + m[10]! * z + m[14]!,
      )
    }
  }
  return { points: new Float32Array(out), triCount }
}

// ---------------------------------------------------------------------------
// Core analysis (pure math on a flat xyz point array).
// ---------------------------------------------------------------------------

/** One orientation hypothesis: XYZ euler + its 3x3 rotation (row-major). */
interface Orientation {
  euler: readonly [number, number, number]
  r: readonly number[]
}

const HALF_PI = Math.PI / 2

/**
 * Build the rotation matrix three.js produces for `Euler(x, y, z, 'XYZ')`
 * (M = Rx·Ry·Rz), so `group.rotation.set(...fit.preRotation)` reproduces
 * exactly the rotation the analysis validated. Row-major 3x3.
 */
function rotXYZ(x: number, y: number, z: number): number[] {
  const cx = Math.cos(x)
  const sx = Math.sin(x)
  const cy = Math.cos(y)
  const sy = Math.sin(y)
  const cz = Math.cos(z)
  const sz = Math.sin(z)
  return [
    cy * cz,
    -cy * sz,
    sy,
    cx * sz + sx * sy * cz,
    cx * cz - sx * sy * sz,
    -sx * cy,
    sx * sz - cx * sy * cz,
    sx * cz + cx * sy * sz,
    cx * cy,
  ]
}

/**
 * Axis-aligned orientation hypotheses: X tilt fixes Z-up/upside-down exports,
 * Y spin fixes temples pointing +Z/±X. Identity first so a conventional model
 * keeps preRotation [0,0,0] when scores tie.
 */
const ORIENTATIONS: Orientation[] = (() => {
  const list: Orientation[] = []
  for (const x of [0, HALF_PI, -HALF_PI, Math.PI]) {
    for (const y of [0, Math.PI, HALF_PI, -HALF_PI]) {
      list.push({ euler: [x, y, 0] as const, r: rotXYZ(x, y, 0) })
    }
  }
  return list
})()

/** Z-profile slice count (depth axis). */
const SLICES = 64

interface Hypothesis {
  fit: GlassesFit
  score: number
}

/**
 * Analyse a flat [x0,y0,z0, x1,y1,z1, …] world-space vertex sample. Throws
 * GlbAnalysisError('empty' | 'not-glasses').
 */
export function analyzeGlassesPoints(points: Float32Array): GlassesFit {
  const n = Math.floor(points.length / 3)
  if (n < 100) {
    throw new GlbAnalysisError(
      'empty',
      'No usable mesh geometry found in this file.',
    )
  }
  let best: Hypothesis | null = null
  for (const o of ORIENTATIONS) {
    const h = tryOrientation(points, n, o)
    if (h && (!best || h.score > best.score)) best = h
  }
  if (!best) {
    throw new GlbAnalysisError(
      'not-glasses',
      'Could not detect a glasses shape (front frame + two temple arms) in this model.',
    )
  }
  return best.fit
}

/** Scratch buffers reused across orientation passes (upload-time only). */
function tryOrientation(
  points: Float32Array,
  n: number,
  o: Orientation,
): Hypothesis | null {
  const r = o.r
  // Rotated bounds.
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  const rx = new Float32Array(n)
  const ry = new Float32Array(n)
  const rz = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const x = points[i * 3]!
    const y = points[i * 3 + 1]!
    const z = points[i * 3 + 2]!
    const X = r[0]! * x + r[1]! * y + r[2]! * z
    const Y = r[3]! * x + r[4]! * y + r[5]! * z
    const Z = r[6]! * x + r[7]! * y + r[8]! * z
    rx[i] = X
    ry[i] = Y
    rz[i] = Z
    if (X < minX) minX = X
    if (X > maxX) maxX = X
    if (Y < minY) minY = Y
    if (Y > maxY) maxY = Y
    if (Z < minZ) minZ = Z
    if (Z > maxZ) maxZ = Z
  }
  const rawWidth = maxX - minX
  if (!(rawWidth > 1e-9) || !isFinite(rawWidth)) return null
  const W = CANONICAL_FRAME_WIDTH_M
  const s = W / rawWidth
  // Centre X so left/right splits about 0 regardless of where the model sat.
  const cx = (minX + maxX) / 2
  const zMin = minZ * s
  const zMax = maxZ * s
  const depth = (maxZ - minZ) * s
  if (!(depth > 1e-6)) return null

  // --- Z-slice X-mass profile -------------------------------------------
  const sliceCount = new Int32Array(SLICES)
  const sliceCenter = new Int32Array(SLICES)
  const centerBand = CENTER_BAND_FRAC * W
  const invSlice = SLICES / (zMax - zMin)
  for (let i = 0; i < n; i++) {
    const z = rz[i]! * s
    let si = Math.floor((z - zMin) * invSlice)
    if (si < 0) si = 0
    if (si >= SLICES) si = SLICES - 1
    sliceCount[si]!++
    if (Math.abs((rx[i]! - cx) * s) < centerBand) sliceCenter[si]!++
  }
  // Front slab = contiguous run of centre-occupied slices from the +Z end.
  // (The frame's bridge/rims/nose pads put mass at the centre; the temple-arm
  // region only has mass at the outer edges, so its occupancy is ~0.) Sparse
  // slices are SKIPPED, not treated as the hinge: flat-shaded slabs put their
  // vertices on discrete z planes, leaving legitimately empty slices inside
  // the frame.
  const sliceH = (zMax - zMin) / SLICES
  const minSlicePts = Math.max(4, Math.floor(n * 0.0005))
  let frontStart = -1 // slice index of the frontmost occupied slice
  let hingeSlice = -1 // first dense slice (walking toward −Z) with no centre mass
  for (let si = SLICES - 1; si >= 0; si--) {
    const c = sliceCount[si]!
    if (c < minSlicePts) continue
    const occupied = sliceCenter[si]! / c >= CENTER_OCCUPANCY_MIN
    if (frontStart < 0) {
      if (occupied) frontStart = si
      continue
    }
    if (!occupied) {
      hingeSlice = si
      break
    }
  }
  if (frontStart < 0 || hingeSlice < 0) return null
  const hingeZ = zMin + (hingeSlice + 1) * sliceH
  const frontDepth = zMin + (frontStart + 1) * sliceH - hingeZ

  // --- Validation suite (the "double checks") -----------------------------
  // 1. The front slab must be a thin-ish slab at the front, not most of the model.
  if (frontDepth > 0.5 * W) return null
  // 2. Arm region length plausible relative to width.
  const armLen = hingeZ - zMin
  if (armLen < 0.35 * W || armLen > 1.7 * W) return null
  // 3. Both arms present and balanced; arms hug the outer edges.
  let armPts = 0
  let armLeft = 0
  let armCenter = 0
  let frontPts = 0
  let frontMaxAbsX = 0
  let frontMinY = Infinity
  let frontMaxY = -Infinity
  for (let i = 0; i < n; i++) {
    const z = rz[i]! * s
    const x = (rx[i]! - cx) * s
    if (z < hingeZ) {
      armPts++
      if (x < 0) armLeft++
      if (Math.abs(x) < centerBand) armCenter++
    } else {
      frontPts++
      const ax = Math.abs(x)
      if (ax > frontMaxAbsX) frontMaxAbsX = ax
      const y = ry[i]! * s
      if (y < frontMinY) frontMinY = y
      if (y > frontMaxY) frontMaxY = y
    }
  }
  if (armPts < n * 0.02 || frontPts < n * 0.1) return null
  const leftFrac = armLeft / armPts
  if (leftFrac < 0.25 || leftFrac > 0.75) return null
  if (armCenter / armPts > 0.15) return null
  // 4. Front slab spans (almost) the full width and has a plausible height.
  if (frontMaxAbsX < 0.42 * W) return null
  const frontH = frontMaxY - frontMinY
  if (frontH < 0.12 * W || frontH > 0.85 * W) return null

  // --- Seat point (bridge saddle) ----------------------------------------
  // The centre strip of the front slab spans nose-cutout edge → brow-bar top;
  // the saddle (nose contact) sits near its lower third (SEAT_RISE_FRAC,
  // calibrated on the shipped sunglasses). Seat Z is averaged from strip
  // points around that height.
  const strip = SEAT_STRIP_FRAC * W
  let stripMinY = Infinity
  let stripMaxY = -Infinity
  for (let i = 0; i < n; i++) {
    const z = rz[i]! * s
    if (z < hingeZ) continue
    if (Math.abs((rx[i]! - cx) * s) > strip) continue
    const y = ry[i]! * s
    if (y > stripMaxY) stripMaxY = y
    if (y < stripMinY) stripMinY = y
  }
  if (stripMaxY === -Infinity || stripMaxY - stripMinY < 0.003) return null
  const seatY = stripMinY + SEAT_RISE_FRAC * (stripMaxY - stripMinY)
  let seatZSum = 0
  let seatN = 0
  for (let i = 0; i < n; i++) {
    const z = rz[i]! * s
    if (z < hingeZ) continue
    if (Math.abs((rx[i]! - cx) * s) > strip) continue
    if (Math.abs(ry[i]! * s - seatY) > SEAT_Z_BAND_M) continue
    seatZSum += z
    seatN++
  }
  const seatZ = seatN > 0 ? seatZSum / seatN : 0
  // 5. The bridge contact must sit in the upper half of the front slab (a
  // glasses-shaped object rests above its vertical centre).
  if (seatY < frontMinY + 0.5 * frontH) return null

  // --- Derived occlusion params ------------------------------------------
  // The taper band targets the wearer's CANONICAL ear (fixed in normalised
  // space), clamped to the arm tip for short-armed models.
  let earCenterZ = EAR_CENTER_Z_M
  if (earCenterZ - EAR_BAND_HALF_M < zMin) earCenterZ = zMin + EAR_BAND_HALF_M
  const earTaperStartZ = earCenterZ + EAR_BAND_HALF_M
  const earTaperEndZ = earCenterZ - EAR_BAND_HALF_M
  let frontSectionZ = hingeZ - FRONT_SECTION_BEHIND_HINGE_M
  // Keep the head-on stub ahead of the ear band on very short arms.
  if (frontSectionZ <= earTaperStartZ)
    frontSectionZ = (hingeZ + earTaperStartZ) / 2

  // Score passing hypotheses: balanced arms, meaty front slab, arm length
  // near the canonical ~0.79×width ratio of real glasses.
  const score =
    Math.min(leftFrac, 1 - leftFrac) / 0.5 +
    frontPts / n +
    (1 - Math.min(1, Math.abs(armLen / W - 0.79)))

  const fit: GlassesFit = {
    unitScale: s,
    preRotation: o.euler,
    // The rotation/scale is applied about the GLB's own origin, so the seat
    // offset must also cancel the centring (cx) we applied during analysis.
    seatOffsetM: [-cx * s, -seatY, -seatZ],
    hingeZ,
    frontSectionZ,
    earTaperStartZ,
    earTaperEndZ,
  }
  return { fit, score }
}
