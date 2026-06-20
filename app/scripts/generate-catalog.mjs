// One-off generator for the Story 06 glasses catalog.
//
// Produces 8 DISTINCT procedurally-generated frame GLBs in `public/glasses/`,
// each following the Story 05 GLB convention EXACTLY:
//   - origin at the nose-bridge contact point (world origin)
//   - +Z forward (toward the face / into the screen)
//   - +Y up, +X = model's right
//   - outer temple-to-temple width = GLB_WIDTH_M (0.14 m / 140mm)
//
// WHY procedural (read this): the assets/glasses README assumes Sketchfab/Meshy
// downloads (login/API) + manual Blender normalization (GUI). Both are infeasible
// in this headless, no-GUI, no-login environment. So instead of faking a download
// we GENERATE the catalog: 8 styles with genuinely different lens silhouettes
// (aviator, wayfarer, round, rectangle, cat-eye, browline, rimless, oversized).
// Everything generated here is original to this project => CC0-1.0, creator
// "VTO Experiment (procedurally generated)", sourceUrl = this script.
//
// Run once from `app/`:  node scripts/generate-catalog.mjs
// It is NOT part of the app bundle (lives in scripts/, no app import references
// it). three is already a dependency, so GLTFExporter is available under Node.
//
// This script also writes 256x256 PNG thumbnails (a 2D schematic of each lens
// silhouette) via the dependency-free PNG encoder in ./lib/png.mjs, and
// validates every GLB headlessly (GLTFLoader.parse + ~140mm width assert).

import * as THREE from 'three'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { encodePNG } from './lib/png.mjs'

// ---- Node shims for the browser-oriented exporter -------------------------
// GLTFExporter (binary) uses FileReader; Node 22 has Blob but not FileReader.
if (typeof globalThis.FileReader === 'undefined') {
  globalThis.FileReader = class {
    onload = null
    onloadend = null
    onerror = null
    result = null
    readAsArrayBuffer(blob) {
      blob
        .arrayBuffer()
        .then((buf) => {
          this.result = buf
          this.onload?.({ target: this })
          this.onloadend?.({ target: this })
        })
        .catch((err) => this.onerror?.(err))
    }
  }
}

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = resolve(__dirname, '../public/glasses')
const THUMB_DIR = resolve(OUT_DIR, 'thumbs')

// MUST match GLB_WIDTH_M in src/lib/faceMath.ts (the fit-to-face scale divides
// against it). Outer temple-to-temple span of every model is normalized to this.
const GLB_WIDTH_M = 0.14

// ---------------------------------------------------------------------------
// Lens silhouette definitions. Each returns a flat THREE.Shape (in the XY plane,
// metres, centred on the lens's own centre) — distinct per style. We also carry
// per-style colour + how "heavy" the rim is. Geometry is built from these so the
// GLB and the PNG thumbnail share ONE source of truth for the silhouette.
// ---------------------------------------------------------------------------

/** Build a THREE.Shape from an array of [x,y] points (closed polygon). */
function polyShape(points) {
  const s = new THREE.Shape()
  s.moveTo(points[0][0], points[0][1])
  for (let i = 1; i < points.length; i++) s.lineTo(points[i][0], points[i][1])
  s.closePath()
  return s
}

/** Sample an ellipse to a polygon, optionally with corner upsweep (cat-eye). */
function ellipsePoints(rx, ry, n = 48, opts = {}) {
  const { upsweep = 0, topFlat = 0, bottomFlat = 0 } = opts
  const pts = []
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2
    let x = Math.cos(a) * rx
    let y = Math.sin(a) * ry
    // cat-eye: lift the outer-top corner
    if (upsweep && x > 0 && y > 0) y += upsweep * (x / rx) * (y / ry)
    if (topFlat && y > 0) y *= 1 - topFlat * (y / ry)
    if (bottomFlat && y < 0) y *= 1 - bottomFlat * (-y / ry)
    pts.push([x, y])
  }
  return pts
}

function roundedRectPoints(w, h, r, n = 6) {
  const hw = w / 2
  const hh = h / 2
  const c = []
  const corner = (cx, cy, start) => {
    for (let i = 0; i <= n; i++) {
      const a = start + (i / n) * (Math.PI / 2)
      c.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r])
    }
  }
  corner(hw - r, hh - r, 0)
  corner(-hw + r, hh - r, Math.PI / 2)
  corner(-hw + r, -hh + r, Math.PI)
  corner(hw - r, -hh + r, (3 * Math.PI) / 2)
  return c
}

// Each style: lens half-width (rx), centre offset from origin, builder for the
// lens outline, bridge gap, rim heaviness, browbar flag, colour.
const STYLES = [
  {
    id: 'aviator',
    name: 'Aviator',
    color: 0x9a8c6a, // gold-ish
    metalness: 0.85,
    roughness: 0.3,
    lensCenter: 0.026,
    rim: 0.0022,
    browBar: false,
    // teardrop: wide rounded top, tapered bottom
    outline: () => {
      const pts = ellipsePoints(0.026, 0.02, 56, { bottomFlat: 0.0 })
      // taper the bottom into a soft point
      return pts.map(([x, y]) => [x, y < 0 ? y * (1 + 0.35 * (x / 0.026) ** 0 - 0.35) : y])
    },
  },
  {
    id: 'wayfarer',
    name: 'Wayfarer',
    color: 0x1b1b1b,
    metalness: 0.1,
    roughness: 0.5,
    lensCenter: 0.028,
    rim: 0.0032,
    browBar: false,
    // trapezoid: top wider than bottom, slight angle
    outline: () => polyShapePts([
      [-0.026, 0.018], [0.026, 0.018], [0.022, -0.018], [-0.022, -0.018],
    ]),
  },
  {
    id: 'round',
    name: 'Round',
    color: 0x8a8a8a,
    metalness: 0.9,
    roughness: 0.25,
    lensCenter: 0.026,
    rim: 0.0018,
    browBar: false,
    outline: () => ellipsePoints(0.022, 0.022, 56),
  },
  {
    id: 'rectangle',
    name: 'Rectangle',
    color: 0x2a2a2a,
    metalness: 0.15,
    roughness: 0.55,
    lensCenter: 0.03,
    rim: 0.003,
    browBar: false,
    outline: () => roundedRectPoints(0.05, 0.026, 0.005),
  },
  {
    id: 'cat-eye',
    name: 'Cat-Eye',
    color: 0x5a2030,
    metalness: 0.2,
    roughness: 0.45,
    lensCenter: 0.028,
    rim: 0.0028,
    browBar: false,
    // upswept outer-top corner
    outline: () => ellipsePoints(0.026, 0.019, 56, { upsweep: 0.018 }),
  },
  {
    id: 'browline',
    name: 'Browline',
    color: 0x1f1a14,
    metalness: 0.25,
    roughness: 0.5,
    lensCenter: 0.028,
    rim: 0.0022,
    browBar: true, // heavy top bar
    outline: () => polyShapePts([
      [-0.026, 0.016], [0.026, 0.016], [0.024, -0.012],
      [0.0, -0.02], [-0.024, -0.012],
    ]),
  },
  {
    id: 'rimless',
    name: 'Rimless',
    color: 0xbfd0d8,
    metalness: 0.7,
    roughness: 0.15,
    lensCenter: 0.028,
    rim: 0.0009, // very thin
    browBar: false,
    outline: () => roundedRectPoints(0.05, 0.024, 0.011),
  },
  {
    id: 'oversized',
    name: 'Oversized',
    color: 0x14110f,
    metalness: 0.1,
    roughness: 0.6,
    lensCenter: 0.03,
    rim: 0.0038,
    browBar: false,
    outline: () => ellipsePoints(0.032, 0.028, 56),
  },
]

// helper that needs polyShape but defined after for readability
function polyShapePts(points) {
  return points
}

// ---------------------------------------------------------------------------
// GLB construction
// ---------------------------------------------------------------------------

/**
 * Build a flat ring (the rim) by extruding the outline as a thin tube-ish band:
 * we create the filled lens shape, then a slightly inset hole, producing a rim
 * of thickness `rim`. Extruded a little along Z for depth.
 */
function buildLensMesh(style, sign, material) {
  const outline = normalizeOutline(style.outline())
  const outerShape = polyShape(outline)

  // Build an inner hole offset inward by `rim` (approx: scale toward centroid).
  const inner = insetPolygon(outline, style.rim)
  outerShape.holes = [polyShape(inner, true)]

  const geo = new THREE.ExtrudeGeometry(outerShape, {
    depth: 0.004,
    bevelEnabled: false,
    steps: 1,
  })
  geo.center() // center extrusion depth; we re-place below
  const mesh = new THREE.Mesh(geo, material)
  mesh.name = sign < 0 ? 'LensLeft' : 'LensRight'
  // place lens centre at +/- lensCenter on X
  mesh.position.set(sign * style.lensCenter, 0, 0)
  return mesh
}

/** Inset a closed polygon toward its centroid by approx `d` metres. */
function insetPolygon(points, d) {
  let cx = 0
  let cy = 0
  for (const [x, y] of points) {
    cx += x
    cy += y
  }
  cx /= points.length
  cy /= points.length
  return points.map(([x, y]) => {
    const dx = x - cx
    const dy = y - cy
    const len = Math.hypot(dx, dy) || 1
    const k = Math.max(0, len - d) / len
    return [cx + dx * k, cy + dy * k]
  })
}

/** Re-center an outline polygon on its own centroid (so lens placement is exact). */
function normalizeOutline(points) {
  let cx = 0
  let cy = 0
  for (const [x, y] of points) {
    cx += x
    cy += y
  }
  cx /= points.length
  cy /= points.length
  return points.map(([x, y]) => [x - cx, y - cy])
}

function buildFrame(style) {
  const material = new THREE.MeshStandardMaterial({
    color: style.color,
    metalness: style.metalness,
    roughness: style.roughness,
  })

  const root = new THREE.Group()
  root.name = `${style.name}Glasses`

  const left = buildLensMesh(style, -1, material)
  const right = buildLensMesh(style, 1, material)
  root.add(left, right)

  // Bridge bar across the nose between the two lenses.
  const gap = style.lensCenter * 2 - lensHalfWidth(style) * 2
  const bridge = new THREE.Mesh(
    new THREE.BoxGeometry(Math.max(gap, 0.006), style.browBar ? 0.006 : 0.0035, 0.004),
    material,
  )
  bridge.name = 'Bridge'
  bridge.position.set(0, style.browBar ? 0.012 : 0.006, 0)
  root.add(bridge)

  // Browline heavy top bar (clubmaster look).
  if (style.browBar) {
    const bar = new THREE.Mesh(
      new THREE.BoxGeometry(style.lensCenter * 2 + lensHalfWidth(style) * 2, 0.007, 0.005),
      material,
    )
    bar.name = 'BrowBar'
    bar.position.set(0, 0.016, 0.001)
    root.add(bar)
  }

  // Temple arms running back along -Z from the outer edge of each lens.
  // NOTE: model +Z is forward (toward face), so temples extend in -Z (toward
  // back of head) per the Story 05 convention.
  const templeLength = 0.052
  const outerX = style.lensCenter + lensHalfWidth(style)
  for (const sign of [-1, 1]) {
    const temple = new THREE.Mesh(
      new THREE.BoxGeometry(0.004, 0.004, templeLength),
      material,
    )
    temple.name = sign < 0 ? 'TempleLeft' : 'TempleRight'
    temple.position.set(sign * outerX, 0.004, -templeLength / 2)
    root.add(temple)
  }

  // ---- Normalize to convention -------------------------------------------
  // 1. Scale uniformly so outer temple-to-temple width == GLB_WIDTH_M.
  const box = new THREE.Box3().setFromObject(root)
  const size = new THREE.Vector3()
  box.getSize(size)
  const scale = GLB_WIDTH_M / size.x
  root.scale.setScalar(scale)
  root.updateMatrixWorld(true)

  // 2. Origin at nose-bridge contact: the bridge front-bottom-centre. We place
  //    origin at X=0 (already symmetric), Y at the bridge centre line, Z at the
  //    front face of the lenses (the point that rests against the nose bridge).
  const box2 = new THREE.Box3().setFromObject(root)
  // X already centred (symmetric). Keep Y so bridge sits ~at origin: shift so the
  // vertical centre of the lenses is at Y=0 (matches placeholder convention).
  const center = new THREE.Vector3()
  box2.getCenter(center)
  // Shift the whole group so X-centre and Y-centre land on origin; Z front face
  // (max Z) lands on origin (nose-bridge contact is the frontmost point at Z=0).
  const shift = new THREE.Vector3(-center.x, -center.y, -box2.max.z)
  // bake shift into children (root stays at identity for a clean exported origin)
  root.children.forEach((c) => c.position.add(shift.clone().multiplyScalar(1 / scale)))
  root.updateMatrixWorld(true)

  return root
}

function lensHalfWidth(style) {
  const outline = normalizeOutline(style.outline())
  let maxX = 0
  for (const [x] of outline) maxX = Math.max(maxX, Math.abs(x))
  return maxX
}

// ---------------------------------------------------------------------------
// Export + validate
// ---------------------------------------------------------------------------

async function exportGLB(root) {
  const scene = new THREE.Scene()
  scene.add(root)
  const exporter = new GLTFExporter()
  const result = await new Promise((res, rej) =>
    exporter.parse(scene, res, rej, { binary: true }),
  )
  return Buffer.from(result)
}

async function validateGLB(buffer, id) {
  const loader = new GLTFLoader()
  const ab = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
  const gltf = await new Promise((res, rej) => loader.parse(ab, '', res, rej))
  const box = new THREE.Box3().setFromObject(gltf.scene)
  const size = new THREE.Vector3()
  box.getSize(size)
  const widthMm = size.x * 1000
  const ok = Math.abs(widthMm - 140) < 1.0
  if (!ok) throw new Error(`[${id}] width ${widthMm.toFixed(2)}mm != 140mm`)
  return widthMm
}

// ---------------------------------------------------------------------------
// Thumbnail (256x256 PNG schematic of the lens silhouette pair)
// ---------------------------------------------------------------------------

function renderThumb(style) {
  const W = 256
  const H = 256
  const rgba = new Uint8Array(W * H * 4)
  // background = surface #FFFFFF
  for (let i = 0; i < W * H; i++) {
    rgba[i * 4 + 0] = 255
    rgba[i * 4 + 1] = 255
    rgba[i * 4 + 2] = 255
    rgba[i * 4 + 3] = 255
  }

  // Map metre-space (frame ~0.14 wide) to a centred ~200px region.
  const outline = normalizeOutline(style.outline())
  const lc = style.lensCenter
  const scale = 200 / 0.14 // px per metre — frame width 0.14 -> 200px
  const cx = W / 2
  const cy = H / 2
  const toPx = (mx, my) => [cx + mx * scale, cy - my * scale]

  const ink = [26, 26, 26] // --ink
  const col = [
    (style.color >> 16) & 0xff,
    (style.color >> 8) & 0xff,
    style.color & 0xff,
  ]

  // Fill each lens polygon (translated to +/- lensCenter), then stroke the rim
  // in a darker ink so the silhouette reads clearly on the rail.
  for (const sign of [-1, 1]) {
    const poly = outline.map(([x, y]) => toPx(x + sign * lc, y))
    fillPoly(rgba, W, H, poly, [col[0], col[1], col[2], 90]) // translucent tint
    strokePoly(rgba, W, H, poly, ink, Math.max(2, style.rim * scale))
  }

  // Bridge line.
  const [bx0, by0] = toPx(-lc + 0.02, style.browBar ? 0.012 : 0.006)
  const [bx1, by1] = toPx(lc - 0.02, style.browBar ? 0.012 : 0.006)
  strokeLine(rgba, W, H, bx0, by0, bx1, by1, ink, style.browBar ? 6 : 3)

  // Browline bar.
  if (style.browBar) {
    const [tx0, ty0] = toPx(-lc - 0.026, 0.016)
    const [tx1, ty1] = toPx(lc + 0.026, 0.016)
    strokeLine(rgba, W, H, tx0, ty0, tx1, ty1, ink, 8)
  }

  return encodePNG(W, H, rgba)
}

// --- tiny raster helpers (scanline fill + thick line) ---
function fillPoly(rgba, W, H, poly, [r, g, b, a]) {
  let minY = H
  let maxY = 0
  for (const [, y] of poly) {
    minY = Math.min(minY, y)
    maxY = Math.max(maxY, y)
  }
  minY = Math.max(0, Math.floor(minY))
  maxY = Math.min(H - 1, Math.ceil(maxY))
  for (let y = minY; y <= maxY; y++) {
    const xs = []
    for (let i = 0; i < poly.length; i++) {
      const [x1, y1] = poly[i]
      const [x2, y2] = poly[(i + 1) % poly.length]
      if (y1 <= y && y2 > y) {
        xs.push(x1 + ((y - y1) / (y2 - y1)) * (x2 - x1))
      } else if (y2 <= y && y1 > y) {
        xs.push(x2 + ((y - y2) / (y1 - y2)) * (x1 - x2))
      }
    }
    xs.sort((p, q) => p - q)
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const xa = Math.max(0, Math.ceil(xs[k]))
      const xb = Math.min(W - 1, Math.floor(xs[k + 1]))
      for (let x = xa; x <= xb; x++) blend(rgba, (y * W + x) * 4, r, g, b, a)
    }
  }
}

function strokePoly(rgba, W, H, poly, col, w) {
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i]
    const [x2, y2] = poly[(i + 1) % poly.length]
    strokeLine(rgba, W, H, x1, y1, x2, y2, col, w)
  }
}

function strokeLine(rgba, W, H, x0, y0, x1, y1, [r, g, b], w) {
  const dx = x1 - x0
  const dy = y1 - y0
  const len = Math.hypot(dx, dy) || 1
  const steps = Math.ceil(len)
  const rad = Math.max(1, w / 2)
  for (let s = 0; s <= steps; s++) {
    const px = x0 + (dx * s) / steps
    const py = y0 + (dy * s) / steps
    for (let oy = -rad; oy <= rad; oy++) {
      for (let ox = -rad; ox <= rad; ox++) {
        if (ox * ox + oy * oy > rad * rad) continue
        const x = Math.round(px + ox)
        const y = Math.round(py + oy)
        if (x < 0 || x >= W || y < 0 || y >= H) continue
        blend(rgba, (y * W + x) * 4, r, g, b, 255)
      }
    }
  }
}

function blend(rgba, idx, r, g, b, a) {
  const af = a / 255
  rgba[idx] = Math.round(rgba[idx] * (1 - af) + r * af)
  rgba[idx + 1] = Math.round(rgba[idx + 1] * (1 - af) + g * af)
  rgba[idx + 2] = Math.round(rgba[idx + 2] * (1 - af) + b * af)
  rgba[idx + 3] = 255
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  mkdirSync(OUT_DIR, { recursive: true })
  mkdirSync(THUMB_DIR, { recursive: true })

  const manifest = []
  for (const style of STYLES) {
    const root = buildFrame(style)
    const glb = await exportGLB(root)
    const widthMm = await validateGLB(glb, style.id)
    writeFileSync(resolve(OUT_DIR, `${style.id}.glb`), glb)

    const png = renderThumb(style)
    writeFileSync(resolve(THUMB_DIR, `${style.id}.png`), png)

    manifest.push({
      id: style.id,
      name: style.name,
      modelUrl: `/glasses/${style.id}.glb`,
      thumbUrl: `/glasses/thumbs/${style.id}.png`,
      attribution: {
        creator: 'VTO Experiment (procedurally generated)',
        license: 'CC0-1.0',
        sourceUrl:
          'https://github.com/VTO-Experiment/VTO-CC/blob/main/app/scripts/generate-catalog.mjs',
      },
    })

    console.log(
      `Wrote ${style.id}.glb (${glb.length} B, ${widthMm.toFixed(2)}mm) + thumb (${png.length} B)`,
    )
  }

  // Write the manifest to BOTH public/ (served, but app imports the src copy)
  // and src/data/ (bundled import). They are identical; src/data is the import
  // source of truth, public/ mirrors it for the README's stated layout.
  const json = JSON.stringify(manifest, null, 2) + '\n'
  writeFileSync(resolve(OUT_DIR, 'frames.json'), json)
  const srcData = resolve(__dirname, '../src/data')
  mkdirSync(srcData, { recursive: true })
  writeFileSync(resolve(srcData, 'frames.json'), json)
  console.log(`Wrote frames.json (${manifest.length} frames) to public/glasses and src/data`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
