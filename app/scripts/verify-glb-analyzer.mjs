/**
 * Headless verification for src/vto/lib/glbAnalyzer.ts (custom GLB uploads).
 *
 * The analyzer recovers the shipped authoring conventions (metres, +Y up,
 * temples toward −Z, bridge-saddle seat offset, hinge/taper Z) from geometry
 * alone, so ANY uploaded GLB gets the same temple show/hide behaviour as the
 * catalog frames. This script checks:
 *
 *  1. CALIBRATION — analysing the real shipping sunglasses.glb reproduces the
 *     hand-tuned constants in faceMath.ts (unitScale 1, identity rotation,
 *     hinge ≈ ARM_HINGE_Z_M, seat ≈ MODEL_SEAT_OFFSET_M, taper ≈ EAR_TAPER_*).
 *  2. RE-SCAN — synthetic glasses authored in mm, flipped 180°, or Z-up are
 *     recovered via the orientation/unit hypothesis retry.
 *  3. REJECTION — non-glasses geometry (sphere) is refused with a typed error.
 *
 * The analyzer is a pure module (no three.js imports), imported directly via
 * Node's type stripping. Run from app/:
 *   node --experimental-strip-types scripts/verify-glb-analyzer.mjs
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  analyzeGlassesPoints,
  GlbAnalysisError,
  CANONICAL_FRAME_WIDTH_M,
} from '../src/vto/lib/glbAnalyzer.ts'

const root = path.resolve(import.meta.dirname, '..')

// ---- Expected values (mirror src/vto/lib/faceMath.ts) -----------------------
const MODEL_SEAT_OFFSET_M = [0, -0.03078, 0.00206]
const ARM_HINGE_Z_M = -0.012
const TEMPLE_FRONT_SECTION_Z = -0.03
const EAR_TAPER_START_Z = -0.075
const EAR_TAPER_END_Z = -0.1

let failures = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`)
  if (!cond) failures++
}
const near = (a, b, tol) => Math.abs(a - b) <= tol

// ---- Minimal GLB → world-space point cloud ----------------------------------
const fromTRS = (n) => {
  if (n.matrix) return n.matrix.slice()
  const t = n.translation || [0, 0, 0]
  const r = n.rotation || [0, 0, 0, 1]
  const sc = n.scale || [1, 1, 1]
  const [x, y, z, w] = r
  const x2 = x + x, y2 = y + y, z2 = z + z
  const xx = x * x2, xy = x * y2, xz = x * z2
  const yy = y * y2, yz = y * z2, zz = z * z2
  const wx = w * x2, wy = w * y2, wz = w * z2
  const [sx, sy, sz] = sc
  return [
    (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
    (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
    (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
    t[0], t[1], t[2], 1,
  ]
}
const ident = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
const mul = (a, b) => {
  const o = new Array(16)
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++) {
      let s = 0
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]
      o[c * 4 + r] = s
    }
  return o
}

function glbPoints(file) {
  const buf = readFileSync(file)
  let off = 12
  let g = null
  let bin = null
  while (off < buf.length) {
    const clen = buf.readUInt32LE(off)
    const ctype = buf.readUInt32LE(off + 4)
    const data = buf.slice(off + 8, off + 8 + clen)
    if (ctype === 0x4e4f534a) g = JSON.parse(data.toString('utf8'))
    if (ctype === 0x004e4942) bin = data
    off += 8 + clen
  }
  const parent = {}
  g.nodes.forEach((n, i) => (n.children || []).forEach((c) => (parent[c] = i)))
  const worldMat = (i) => {
    const chain = []
    let cur = i
    while (cur !== undefined) {
      chain.unshift(cur)
      cur = parent[cur]
    }
    let m = ident()
    for (const idx of chain) m = mul(m, fromTRS(g.nodes[idx]))
    return m
  }
  const out = []
  g.nodes.forEach((n, i) => {
    if (n.mesh == null) return
    const m = worldMat(i)
    for (const prim of g.meshes[n.mesh].primitives) {
      const acc = g.accessors[prim.attributes.POSITION]
      const bv = g.bufferViews[acc.bufferView]
      const base = (bv.byteOffset || 0) + (acc.byteOffset || 0)
      const stride = bv.byteStride || 12
      for (let v = 0; v < acc.count; v++) {
        const p = base + v * stride
        const x = bin.readFloatLE(p)
        const y = bin.readFloatLE(p + 4)
        const z = bin.readFloatLE(p + 8)
        out.push(
          m[0] * x + m[4] * y + m[8] * z + m[12],
          m[1] * x + m[5] * y + m[9] * z + m[13],
          m[2] * x + m[6] * y + m[10] * z + m[14],
        )
      }
    }
  })
  return new Float32Array(out)
}

// ============ 1. CALIBRATION against the real sunglasses.glb =================
{
  const pts = glbPoints(path.join(root, 'public/glasses/sunglasses.glb'))
  const fit = analyzeGlassesPoints(pts)
  console.log('sunglasses.glb fit:', JSON.stringify(fit, null, 2))
  check('sunglasses: unitScale ≈ 1', near(fit.unitScale, 1, 0.02), `got ${fit.unitScale.toFixed(4)}`)
  check(
    'sunglasses: identity orientation',
    fit.preRotation.every((v) => v === 0),
    `got [${fit.preRotation.join(', ')}]`,
  )
  check('sunglasses: hingeZ ≈ ARM_HINGE_Z_M', near(fit.hingeZ, ARM_HINGE_Z_M, 0.008), `got ${fit.hingeZ.toFixed(4)} want ${ARM_HINGE_Z_M}`)
  check('sunglasses: seat x ≈ 0', near(fit.seatOffsetM[0], 0, 0.003), `got ${fit.seatOffsetM[0].toFixed(4)}`)
  check('sunglasses: seat y ≈ hand-tuned', near(fit.seatOffsetM[1], MODEL_SEAT_OFFSET_M[1], 0.006), `got ${fit.seatOffsetM[1].toFixed(4)} want ${MODEL_SEAT_OFFSET_M[1]}`)
  check('sunglasses: seat z ≈ hand-tuned', near(fit.seatOffsetM[2], MODEL_SEAT_OFFSET_M[2], 0.006), `got ${fit.seatOffsetM[2].toFixed(4)} want ${MODEL_SEAT_OFFSET_M[2]}`)
  check('sunglasses: front section ≈ hand-tuned', near(fit.frontSectionZ, TEMPLE_FRONT_SECTION_Z, 0.01), `got ${fit.frontSectionZ.toFixed(4)} want ${TEMPLE_FRONT_SECTION_Z}`)
  check('sunglasses: ear taper start ≈ hand-tuned', near(fit.earTaperStartZ, EAR_TAPER_START_Z, 0.012), `got ${fit.earTaperStartZ.toFixed(4)} want ${EAR_TAPER_START_Z}`)
  check('sunglasses: ear taper end ≈ hand-tuned', near(fit.earTaperEndZ, EAR_TAPER_END_Z, 0.012), `got ${fit.earTaperEndZ.toFixed(4)} want ${EAR_TAPER_END_Z}`)
}

// ============ 2. Synthetic glasses + transform recovery ======================

/**
 * Procedural glasses point cloud in CANONICAL pose (metres, +Y up, temples
 * −Z): a front slab (rims + bridge), nose pads trailing to z=-0.012, and two
 * arms at the outer edges ending in a small ear-curl drop.
 */
function syntheticGlasses() {
  const pts = []
  const W = 0.15
  const hw = W / 2
  // Front slab: full-width grid (rims/lenses/bridge), thin in z, with a nose
  // cutout under the bridge (|x| small, low y) like real glasses.
  for (let xi = 0; xi <= 60; xi++) {
    for (let yi = 0; yi <= 16; yi++) {
      const x = -hw + (xi / 60) * W
      const y = -0.022 + (yi / 16) * 0.05
      if (Math.abs(x) < 0.015 && y < 0.008) continue // nose cutout
      for (const z of [0.004, 0, -0.004]) pts.push(x, y, z)
    }
  }
  // Nose pads: centre cluster trailing back to the hinge depth.
  for (let zi = 0; zi <= 8; zi++) {
    for (const x of [-0.007, 0, 0.007]) {
      pts.push(x, 0.0, -0.004 - (zi / 8) * 0.008)
    }
  }
  // Arms: outer-edge lines back to z=-0.13 with an ear-curl drop at the end.
  for (const sx of [-1, 1]) {
    for (let zi = 0; zi <= 120; zi++) {
      const z = -0.004 - (zi / 120) * 0.126
      pts.push(sx * (hw - 0.001), 0.02, z)
      pts.push(sx * (hw - 0.0025), 0.017, z)
    }
    for (let ci = 0; ci <= 10; ci++) {
      pts.push(sx * (hw - 0.001), 0.02 - (ci / 10) * 0.03, -0.128)
    }
  }
  return new Float32Array(pts)
}

/** Apply scale s then rotation R(euler XYZ as three.js) to a cloud. */
function transformCloud(pts, s, [ex, ey, ez]) {
  const cx = Math.cos(ex), sx = Math.sin(ex)
  const cy = Math.cos(ey), sy = Math.sin(ey)
  const cz = Math.cos(ez), szn = Math.sin(ez)
  // M = Rx·Ry·Rz (row-major), matching three's 'XYZ' euler.
  const r = [
    cy * cz, -cy * szn, sy,
    cx * szn + sx * sy * cz, cx * cz - sx * sy * szn, -sx * cy,
    sx * szn - cx * sy * cz, sx * cz + cx * sy * szn, cx * cy,
  ]
  const out = new Float32Array(pts.length)
  for (let i = 0; i < pts.length; i += 3) {
    const x = pts[i] * s
    const y = pts[i + 1] * s
    const z = pts[i + 2] * s
    out[i] = r[0] * x + r[1] * y + r[2] * z
    out[i + 1] = r[3] * x + r[4] * y + r[5] * z
    out[i + 2] = r[6] * x + r[7] * y + r[8] * z
  }
  return out
}

/** Re-apply a fit to a raw cloud and measure the result in normalised space. */
function applyFit(pts, fit) {
  const [ex, ey, ez] = fit.preRotation
  const rotated = transformCloud(pts, 1, [ex, ey, ez])
  const out = new Float32Array(rotated.length)
  for (let i = 0; i < rotated.length; i += 3) {
    out[i] = rotated[i] * fit.unitScale + fit.seatOffsetM[0]
    out[i + 1] = rotated[i + 1] * fit.unitScale + fit.seatOffsetM[1]
    out[i + 2] = rotated[i + 2] * fit.unitScale + fit.seatOffsetM[2]
  }
  return out
}

function cloudStats(pts) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
  let stripMinY = Infinity, stripMaxY = -Infinity
  for (let i = 0; i < pts.length; i += 3) {
    const x = pts[i], y = pts[i + 1], z = pts[i + 2]
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (z < minZ) minZ = z
    if (z > maxZ) maxZ = z
    if (Math.abs(x) < 0.012 && z > -0.02) {
      if (y < stripMinY) stripMinY = y
      if (y > stripMaxY) stripMaxY = y
    }
  }
  return { width: maxX - minX, minZ, maxZ, stripMinY, stripMaxY }
}

const canonical = syntheticGlasses()
const cases = [
  { name: 'as-authored (metres, canonical pose)', s: 1, e: [0, 0, 0] },
  { name: 'millimetres', s: 1000, e: [0, 0, 0] },
  { name: 'centimetres + flipped 180° (temples +Z)', s: 100, e: [0, Math.PI, 0] },
  { name: 'Z-up export (lying flat)', s: 1, e: [-Math.PI / 2, 0, 0] },
  { name: 'inches + temples along +X', s: 39.37, e: [0, Math.PI / 2, 0] },
]
for (const c of cases) {
  const authored = transformCloud(canonical, c.s, c.e)
  let fit
  try {
    fit = analyzeGlassesPoints(authored)
  } catch (err) {
    check(`synthetic [${c.name}]: analysed`, false, String(err))
    continue
  }
  const norm = applyFit(authored, fit)
  const st = cloudStats(norm)
  check(
    `synthetic [${c.name}]: width normalised`,
    near(st.width, CANONICAL_FRAME_WIDTH_M, 0.001),
    `width ${st.width.toFixed(4)}`,
  )
  check(
    `synthetic [${c.name}]: temples toward −Z, front near 0`,
    st.minZ < -0.08 && st.maxZ < 0.02 && st.maxZ > -0.02,
    `z ∈ [${st.minZ.toFixed(3)}, ${st.maxZ.toFixed(3)}]`,
  )
  check(
    `synthetic [${c.name}]: bridge seated at origin`,
    st.stripMinY < 0.002 && st.stripMaxY > -0.002,
    `seated centre-strip y ∈ [${st.stripMinY.toFixed(4)}, ${st.stripMaxY.toFixed(4)}]`,
  )
  check(
    `synthetic [${c.name}]: hinge plausible`,
    fit.hingeZ < 0 && fit.hingeZ > -0.03,
    `hingeZ ${fit.hingeZ.toFixed(4)}`,
  )
}

// ============ 3. Non-glasses geometry is rejected ============================
{
  const sphere = []
  for (let i = 0; i < 5000; i++) {
    const u = Math.random() * Math.PI * 2
    const v = Math.acos(2 * Math.random() - 1)
    sphere.push(
      Math.sin(v) * Math.cos(u),
      Math.sin(v) * Math.sin(u),
      Math.cos(v),
    )
  }
  let rejected = false
  let code = ''
  try {
    analyzeGlassesPoints(new Float32Array(sphere))
  } catch (err) {
    rejected = err instanceof GlbAnalysisError
    code = err.code
  }
  check('sphere: rejected with typed error', rejected && code === 'not-glasses', `code=${code}`)
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
