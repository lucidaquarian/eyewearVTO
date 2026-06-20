/**
 * THROWAWAY headless verification for the glasses anchoring math (Story 11 fix).
 *
 * The on-face behaviour was never verifiable headlessly before, which let a
 * units/FOV bug ship. This exercises the REAL shipping constants from
 * src/lib/faceMath.ts and reproduces the exact render transform chain +
 * camera projection, then asserts the glasses project onto the face's own
 * landmark positions at a sensible size — i.e. they actually sit on the face.
 *
 * It does NOT need a GPU/webcam: MediaPipe's pose matrix is deterministic given
 * a head pose, and the canonical face landmark positions are fixed data.
 *
 * Run from app/:  node scripts/verify-anchor-projection.mjs
 */
import { build } from '../node_modules/.pnpm/esbuild@0.25.12/node_modules/esbuild/lib/main.js'
import { pathToFileURL } from 'node:url'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
async function load(entry) {
  const r = await build({
    entryPoints: [join(root, entry)],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    alias: { '@': join(root, 'src') },
  })
  const dir = mkdtempSync(join(tmpdir(), 'vto-vap-'))
  const file = join(dir, 'mod.mjs')
  writeFileSync(file, r.outputFiles[0].text)
  return import(pathToFileURL(file).href)
}

const THREE = await import('three')
const { Matrix4, Vector3, PerspectiveCamera } = THREE
const faceMath = await load('src/lib/faceMath.ts')
const {
  NOSE_BRIDGE_ANCHOR_CM,
  MODEL_TO_CM,
  MODEL_SEAT_OFFSET_M,
  matrixFromMediaPipe,
} = faceMath

let failures = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`)
  if (!cond) failures++
}

// ---- Scene camera: must match SceneCanvas (fov 63, origin, near 1, far 10000) -
const W = 1280
const H = 720
const cam = new PerspectiveCamera(63, W / H, 1, 10000)
cam.position.set(0, 0, 0)
cam.updateMatrixWorld(true)
cam.updateProjectionMatrix()

const toScreen = (pCam) => {
  // pCam is already in camera/world space (camera at origin). project() handles
  // the perspective divide + NDC. Returns pixel coords (origin top-left).
  const v = pCam.clone().project(cam)
  return {
    x: (v.x * 0.5 + 0.5) * W,
    y: (1 - (v.y * 0.5 + 0.5)) * H,
    ndcZ: v.z,
  }
}

// ---- Canonical face landmarks (cm), from canonical_face_model.obj ------------
const L = {
  bridge168: new Vector3(0, 3.271, 5.236),
  templeL234: new Vector3(-7.664, 0.673, -2.436),
  templeR454: new Vector3(7.664, 0.673, -2.436),
  noseTip1: new Vector3(0, -1.127, 7.476),
}

// ---- Model key points (in the GLB's METRE space) ----------------------------
// Bridge-saddle contact and the front-frame left/right extremes (Agent 2).
const M = {
  bridgeSaddle: new Vector3(0, 0.03078, -0.00206),
  frameRight: new Vector3(0.07492, 0.03078, -0.00206),
  frameLeft: new Vector3(-0.07492, 0.03078, -0.00206),
}

// Build a realistic MediaPipe pose matrix for a head at distance d (cm),
// optional yaw, centred. MediaPipe emits column-major; matrixFromMediaPipe
// consumes it via fromArray. We build with three then read .elements (also
// column-major) to feed the real code path.
function poseMatrix(distanceCm, yawRad = 0, offsetX = 0, offsetY = 0) {
  const m = new Matrix4().makeRotationY(yawRad)
  m.setPosition(offsetX, offsetY, -distanceCm)
  // round-trip through the shipping builder using the column-major elements
  return matrixFromMediaPipe(m.elements)
}

// Apply the FULL registration chain (no mirror — the selfie mirror is a display
// scale applied equally to video + scene, so it cancels for on-face alignment):
//   pose · translate(BRIDGE_cm) · scale(MODEL_TO_CM) · translate(seat_m) · vModel
function glassesPointToCam(pose, vModelMetres) {
  const reg = new Matrix4()
    .makeTranslation(...NOSE_BRIDGE_ANCHOR_CM)
    .multiply(new Matrix4().makeScale(MODEL_TO_CM, MODEL_TO_CM, MODEL_TO_CM))
    .multiply(new Matrix4().makeTranslation(...MODEL_SEAT_OFFSET_M))
  return vModelMetres.clone().applyMatrix4(reg).applyMatrix4(pose)
}
function faceLandmarkToCam(pose, vCanonCm) {
  return vCanonCm.clone().applyMatrix4(pose)
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)

// ===== Test 1: centred face at 60 cm — glasses bridge lands on face bridge =====
{
  const pose = poseMatrix(60)
  const faceBridge = toScreen(faceLandmarkToCam(pose, L.bridge168))
  const glassBridge = toScreen(glassesPointToCam(pose, M.bridgeSaddle))
  check(
    'bridge: glasses bridge ≈ face bridge landmark',
    dist(faceBridge, glassBridge) < 1,
    `face=(${faceBridge.x.toFixed(0)},${faceBridge.y.toFixed(0)}) glass=(${glassBridge.x.toFixed(0)},${glassBridge.y.toFixed(0)})`,
  )
  check(
    'bridge: projects near screen centre for a centred face',
    Math.abs(faceBridge.x - W / 2) < 40 && Math.abs(faceBridge.y - H / 2) < 80,
    `(${faceBridge.x.toFixed(0)},${faceBridge.y.toFixed(0)}) vs centre (${W / 2},${H / 2})`,
  )
}

// ===== Test 2: glasses are a real-world ~15 cm, just inside the temples (3D) ===
// Compare in metric cm, NOT projected pixels: the frame front (Z≈+5) and the
// temple landmarks (Z≈−2.4) are at different depths, so a pixel comparison is
// depth-confounded. The real invariant is the metric size MediaPipe assumes.
{
  const pose = poseMatrix(60)
  const gL = glassesPointToCam(pose, M.frameLeft)
  const gR = glassesPointToCam(pose, M.frameRight)
  const fL = faceLandmarkToCam(pose, L.templeL234)
  const fR = faceLandmarkToCam(pose, L.templeR454)
  const glassW = gL.distanceTo(gR) // cm
  const faceW = fL.distanceTo(fR) // cm
  check(
    'width: glasses front is a realistic ~14–15 cm',
    glassW > 13.5 && glassW < 15.5,
    `${glassW.toFixed(2)} cm`,
  )
  check(
    'width: glasses front sits just inside temple-to-temple (0.9–1.0×)',
    glassW > 0.9 * faceW && glassW <= faceW,
    `glasses=${glassW.toFixed(2)}cm temples=${faceW.toFixed(2)}cm ratio=${(glassW / faceW).toFixed(3)}`,
  )
}

// ===== Test 3: in frustum & in front of camera (not clipped, not behind) ======
{
  const pose = poseMatrix(60)
  for (const [name, v] of [
    ['bridge', glassesPointToCam(pose, M.bridgeSaddle)],
    ['frameR', glassesPointToCam(pose, M.frameRight)],
  ]) {
    const s = toScreen(v)
    check(
      `frustum: ${name} z within (-far,-near) and on-screen`,
      v.z < -1 && v.z > -10000 && s.x > 0 && s.x < W && s.y > 0 && s.y < H,
      `zCam=${v.z.toFixed(1)}cm screen=(${s.x.toFixed(0)},${s.y.toFixed(0)}) ndcZ=${s.ndcZ.toFixed(3)}`,
    )
  }
}

// ===== Test 4: distance scaling — closer face → larger glasses, still centred ==
{
  const wAt = (d) => {
    const pose = poseMatrix(d)
    const gL = toScreen(glassesPointToCam(pose, M.frameLeft))
    const gR = toScreen(glassesPointToCam(pose, M.frameRight))
    return Math.abs(gR.x - gL.x)
  }
  const near = wAt(40)
  const mid = wAt(60)
  const far = wAt(90)
  check(
    'distance: nearer face renders wider glasses (40>60>90 cm)',
    near > mid && mid > far,
    `40cm=${near.toFixed(0)}px 60cm=${mid.toFixed(0)}px 90cm=${far.toFixed(0)}px`,
  )
  // Perspective sanity: apparent width should fall ~inversely with distance.
  // The glasses sit ~5 cm forward of the canonical origin, so the effective
  // depth is (d − ~5); compare the pixel ratio to the distance ratio loosely.
  const widthRatio = near / far
  const distRatio = 90 / 40
  check(
    'distance: apparent width falls ~inversely with distance',
    Math.abs(widthRatio - distRatio) / distRatio < 0.12,
    `widthRatio=${widthRatio.toFixed(2)} distRatio=${distRatio.toFixed(2)}`,
  )
}

// ===== Test 5: yawed head — glasses bridge stays glued to the face bridge ======
{
  for (const yawDeg of [-25, -10, 10, 25]) {
    const pose = poseMatrix(60, (yawDeg * Math.PI) / 180)
    const faceBridge = toScreen(faceLandmarkToCam(pose, L.bridge168))
    const glassBridge = toScreen(glassesPointToCam(pose, M.bridgeSaddle))
    check(
      `yaw ${yawDeg}°: glasses bridge tracks face bridge`,
      dist(faceBridge, glassBridge) < 1,
      `Δ=${dist(faceBridge, glassBridge).toFixed(2)}px`,
    )
  }
}

// ===== Test 6: vertical seating — glasses bridge sits at/above the eyes line ===
{
  const pose = poseMatrix(60)
  const bridgeY = toScreen(glassesPointToCam(pose, M.bridgeSaddle)).y
  const noseY = toScreen(faceLandmarkToCam(pose, L.noseTip1)).y
  check(
    'vertical: glasses bridge sits above the nose tip (smaller screen-y)',
    bridgeY < noseY,
    `bridgeY=${bridgeY.toFixed(0)} noseTipY=${noseY.toFixed(0)}`,
  )
}

console.log(`\n${failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'}`)
process.exit(failures === 0 ? 0 : 1)
