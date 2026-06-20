import { useRef } from 'react'
import type { ReactNode } from 'react'
import { useFrame } from '@react-three/fiber'
import { Vector3 } from 'three'
import { useFaceTransform } from '@/vto/hooks/useFaceTransform'
import { REVEAL_SOFT_M, smoothFactor } from '@/vto/lib/faceMath'
import { extractEulers } from '@/vto/lib/pd'

/**
 * The `<group>` instance type as the JSX runtime sees it. Derived from the JSX
 * intrinsic so it always matches whichever `@types/three` copy R3F/drei's JSX
 * augmentation resolves to — avoids the dual-@types/three nominal mismatch that
 * a direct `import { Group } from 'three'` triggers under `tsc -b`.
 */
type GroupInstance = NonNullable<
  Extract<JSX.IntrinsicElements['group']['ref'], { current: unknown }>['current']
>

/** Fade time constant: opacity reaches ~95% of target in ~3τ ≈ 200ms. */
const FADE_TAU_S = 0.07

/**
 * Temple reveal thresholds, in degrees of head turn. There is no 3D head in the scene
 * to occlude the arms (the face is a 2D camera frame), so we fake real occlusion with a
 * per-vertex reveal frontier that slides along each arm's baked model-Z (higher Z =
 * toward the hinge = shown; GlassesSwap bakes the Z). BOTH temples behave like real
 * glasses:
 *
 *  - HEAD-ON: both temples show their FRONT section (frontier at TEMPLE_FRONT_SECTION_Z),
 *    like real glasses seen from the front.
 *  - NEAR arm (the side turning toward the camera): GROWS from the front section back to
 *    the ear as the head yaws, reaching full length (the ear) by NEAR_GROW_FULL_DEG —
 *    roughly when the ear comes into view — after which the baked ear taper shapes the
 *    tip (the over-ear curl never renders).
 *  - FAR arm (the side turning away, passing behind the head): RECEDES from the front
 *    section back to nothing by FAR_HIDE_FULL_DEG, so it never renders across the face.
 *
 * START stays just off 0° so head-on jitter can't flicker the near/far pick — both arms
 * sit at the front section there, so which one is tagged "near" doesn't matter. Nudge
 * live; NEAR_GROW_FULL_DEG is the key dial (temple should hit the ear right as the ear
 * appears).
 */
const NEAR_GROW_START_DEG = 2
const NEAR_GROW_FULL_DEG = 16
const FAR_HIDE_START_DEG = 2
const FAR_HIDE_FULL_DEG = 14
/** Reused each frame so the temple depth read allocates nothing. */
const _templeWorldPos = new Vector3()

/**
 * The face-anchor group. Each frame it copies the smoothed MediaPipe head-pose
 * matrix onto an outer `<group>` (with `matrixAutoUpdate = false`, so React
 * never re-renders for pose). Children therefore render in MediaPipe's canonical
 * face space (centimetres, +Y up, −Z toward the camera): a child registered into
 * that frame (see GlassesSwap, which seats the GLB on the canonical nose bridge)
 * sits correctly on the user (AC1–AC4). The inner `<group>` carries only the
 * face-presence opacity fade.
 *
 * When no face is present the children fade their material opacity to 0 over
 * ~200ms (AC6) via a frame-rate-independent lerp — no spring library needed.
 * The group is kept mounted (so the GLB stays warm) but made invisible once
 * fully faded out.
 *
 * Story 06 swaps the child mesh (the catalog model) without touching this file.
 */
export function FaceAnchor({ children }: { children: ReactNode }) {
  const outerRef = useRef<GroupInstance>(null)
  const innerRef = useRef<GroupInstance>(null)
  const { read } = useFaceTransform()

  // Current animated opacity (0..1), lerped toward visible ? 1 : 0.
  const opacity = useRef(0)

  useFrame((_state, delta) => {
    const outer = outerRef.current
    const inner = innerRef.current
    if (!outer || !inner) return

    const { matrix, visible } = read()

    if (visible) {
      // Drive the pose imperatively; never via React state (Q3).
      outer.matrixAutoUpdate = false
      outer.matrix.copy(matrix)
      // Without this flag, Three.js skips outer in updateMatrixWorld() (since
      // matrixAutoUpdate=false means updateMatrix() never sets it). Children
      // would be positioned against a stale world matrix.
      outer.matrixWorldNeedsUpdate = true
    }

    // Frame-rate-independent fade (AC6). delta is seconds since last frame.
    const target = visible ? 1 : 0
    opacity.current += (target - opacity.current) * smoothFactor(delta, FADE_TAU_S)
    if (opacity.current < 0.001) opacity.current = 0
    if (opacity.current > 0.999) opacity.current = 1

    applyOpacity(inner, opacity.current)
    // Fake head occlusion for the temple arms (no 3D head in the scene): hide both
    // when head-on, reveal the near arm as the head yaws, keep the far arm hidden.
    // |yaw| from the smoothed pose matrix (read-only — does not touch the lock).
    const yawAbs = visible
      ? Math.abs(extractEulers(matrix.elements).yawDeg)
      : 0
    fadeTemples(inner, opacity.current, yawAbs)
    // Hide entirely once fully transparent to skip overdraw + avoid a stale
    // last-known pose flashing on re-acquire.
    outer.visible = opacity.current > 0
  })

  return (
    <group ref={outerRef}>
      <group ref={innerRef}>{children}</group>
    </group>
  )
}

// Minimal structural shapes so these helpers don't bind to a specific
// `@types/three` copy (the project resolves two; see GroupInstance above).
interface MaterialLike {
  transparent: boolean
  opacity: number
  depthWrite: boolean
  /** Per-material base opacity (e.g. a translucent tinted lens). Default 1. */
  userData?: { baseOpacity?: number }
}
/**
 * Per-mesh reveal data baked by GlassesSwap (bakeTempleReveal). fadeTemples reads
 * it each frame to GROW the near arm: it writes `earAlpha[i] × reveal(bakedZ[i])` into
 * the colour attribute's A channel, where the reveal frontier is driven by head yaw.
 * The reveal is PER-VERTEX-SIDED so it also works for user uploads whose frame and
 * arms are merged into one mesh (no per-side meshes to toggle).
 */
interface TempleReveal {
  /** Per-vertex Z in model-root space — the frame the frontier slides through. */
  bakedZ: Float32Array
  /** Per-vertex baked ear-taper alpha (fades near the ear; 1 ahead of the band). */
  earAlpha: Float32Array
  /** Per-vertex arm side: −1 left, +1 right, 0 frame-front (never faded). */
  side: Int8Array
  /** ±1 = pure one-sided arm mesh (can be hidden outright); 0 = mixed mesh. */
  uniformSide: -1 | 0 | 1
  /** RGBA vertex-colour attribute; we overwrite its A (every 4th float) per frame. */
  colorAttr: { array: Float32Array; needsUpdate: boolean }
  /** Per-side frontier start Z (just ahead of the arm front; nothing shows there). */
  frontZL: number
  frontZR: number
  /** The owning MODEL's head-on front-stub frontier (per-model fit). */
  frontSectionZ: number
  /** The owning MODEL's ear-taper end Z (the near arm grows toward it). */
  earEndZ: number
  /** Mesh-local centroid of each side's arm vertices (null when none) — the
   *  representative depth read that tells near from far. */
  armCtrL?: Vector3 | null
  armCtrR?: Vector3 | null
}

interface MeshLike {
  isMesh?: boolean
  name?: string
  visible?: boolean
  material?: MaterialLike | MaterialLike[]
  /**
   * GlassesSwap tags every mesh carrying arm geometry so we can grow the near
   * side / hide the far side, and bakes the per-vertex reveal data the grow
   * uses (templeReveal), including each side's arm centroid (mesh-local) for a
   * representative depth read (the mesh node origin can sit at the model
   * centre — see fadeTemples).
   */
  userData?: { isTemple?: boolean; templeReveal?: TempleReveal }
  /** Maps a point from this mesh's local space to world (refreshes matrixWorld). */
  localToWorld?: (v: Vector3) => Vector3
}
interface Traversable {
  traverse(cb: (obj: unknown) => void): void
}

/**
 * Walk the subtree and set every material's opacity, enabling transparency.
 */
function applyOpacity(root: Traversable, value: number): void {
  root.traverse((obj) => {
    const mesh = obj as MeshLike
    if (!mesh.isMesh) return
    const mat = mesh.material
    if (Array.isArray(mat)) {
      for (const m of mat) setMatOpacity(m, value)
    } else if (mat) {
      setMatOpacity(mat, value)
    }
  })
}

function setMatOpacity(mat: MaterialLike, value: number): void {
  if (!mat.transparent) mat.transparent = true
  // Scale the face-presence fade by the material's base opacity so a translucent
  // tinted lens (GlassesSwap sets userData.baseOpacity) stays see-through while
  // still fading with the face. Non-lens materials default to 1 (unchanged).
  const base = mat.userData?.baseOpacity ?? 1
  const eff = value * base
  if (mat.opacity !== eff) {
    mat.opacity = eff
    mat.depthWrite = eff >= 0.999 // avoid sorting artifacts mid-fade / on glass
  }
}

/** Smoothstep (Hermite): 0 below edge0, 1 above edge1, eased in between. */
function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

/**
 * Drive BOTH temple arms by head yaw so the rig reads like real glasses despite the
 * scene having no 3D head to occlude them. Head-on, both arms show their FRONT section;
 * as the head turns, the NEAR arm (the side rotating toward the camera) GROWS from the
 * front section back to the ear, while the FAR arm (rotating away, behind the head)
 * RECEDES from the front section to nothing — so it never renders across the face.
 *
 * The near side is the one closer to the camera — the LARGER world-space Z (camera at
 * the origin looks down −Z) — so this stays mirror-agnostic (the scene X-flip doesn't
 * change Z) and robust to the two models briefly mounted during a cross-fade. The
 * reveal is per-vertex along each arm's baked Z (writeTempleReveal), composed with the
 * soft ear taper baked in GlassesSwap.
 *
 * The face-presence fade still lives on `material.opacity` (applyOpacity wrote it
 * already this frame); the reveal only touches the per-vertex alpha, so the two compose
 * (final alpha = material.opacity × vColor.a) without fighting each other.
 */
function fadeTemples(
  root: Traversable,
  faceOpacity: number,
  yawAbs: number,
): void {
  // Mean world-space depth of each side's arm geometry (sum + count → mean).
  let zR = 0
  let nR = 0
  let zL = 0
  let nL = 0
  const temples: { mesh: MeshLike; rev: TempleReveal }[] = []
  root.traverse((obj) => {
    const mesh = obj as MeshLike
    if (!mesh.isMesh || !mesh.userData?.isTemple) return
    const rev = mesh.userData.templeReveal
    if (!rev || !mesh.localToWorld) return
    // Representative depth per side = that side's arm-vertex CENTROID in world
    // space, NOT the mesh node origin: node origins can sit at the model centre
    // (shape baked into vertex data) and so can't tell the sides apart — and a
    // merged frame+arms upload carries BOTH sides in one mesh. localToWorld
    // refreshes the world matrix before applying it.
    if (rev.armCtrL) {
      zL += mesh.localToWorld(_templeWorldPos.copy(rev.armCtrL)).z
      nL++
    }
    if (rev.armCtrR) {
      zR += mesh.localToWorld(_templeWorldPos.copy(rev.armCtrR)).z
      nR++
    }
    temples.push({ mesh, rev })
  })
  if (nR === 0 || nL === 0) return // need both sides to tell near from far
  const rightIsNear = zR / nR >= zL / nL
  // Reveal-frontier progress per side. Head-on both are 0, so both arms sit at the
  // front section (fit.frontSectionZ) — symmetric, so the near/far tie there is
  // harmless. As the head turns, the near arm grows toward the ear and the far arm
  // recedes toward the arm front.
  const growNear = smoothstep(NEAR_GROW_START_DEG, NEAR_GROW_FULL_DEG, yawAbs)
  const hideFar = smoothstep(FAR_HIDE_START_DEG, FAR_HIDE_FULL_DEG, yawAbs)
  for (const { mesh, rev } of temples) {
    if (faceOpacity <= 0.001) {
      // No face: pure arm meshes can be skipped outright; mixed (frame+arms)
      // meshes stay — the material fade has them invisible anyway.
      if (rev.uniformSide !== 0 && mesh.visible) mesh.visible = false
      continue
    }
    if (rev.uniformSide !== 0) {
      // Pure one-sided arm mesh (shipped GLBs; well-authored uploads): a
      // fully-receded far arm is hidden without the per-vertex write.
      const isNear = (rev.uniformSide === 1) === rightIsNear
      if (!isNear && hideFar >= 1) {
        if (mesh.visible) mesh.visible = false
        continue
      }
    }
    // Frontier in baked model-Z per SIDE (higher Z = toward the hinge = shown).
    // The near arm interpolates the frontier from the front section toward the
    // ear (rev.earEndZ) as it grows; the far arm interpolates it from the front
    // section toward the arm front (rev.frontZL/R) as it recedes to nothing.
    // writeTempleReveal fades the leading edge over REVEAL_SOFT_M and reports
    // whether anything is still visible.
    const frontierL =
      rightIsNear === false
        ? rev.frontSectionZ + (rev.earEndZ - rev.frontSectionZ) * growNear
        : rev.frontSectionZ + (rev.frontZL - rev.frontSectionZ) * hideFar
    const frontierR = rightIsNear
      ? rev.frontSectionZ + (rev.earEndZ - rev.frontSectionZ) * growNear
      : rev.frontSectionZ + (rev.frontZR - rev.frontSectionZ) * hideFar
    const any = writeTempleReveal(rev, frontierL, frontierR)
    // Only pure arm meshes may be hidden — a mixed mesh still carries the
    // always-visible frame front.
    mesh.visible = rev.uniformSide === 0 ? true : any
  }
}

/**
 * Write the per-vertex reveal alpha for this frame. For each ARM vertex:
 * `earAlpha × smoothstep(frontier − REVEAL_SOFT_M, frontier, bakedZ)` — fully
 * shown ahead of its side's frontier (toward the hinge, larger Z), faded over
 * the soft band just behind it (the growing leading edge), hidden further back
 * — composed with the baked ear taper. Frame-front vertices (side 0, merged
 * uploads) are pinned at 1. Returns whether any vertex is visible. Writes in
 * place into the existing colour buffer — allocates nothing per frame.
 */
function writeTempleReveal(
  rev: TempleReveal,
  frontierL: number,
  frontierR: number,
): boolean {
  const { bakedZ, earAlpha, side, colorAttr } = rev
  const arr = colorAttr.array
  const loL = frontierL - REVEAL_SOFT_M
  const loR = frontierR - REVEAL_SOFT_M
  let any = false
  for (let i = 0; i < bakedZ.length; i++) {
    const s = side[i]!
    const a =
      s === 0
        ? 1
        : earAlpha[i]! *
          (s === -1
            ? smoothstep(loL, frontierL, bakedZ[i]!)
            : smoothstep(loR, frontierR, bakedZ[i]!))
    arr[i * 4 + 3] = a
    if (a > 0.001) any = true
  }
  colorAttr.needsUpdate = true
  return any
}
