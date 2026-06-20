import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useGLTF } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { BufferAttribute, Group, Matrix4, Vector3 } from 'three'
import type { Object3D, Material, Mesh, MeshPhysicalMaterial } from 'three'
import { useCatalogStore } from '@/vto/stores/catalogStore'
import { useFaceStore } from '@/vto/stores/faceStore'
import { FRAMES } from '@/vto/data/frames'
import type { Tint } from '@/vto/data/tints'
import {
  DEFAULT_FIT,
  MODEL_TO_CM,
  NOSE_BRIDGE_ANCHOR_CM,
  REVEAL_SOFT_M,
  makeScalarFilter,
  templeReachScale,
} from '@/vto/lib/faceMath'
import type { GlassesFit } from '@/vto/lib/glbAnalyzer'
import { GLBErrorBoundary } from '@/vto/components/Scene/GLBErrorBoundary'

/** Cross-fade duration budget (AC6: ≤250ms). */
const FADE_MS = 250

/**
 * Extra mirror reflectivity applied to the FRONT (exterior) lens shell only.
 * The lens is two stacked shells — `lens_exterior` faces the world, `lens_interior`
 * faces the eyes — and a real mirror coating lives on the outward face. So we boost
 * the exterior shell's reflectivity 20% over the tint's base, leaving the interior
 * shell at the base. For flat (non-mirror) tints metalness is 0, so ×1.2 is still 0
 * and nothing changes; only reflective tints (e.g. Silver Mirror) read stronger up
 * front.
 */
const FRONT_MIRROR_BOOST = 1.2

/**
 * Same-origin placeholder GLB used as the fallback when a catalog model fails to
 * load (Story 09 AC10). Preloaded so the fallback is instant.
 */
const PLACEHOLDER_URL = '/glasses/placeholder.glb'
useGLTF.preload(PLACEHOLDER_URL)

/** Preload the first 3 frames in catalog order on app start (AC10 polish). */
FRAMES.slice(0, 3).forEach((f) => useGLTF.preload(f.modelUrl))

/**
 * Renders the currently-selected catalog GLB inside `<FaceAnchor>` and cross-
 * fades to the new model whenever the selection changes (AC6). During a swap it
 * mounts BOTH the outgoing and incoming model and animates their material
 * opacity in `useFrame`: old → 0, new → 1 over ≤250ms.
 *
 * Opacity interplay with FaceAnchor: FaceAnchor's own `useFrame` writes a single
 * face-presence fade value onto every descendant material each frame. This
 * component's `useFrame` runs *after* it (child registers after parent), so we
 * read FaceAnchor's value off the material and MULTIPLY it by the per-model swap
 * fraction — preserving both the on-face-loss fade and the swap cross-fade.
 */
export function GlassesSwap() {
  const selected = useCatalogStore((s) => s.selected)
  const modelUrl = selected?.modelUrl

  // Per-model registration params: shipped catalog GLBs are authored to the
  // canonical conventions (DEFAULT_FIT); user uploads carry their own fit
  // derived by glbAnalyzer at upload time.
  const fit = selected?.fit ?? DEFAULT_FIT
  const genericLens = selected?.custom === true

  // The model currently fading IN (the live selection).
  const currentUrl = modelUrl
  // The model fading OUT during a swap, with the fit it was mounted with (a
  // custom frame's fit differs from the incoming one's). Held in STATE, not a
  // ref: clearing it when the fade completes re-renders and UNMOUNTS the
  // outgoing model, so the old frame leaves the scene instead of lingering
  // behind the new one.
  const [prev, setPrev] = useState<
    { url: string; fit: GlassesFit; genericLens: boolean } | undefined
  >(undefined)
  const swapStart = useRef<number>(0)
  // Set true whenever the selection changes; cleared when the fade completes.
  const swapping = useRef(false)

  // Track previous selection to detect changes without re-render churn.
  const last = useRef<
    { url: string; fit: GlassesFit; genericLens: boolean } | undefined
  >(currentUrl ? { url: currentUrl, fit, genericLens } : undefined)
  if (currentUrl !== last.current?.url) {
    setPrev(last.current)
    last.current = currentUrl ? { url: currentUrl, fit, genericLens } : undefined
    swapStart.current = performance.now()
    swapping.current = true
  }

  // Fade done → drop the outgoing model from the tree. Called once per swap by
  // the incoming model when its cross-fade reaches t=1 (see FadeModel).
  const endSwap = useCallback(() => setPrev(undefined), [])

  return (
    <group>
      {currentUrl && (
        <GLBErrorBoundary
          url={currentUrl}
          resetKey={currentUrl}
          fallback={
            <FadeModel
              url={PLACEHOLDER_URL}
              fit={DEFAULT_FIT}
              genericLens={false}
              role="incoming"
              swapStart={swapStart}
              swapping={swapping}
              onSwapEnd={endSwap}
            />
          }
        >
          <FadeModel
            url={currentUrl}
            fit={fit}
            genericLens={genericLens}
            role="incoming"
            swapStart={swapStart}
            swapping={swapping}
            onSwapEnd={endSwap}
          />
        </GLBErrorBoundary>
      )}
      {prev && prev.url !== currentUrl && (
        <GLBErrorBoundary
          url={prev.url}
          resetKey={prev.url}
          fallback={
            <FadeModel
              url={PLACEHOLDER_URL}
              fit={DEFAULT_FIT}
              genericLens={false}
              role="outgoing"
              swapStart={swapStart}
              swapping={swapping}
            />
          }
        >
          <FadeModel
            url={prev.url}
            fit={prev.fit}
            genericLens={prev.genericLens}
            role="outgoing"
            swapStart={swapStart}
            swapping={swapping}
          />
        </GLBErrorBoundary>
      )}
    </group>
  )
}

interface FadeModelProps {
  url: string
  /** Per-model registration/occlusion params (DEFAULT_FIT for shipped GLBs). */
  fit: GlassesFit
  /** Custom uploads: detect lens materials heuristically (no naming contract). */
  genericLens: boolean
  role: 'incoming' | 'outgoing'
  swapStart: React.MutableRefObject<number>
  swapping: React.MutableRefObject<boolean>
  /** Incoming model only: fired once when the cross-fade reaches t=1. */
  onSwapEnd?: () => void
}

/**
 * One GLB instance whose materials we drive each frame. Clones the loaded scene
 * so each catalog entry (and each old/new instance during a swap) owns its own
 * materials and we can set opacity independently.
 */
function FadeModel({
  url,
  fit,
  genericLens,
  role,
  swapStart,
  swapping,
  onSwapEnd,
}: FadeModelProps) {
  const { scene } = useGLTF(url)
  const tint = useCatalogStore((s) => s.selectedTint)

  // Adaptive temple-arm length (Bug #1): a one-Euro-smoothed scalar written onto
  // the per-side hinge pivots each frame. Held in refs — never React state, so
  // the per-frame update costs zero re-renders (same contract as FaceAnchor).
  const armFilter = useRef<ReturnType<typeof makeScalarFilter>>()
  if (!armFilter.current) armFilter.current = makeScalarFilter()
  const armScale = useRef(1)

  // Clone so opacity edits don't mutate the drei-cached source scene (which is
  // shared across mounts). Materials are cloned too (true deep clone).
  const cloned = useMemo(() => {
    const src = scene.clone(true) as Group
    // Wrapper chain registering the GLB into the canonical model frame:
    //   root — seat offset (in normalised metres): moves the model's
    //          bridge-saddle contact onto its local origin so
    //          NOSE_BRIDGE_ANCHOR_CM (applied by the parent) lands it on the
    //          nose. Scaled to cm by the wrapper group below.
    //   norm — per-model normalisation: the analyzer's orientation fix +
    //          native-units → metres scale. Identity for shipped GLBs
    //          (DEFAULT_FIT), so they reproduce the old structure exactly.
    const root = new Group()
    root.position.set(fit.seatOffsetM[0], fit.seatOffsetM[1], fit.seatOffsetM[2])
    const norm = new Group()
    norm.rotation.set(fit.preRotation[0], fit.preRotation[1], fit.preRotation[2])
    norm.scale.setScalar(fit.unitScale)
    norm.add(src)
    root.add(norm)

    const meshes: Mesh[] = []
    root.traverse((obj) => {
      const mesh = obj as Mesh
      if (!mesh.isMesh) return
      meshes.push(mesh)
      const mat = mesh.material
      const ensure = (m: Material) => {
        m.transparent = true
        return m
      }
      mesh.material = Array.isArray(mat)
        ? mat.map((m) => ensure(m.clone()))
        : ensure((mat as Material).clone())
    })

    // Bake per-vertex temple-reveal data (see bakeTempleReveal): each vertex's
    // model-root Z (the frame the yaw-driven frontier slides through), its arm
    // SIDE, and a soft ear-taper alpha. Arm-mesh discovery is two-tier:
    //   - Named fast path: the shipped GLBs split each arm into `Temple*` +
    //     `Earhook*` meshes — only those are scanned, exactly as before.
    //   - Geometric fallback (user uploads, arbitrary/merged meshes): EVERY
    //     mesh is scanned; any vertex behind the model's hinge Z is arm
    //     geometry, classified left/right by its X sign. A merged
    //     frame+arms mesh works because the reveal is per-vertex.
    root.updateMatrixWorld(true)
    const rootInv = new Matrix4().copy(root.matrixWorld).invert()
    const meshToModel = new Matrix4()
    const named = meshes.filter(
      (m) => TEMPLE_NAME_RE.test(m.name) || EARHOOK_NAME_RE.test(m.name),
    )
    const candidates = named.length > 0 ? named : meshes
    const arms: { left: Mesh[]; right: Mesh[] } = { left: [], right: [] }
    const baked: TempleReveal[] = []
    let maxArmZL = -Infinity
    let maxArmZR = -Infinity
    for (const mesh of candidates) {
      meshToModel.copy(rootInv).multiply(mesh.matrixWorld)
      // Named meshes are KNOWN arms — always pure one-sided, even if some
      // vertices sit ahead of the hinge plane (e.g. the stub's hinge cap).
      const rev = bakeTempleReveal(mesh, meshToModel, fit, named.length > 0)
      if (!rev) continue
      baked.push(rev)
      mesh.userData.isTemple = true
      mesh.userData.templeReveal = rev
      if (rev.maxArmZL > maxArmZL) maxArmZL = rev.maxArmZL
      if (rev.maxArmZR > maxArmZR) maxArmZR = rev.maxArmZR
      if (rev.uniformSide === -1) arms.left.push(mesh)
      else if (rev.uniformSide === 1) arms.right.push(mesh)
    }
    // Frontier-start just AHEAD of the frontmost arm vertex = the "nothing
    // shown" position; the far arm recedes to this as the head turns away
    // (FaceAnchor). Per SIDE, shared across the model's meshes.
    for (const rev of baked) {
      rev.frontZL = maxArmZL + REVEAL_SOFT_M
      rev.frontZR = maxArmZR + REVEAL_SOFT_M
    }

    // Discard stray geometry sitting ENTIRELY behind the model's ear-taper end
    // Z — the zone the arm is designed never to render (the over-ear curl fades
    // to alpha 0 there). The named arm classifier only claims `Temple*`/
    // `Earhook*`, so rear cap/tip meshes it doesn't recognise (e.g. FunnyBaby's
    // `Tip*`/`TipBand*`) would otherwise linger at full opacity at every head
    // angle, since `fadeTemples` only fades meshes tagged `isTemple`. Anything
    // already baked as an arm (isTemple) is left alone — its own taper hides it.
    const discard: Mesh[] = []
    for (const mesh of meshes) {
      if (mesh.userData.isTemple) continue
      meshToModel.copy(rootInv).multiply(mesh.matrixWorld)
      mesh.geometry.computeBoundingBox()
      const box = mesh.geometry.boundingBox?.clone()
      if (!box) continue
      box.applyMatrix4(meshToModel)
      if (box.max.z < fit.earTaperEndZ) discard.push(mesh)
    }
    // Remove only from the scene graph — the geometry is shared by reference
    // with the drei-cached source scene (scene.clone(true) shares geometry), so
    // disposing it would corrupt other mounts.
    for (const mesh of discard) mesh.parent?.remove(mesh)

    // Per-side hinge pivot at the frame/temple junction. `attach` reparents each
    // arm mesh while preserving its world transform, so the depth fade still
    // tells the sides apart; scaling the pivot's Z then lengthens the arm away
    // from the hinge (the front frame, lenses and nose pads stay put). Only
    // possible when BOTH arms are separable one-sided meshes — a merged
    // frame+arms upload keeps its authored arm length (the ear taper still
    // ends it softly).
    if (arms.left.length > 0 && arms.right.length > 0) {
      const makePivot = (side: 'left' | 'right', sideMeshes: Mesh[]): Group => {
        const pivot = new Group()
        pivot.name = `armPivot_${side}`
        pivot.position.set(0, 0, fit.hingeZ)
        root.add(pivot)
        for (const m of sideMeshes) pivot.attach(m)
        return pivot
      }
      root.userData.armPivots = {
        left: makePivot('left', arms.left),
        right: makePivot('right', arms.right),
      }
    }
    return root
  }, [scene, fit])

  // Recolour the lens to the selected tint and make it see-through. Keyed on the
  // tint (not the URL), so switching tints mutates the already-cloned lens
  // material in place — no GLB reload, no cross-fade. Runs again when a model
  // swap produces a fresh clone.
  useEffect(() => {
    if (tint) applyTint(cloned, tint, genericLens)
  }, [cloned, tint, genericLens])

  // Start incoming models transparent so they don't pop before the fade begins.
  useEffect(() => {
    setSubtreeOpacityFactor(cloned, role === 'incoming' ? 0 : 1)
  }, [cloned, role])

  useFrame(() => {
    // Adaptive arm length runs every frame, independent of model swaps.
    const pivots = (
      cloned.userData as { armPivots?: { left: Group; right: Group } }
    ).armPivots
    if (pivots) {
      const target = templeReachScale(useFaceStore.getState().faceLandmarks)
      // Hold the last good value across frames with no face (target === null).
      if (target != null) {
        armScale.current = armFilter.current!.filter(target, performance.now())
      }
      pivots.left.scale.z = armScale.current
      pivots.right.scale.z = armScale.current
    }

    if (!swapping.current) {
      // Steady state: incoming is fully shown; outgoing is driven to 0 so it
      // never flashes back in (FaceAnchor rewrites opacity to full each frame)
      // during the frame or two before React unmounts it.
      setSubtreeOpacityFactor(cloned, role === 'incoming' ? 1 : 0)
      return
    }
    const t = clamp((performance.now() - swapStart.current) / FADE_MS, 0, 1)
    const factor = role === 'incoming' ? t : 1 - t
    setSubtreeOpacityFactor(cloned, factor)
    // Only the incoming model ends the swap — and asks the parent to unmount the
    // outgoing one. Letting the outgoing model clear `swapping` would race the
    // unmount and could strand the old frame on screen.
    if (t >= 1 && role === 'incoming') {
      swapping.current = false
      onSwapEnd?.()
    }
  })

  // Register the model into MediaPipe's canonical face frame: place the model's
  // (seated) bridge contact on the canonical nose bridge, then scale the
  // metre-authored geometry into the centimetre scene.
  return (
    <group
      position={[
        NOSE_BRIDGE_ANCHOR_CM[0],
        NOSE_BRIDGE_ANCHOR_CM[1],
        NOSE_BRIDGE_ANCHOR_CM[2],
      ]}
    >
      <group scale={MODEL_TO_CM}>
        <primitive object={cloned} />
      </group>
    </group>
  )
}

/**
 * Multiply every material's CURRENT opacity (the face-presence fade FaceAnchor
 * just wrote) by `factor` (the swap cross-fade fraction). Stores the base value
 * on the material so repeated multiplies don't compound.
 */
function setSubtreeOpacityFactor(root: Object3D, factor: number) {
  root.traverse((obj) => {
    const mesh = obj as Mesh
    if (!mesh.isMesh) return
    const apply = (m: Material) => {
      // FaceAnchor's face-presence value is the material's opacity coming into
      // this frame (FaceAnchor's useFrame ran first). Multiply by the swap
      // fraction so both fades compose.
      m.transparent = true
      m.opacity = m.opacity * factor
    }
    const mat = mesh.material
    if (Array.isArray(mat)) mat.forEach(apply)
    else if (mat) apply(mat)
  })
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v))
}

/** Smoothstep (Hermite): 0 below edge0, 1 above edge1, eased in between. */
function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1)
  return t * t * (3 - 2 * t)
}

/** Reused per-vertex during the one-time reveal bake (never per frame). */
const _bakeV = new Vector3()

/**
 * Per-arm-mesh reveal data, stashed on `mesh.userData.templeReveal`. FaceAnchor
 * reads it each frame to GROW the near arm (see FaceAnchor.fadeTemples).
 */
interface TempleReveal {
  /** Per-vertex Z in model-root space — the frame the reveal frontier slides through. */
  bakedZ: Float32Array
  /** Per-vertex baked ear-taper alpha (1 ahead of the band; fades to 0 behind the ear). */
  earAlpha: Float32Array
  /**
   * Per-vertex arm side: −1 left, +1 right, 0 frame-front (never faded). For a
   * pure one-sided arm mesh every vertex carries the mesh's side.
   */
  side: Int8Array
  /**
   * −1/+1 when the mesh is a pure one-sided arm (≥90% of its vertices behind
   * the hinge) — it can be hidden outright and length-scaled via a hinge
   * pivot. 0 = mixed mesh (e.g. a merged frame+arms upload): per-vertex only.
   */
  uniformSide: -1 | 0 | 1
  /** The RGBA vertex-colour attribute whose A channel FaceAnchor rewrites per frame. */
  colorAttr: BufferAttribute
  /** Per-side reveal-frontier start Z (just ahead of that arm's front). */
  frontZL: number
  frontZR: number
  /** This model's head-on front-stub frontier (fit.frontSectionZ). */
  frontSectionZ: number
  /** This model's ear-taper end Z (the near arm grows toward it). */
  earEndZ: number
  /** Mesh-LOCAL centroid of each side's arm vertices (null if none) — gives
   *  FaceAnchor a representative world depth per side (near/far detection). */
  armCtrL: Vector3 | null
  armCtrR: Vector3 | null
  /** Per-side max baked arm-vertex Z (used to place the frontier starts). */
  maxArmZL: number
  maxArmZR: number
}

/**
 * Bake the per-vertex data the yaw-driven temple reveal needs into one mesh, in
 * model-root Z space. Returns null when the mesh has no arm geometry (no
 * vertices behind the model's hinge Z) — the mesh is left untouched.
 *
 * Stores each vertex's baked Z, its arm SIDE (left/right by baked X sign; 0 for
 * frame-front vertices of a mixed mesh, which never fade), and a baked
 * ear-taper alpha — vertices ahead of fit.earTaperStartZ stay fully opaque,
 * vertices behind fit.earTaperEndZ fade to 0 so the over-ear curl never
 * renders. A mesh with ≥90% of its vertices behind the hinge is a PURE arm
 * (uniformSide ±1): all its vertices (including the few hinge-side ones) carry
 * the arm side so the far arm hides completely, exactly like the shipped GLBs'
 * named `Temple…`/`Earhook…` meshes.
 *
 * The alpha lives in a 4-component `color` BufferAttribute (RGB copied from any
 * authored vertex colours, else 1, so the lit colour is unchanged; A=alpha).
 * With `material.vertexColors = true` Three multiplies it into the fragment
 * (USE_COLOR_ALPHA), so final alpha is `material.opacity × vColor.a` — pure
 * opacity, no custom shader. FaceAnchor overwrites the A channel every frame
 * with `earAlpha × reveal(bakedZ)` to slide the reveal frontier from the hinge
 * to the ear as the head turns. `meshToModel` maps the mesh's local vertices
 * into the model-root frame where the fit's Z params are defined; the geometry
 * is cloned first because `scene.clone(true)` shares it with the drei cache and
 * every other instance.
 */
function bakeTempleReveal(
  mesh: Mesh,
  meshToModel: Matrix4,
  fit: GlassesFit,
  forceArm: boolean,
): TempleReveal | null {
  const srcPos = mesh.geometry.getAttribute('position')
  const n = srcPos.count
  if (n === 0) return null

  // Pass 1 (no allocation): is there any arm geometry, and is the mesh a pure
  // one-sided arm?
  let armCount = 0
  let armLeft = 0
  for (let i = 0; i < n; i++) {
    _bakeV
      .set(srcPos.getX(i), srcPos.getY(i), srcPos.getZ(i))
      .applyMatrix4(meshToModel)
    if (_bakeV.z < fit.hingeZ) {
      armCount++
      if (_bakeV.x < 0) armLeft++
    }
  }
  if (armCount === 0) return null
  // Pure = (almost) all vertices are arm geometry AND they sit on ONE side —
  // a both-arms-in-one-mesh upload must stay per-vertex (mixed), or hiding
  // "the far arm" would hide both.
  const leftFrac = armLeft / armCount
  const homogeneous = leftFrac <= 0.1 || leftFrac >= 0.9
  const pure = (forceArm || armCount >= n * 0.9) && homogeneous
  const uniformSide: -1 | 0 | 1 = pure ? (leftFrac >= 0.5 ? -1 : 1) : 0

  mesh.geometry = mesh.geometry.clone()
  const pos = mesh.geometry.getAttribute('position')
  const srcColor = mesh.geometry.getAttribute('color')
  const bakedZ = new Float32Array(n)
  const earAlpha = new Float32Array(n)
  const side = new Int8Array(n)
  const colors = new Float32Array(n * 4)
  const ctrL = new Vector3()
  const ctrR = new Vector3()
  let nL = 0
  let nR = 0
  let maxArmZL = -Infinity
  let maxArmZR = -Infinity
  for (let i = 0; i < n; i++) {
    const lx = pos.getX(i)
    const ly = pos.getY(i)
    const lz = pos.getZ(i)
    _bakeV.set(lx, ly, lz).applyMatrix4(meshToModel)
    const z = _bakeV.z
    bakedZ[i] = z
    const s: -1 | 0 | 1 = pure
      ? uniformSide
      : z < fit.hingeZ
        ? _bakeV.x < 0
          ? -1
          : 1
        : 0
    side[i] = s
    if (s === -1) {
      ctrL.x += lx
      ctrL.y += ly
      ctrL.z += lz
      nL++
      if (z > maxArmZL) maxArmZL = z
    } else if (s === 1) {
      ctrR.x += lx
      ctrR.y += ly
      ctrR.z += lz
      nR++
      if (z > maxArmZR) maxArmZR = z
    }
    // Soft ear taper: 1 ahead of the band, 0 behind the ear. Frame-front
    // vertices (side 0) are pinned fully opaque.
    const a =
      s === 0 ? 1 : smoothstep(fit.earTaperEndZ, fit.earTaperStartZ, z)
    earAlpha[i] = a
    // Preserve any authored vertex colours in RGB; A carries the reveal.
    colors[i * 4] = srcColor ? srcColor.getX(i) : 1
    colors[i * 4 + 1] = srcColor ? srcColor.getY(i) : 1
    colors[i * 4 + 2] = srcColor ? srcColor.getZ(i) : 1
    colors[i * 4 + 3] = a
  }
  if (nL > 0) ctrL.multiplyScalar(1 / nL)
  if (nR > 0) ctrR.multiplyScalar(1 / nR)
  const colorAttr = new BufferAttribute(colors, 4)
  mesh.geometry.setAttribute('color', colorAttr)
  const enable = (m: Material) => {
    m.vertexColors = true
    m.transparent = true
    m.needsUpdate = true
  }
  const mat = mesh.material
  if (Array.isArray(mat)) for (const m of mat) enable(m)
  else if (mat) enable(mat)
  return {
    bakedZ,
    earAlpha,
    side,
    uniformSide,
    colorAttr,
    frontZL: 0,
    frontZR: 0,
    frontSectionZ: fit.frontSectionZ,
    earEndZ: fit.earTaperEndZ,
    armCtrL: nL > 0 ? ctrL : null,
    armCtrR: nR > 0 ? ctrR : null,
    maxArmZL,
    maxArmZR,
  }
}

/**
 * Materials whose name matches are lenses (sunglasses.glb: `lens_interior`,
 * `lens_exterior`). The metal front frame shares the `temples` material, so it
 * is never matched; `nose_pads` (also transmission=1) deliberately is not either
 * — keep the pattern narrow so we only ever recolour glass.
 */
const LENS_NAME_RE = /lens/i

/**
 * The shipped GLBs split each arm into a short `Temple*` hinge stub and a long
 * `Earhook*` mesh (the rear arm PLUS the curl that rests on/behind the ear).
 * When meshes with these names exist they are the ONLY arm candidates (fast
 * path — keeps the front `Frames` rim, which shares the `temples` *material*,
 * out of the scan). User uploads carry no naming contract, so when nothing
 * matches, EVERY mesh goes through the geometric arm scan instead (see the
 * clone setup above).
 */
const EARHOOK_NAME_RE = /^earhook/i
const TEMPLE_NAME_RE = /^temple/i

/**
 * A material "looks like a lens" (custom uploads only — no naming contract):
 * real-glass exports use transmission, everything else marks the glass
 * see-through via alpha.
 */
function looksLikeLens(m: Material): boolean {
  const phys = m as MeshPhysicalMaterial
  if (typeof phys.transmission === 'number' && phys.transmission > 0.2)
    return true
  return m.transparent === true && m.opacity < 0.95
}

/**
 * Apply a lens tint across a model: recolour + soften the lens material(s), pin a
 * deterministic draw order on the two overlapping lens shells (so they don't
 * sort-flicker on fast motion), and mark everything else fully opaque
 * (`baseOpacity` 1) for the face-presence fade. For custom uploads
 * (`genericLens`) lens materials are also detected heuristically.
 */
function applyTint(root: Object3D, tint: Tint, genericLens: boolean) {
  root.traverse((obj) => {
    const mesh = obj as Mesh
    if (!mesh.isMesh) return
    const mats = Array.isArray(mesh.material)
      ? mesh.material
      : mesh.material
        ? [mesh.material]
        : []
    let lensName: string | undefined
    for (const m of mats) {
      // Never tint arm/frame geometry that carries reveal data — a transparent
      // authored material there would otherwise false-positive the heuristic.
      const isLens =
        LENS_NAME_RE.test(m.name) ||
        (genericLens && !mesh.userData.isTemple && looksLikeLens(m))
      if (isLens) {
        tintLensMaterial(m as MeshPhysicalMaterial, tint)
        lensName = m.name
      } else {
        m.userData.baseOpacity = 1
      }
    }
    // The lens is two stacked translucent shells (lens_interior / lens_exterior);
    // with depthWrite off their relative draw order is otherwise undefined and
    // can flip frame-to-frame on fast head motion (shimmer). Pin the inner shell
    // to draw after (on top of) the outer; frame parts keep the default order 0.
    if (lensName) mesh.renderOrder = /interior/i.test(lensName) ? 2 : 1
  })
}

/**
 * Turn one baked lens material into a predictable see-through tinted glass.
 *
 * The shipped lens uses KHR_materials_transmission with a near-black baseColor;
 * the transmission pass renders the background (the wearer's eyes) multiplied by
 * that near-black colour — i.e. black — so opacity ALONE can't reveal the eyes.
 * We switch transmission off and drive a plain alpha-blended tint: the chosen
 * colour at `lensOpacity`, the base the per-frame fade writers multiply into the
 * final alpha (see FaceAnchor.setMatOpacity). ~0.5 leaves a hint of the eyes.
 */
function tintLensMaterial(m: MeshPhysicalMaterial, tint: Tint) {
  m.transmission = 0
  m.iridescence = 0
  const baseMetalness = tint.metalness ?? 0
  // The front (exterior) shell carries the mirror coating, so it reflects 20%
  // harder than the base; the interior shell keeps the base value (see
  // FRONT_MIRROR_BOOST). Matched on the material name the GLB ships.
  const isFront = /exterior/i.test(m.name)
  m.metalness = isFront ? baseMetalness * FRONT_MIRROR_BOOST : baseMetalness
  m.roughness = tint.roughness ?? 0.5
  // HDRI reflection strength — lower tames the mirror "blowout" that can wash
  // out the eyes on reflective tints. Default 1 leaves matte tints unchanged.
  m.envMapIntensity = tint.envMapIntensity ?? 1
  // Realism: a thin clear-coat over the glass adds the crisp surface specular a
  // real lens catches from the environment, on top of the tinted body beneath —
  // sells it as physical glass rather than a flat coloured plane. Cheap (one
  // extra specular lobe) and tint-agnostic, so every lens benefits.
  m.clearcoat = 1
  m.clearcoatRoughness = 0.1
  m.color.set(tint.colorHex)
  m.transparent = true
  m.userData.baseOpacity = tint.lensOpacity
  m.needsUpdate = true
}
