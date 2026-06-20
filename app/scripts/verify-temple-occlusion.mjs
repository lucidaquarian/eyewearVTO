/**
 * THROWAWAY headless verification for the temple (arm) occlusion fix.
 *
 * Bug: facing the camera both arms hide; turning the head should reveal ONLY the
 * near arm. The far arm was persisting and ghosting across the face. Root cause:
 * FaceAnchor.fadeTemples picked near-vs-far from each temple mesh's NODE ORIGIN in
 * world space, but sunglasses.glb's earhook nodes both sit at the model origin (the
 * shape is baked into vertex data), so both sides reported the same Z and the
 * near/far test (`zR ??= z`, first mesh per side = the earhook) marked BOTH arms
 * near. The fix reads each mesh's GEOMETRY CENTRE in world space instead, which is
 * correctly separated per side.
 *
 * This reproduces the EXACT shipping transform chain (seat offset → MODEL_TO_CM →
 * nose-bridge anchor → MediaPipe pose) on the REAL sunglasses.glb and compares the
 * two depth-measurement methods under a synthetic head yaw. Self-contained (plain
 * Node + a tiny mat4 helper, no build step) so it runs anywhere; the constants
 * mirror src/lib/faceMath.ts and matrixFromMediaPipe is a plain fromArray.
 *
 * Run from app/:  node scripts/verify-temple-occlusion.mjs
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')

// ---- Shipping constants (mirror src/lib/faceMath.ts) ------------------------
const NOSE_BRIDGE_ANCHOR_CM = [0, 3.271, 5.236]
const MODEL_TO_CM = 90
const MODEL_SEAT_OFFSET_M = [0, -0.03078, 0.00206]

// ---- Minimal column-major 4x4 helpers (match three's storage) ---------------
const ident = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
const T = (x, y, z) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]
const S = (s) => [s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, 0, 0, 0, 1]
const Ry = (a) => {
  const c = Math.cos(a)
  const s = Math.sin(a)
  return [c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0, 0, 0, 0, 1]
}
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
const mulAll = (...ms) => ms.reduce((a, b) => mul(a, b))
const apply = (m, [x, y, z]) => [
  m[0] * x + m[4] * y + m[8] * z + m[12],
  m[1] * x + m[5] * y + m[9] * z + m[13],
  m[2] * x + m[6] * y + m[10] * z + m[14],
]

// ---- Parse the real shipping GLB --------------------------------------------
const buf = readFileSync(path.join(root, 'public/glasses/sunglasses.glb'))
let off = 12
let g = null
while (off < buf.length) {
  const clen = buf.readUInt32LE(off)
  const ctype = buf.readUInt32LE(off + 4)
  const data = buf.slice(off + 8, off + 8 + clen)
  if (ctype === 0x4e4f534a) g = JSON.parse(data.toString('utf8'))
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

// Collect temple meshes in node order (so "first per side" matches the buggy
// `zR ??= z`), with each one's local origin and local geometry centre.
const TEMPLE_RE = /^temple/i
const EARHOOK_RE = /^earhook/i
const temples = []
g.nodes.forEach((n, i) => {
  if (n.mesh == null) return
  const name = g.meshes[n.mesh].name
  if (!(TEMPLE_RE.test(name) || EARHOOK_RE.test(name))) return
  const a = g.accessors[g.meshes[n.mesh].primitives[0].attributes.POSITION]
  const ctrLocal = [
    (a.min[0] + a.max[0]) / 2,
    (a.min[1] + a.max[1]) / 2,
    (a.min[2] + a.max[2]) / 2,
  ]
  temples.push({ name, right: /right/i.test(name), meshWorld: worldMat(i), ctrLocal })
})

let failures = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`)
  if (!cond) failures++
}
check(
  'found both arms (≥1 mesh per side)',
  temples.some((t) => t.right) && temples.some((t) => !t.right),
  temples.map((t) => t.name).join(', '),
)

// Full render transform for a model-local point: pose · anchor · scale · seat · mesh
const reg = mulAll(
  T(...NOSE_BRIDGE_ANCHOR_CM),
  S(MODEL_TO_CM),
  T(...MODEL_SEAT_OFFSET_M),
)
function worldZ(yawDeg, meshWorld, localPt) {
  const pose = Ry((yawDeg * Math.PI) / 180)
  pose[14] = -60 // head 60 cm in front of the camera (tz)
  return apply(mulAll(pose, reg, meshWorld), localPt)[2]
}

function measure(yawDeg) {
  // OLD (buggy): origin (0,0,0) Z of the FIRST mesh per side (node order).
  const firstR = temples.find((t) => t.right)
  const firstL = temples.find((t) => !t.right)
  const oldR = worldZ(yawDeg, firstR.meshWorld, [0, 0, 0])
  const oldL = worldZ(yawDeg, firstL.meshWorld, [0, 0, 0])
  // NEW (fix): mean geometry-centre Z per side.
  const mean = (side) => {
    const xs = temples
      .filter((t) => t.right === side)
      .map((t) => worldZ(yawDeg, t.meshWorld, t.ctrLocal))
    return xs.reduce((a, b) => a + b, 0) / xs.length
  }
  return { oldR, oldL, newR: mean(true), newL: mean(false) }
}

// ===== Bug reproduction: OLD method gives identical Z on both sides ============
{
  const m = measure(25)
  check(
    'OLD (node origin): zRight === zLeft — cannot tell the sides apart',
    Math.abs(m.oldR - m.oldL) < 1e-6,
    `zRight=${m.oldR.toFixed(4)} zLeft=${m.oldL.toFixed(4)}`,
  )
}

// ===== Fix: NEW method picks exactly one near side, and it flips with yaw ======
const nearSide = (yawDeg) => {
  const m = measure(yawDeg)
  return { near: m.newR > m.newL ? 'R' : 'L', dz: Math.abs(m.newR - m.newL) }
}
{
  const pos = nearSide(25)
  const neg = nearSide(-25)
  check(
    'NEW: a clear near side at yaw +25° (sides well separated)',
    pos.dz > 1,
    `Δz=${pos.dz.toFixed(3)} cm near=${pos.near}`,
  )
  check(
    'NEW: a clear near side at yaw −25°',
    neg.dz > 1,
    `Δz=${neg.dz.toFixed(3)} cm near=${neg.near}`,
  )
  check(
    'NEW: near side FLIPS with head-turn direction',
    pos.near !== neg.near,
    `+25°→${pos.near}, −25°→${neg.near}`,
  )
}

// ===== Head-on is symmetric (the yaw gate hides both there anyway) =============
{
  const m = measure(0)
  check(
    'NEW: head-on the two sides are ~symmetric (no spurious near side)',
    Math.abs(m.newR - m.newL) < 0.5,
    `zRight=${m.newR.toFixed(4)} zLeft=${m.newL.toFixed(4)}`,
  )
}

console.log(`\n${failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'}`)
process.exit(failures === 0 ? 0 : 1)
