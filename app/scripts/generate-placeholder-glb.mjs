// One-off generator for the Story 04 placeholder glasses GLB.
//
// Produces `public/glasses/placeholder.glb`: two torus "lenses", a bridge bar,
// and two temple arms, all sharing a single basic PBR material. This is a
// self-generated CC0 placeholder — Story 06 replaces it with the real catalog.
//
// Run once from `app/`:  node scripts/generate-placeholder-glb.mjs
// It is intentionally NOT part of the app bundle (lives in scripts/, no app
// import references it). Three.js is already a project dependency, so the
// GLTFExporter is available under Node without extra installs.
//
// Dimensions follow the asset convention in docs/tech-stack.md: roughly ~140mm
// physical width, origin at the nose-bridge contact point, +Z forward. Units
// are metres (0.14 = 140mm), matching how a real glasses GLB would be authored.

import * as THREE from 'three'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

// GLTFExporter (binary mode) uses the browser FileReader API to turn a Blob
// into an ArrayBuffer. Node 22 has a global Blob but no FileReader, so provide
// a minimal shim backed by Blob.arrayBuffer().
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
const OUT_FILE = resolve(OUT_DIR, 'placeholder.glb')

// Shared neutral PBR material so the GLB exercises the Environment lighting.
const material = new THREE.MeshStandardMaterial({
  color: 0x222222,
  metalness: 0.6,
  roughness: 0.35,
})

const root = new THREE.Group()
root.name = 'PlaceholderGlasses'

// Lens rings (torus). Lens radius ~22mm, tube ~3mm. Centres ±33mm from origin.
const lensRadius = 0.022
const tube = 0.003
const lensOffsetX = 0.033

for (const sign of [-1, 1]) {
  const lens = new THREE.Mesh(
    new THREE.TorusGeometry(lensRadius, tube, 12, 32),
    material,
  )
  lens.name = sign < 0 ? 'LensLeft' : 'LensRight'
  lens.position.set(sign * lensOffsetX, 0, 0)
  root.add(lens)
}

// Bridge bar across the nose, between the two lenses.
const bridge = new THREE.Mesh(
  new THREE.BoxGeometry(lensOffsetX * 2 - lensRadius * 2, 0.004, 0.004),
  material,
)
bridge.name = 'Bridge'
bridge.position.set(0, 0.008, 0)
root.add(bridge)

// Temple arms running back along -Z from the outer edge of each lens.
const templeLength = 0.05
for (const sign of [-1, 1]) {
  const temple = new THREE.Mesh(
    new THREE.BoxGeometry(0.004, 0.004, templeLength),
    material,
  )
  temple.name = sign < 0 ? 'TempleLeft' : 'TempleRight'
  temple.position.set(
    sign * (lensOffsetX + lensRadius),
    0,
    -templeLength / 2,
  )
  root.add(temple)
}

const scene = new THREE.Scene()
scene.add(root)

const exporter = new GLTFExporter()
exporter.parse(
  scene,
  (result) => {
    mkdirSync(OUT_DIR, { recursive: true })
    // `binary: true` yields an ArrayBuffer (.glb).
    const buffer = Buffer.from(result)
    writeFileSync(OUT_FILE, buffer)
    console.log(`Wrote ${OUT_FILE} (${buffer.length} bytes)`)
  },
  (err) => {
    console.error('GLTF export failed:', err)
    process.exit(1)
  },
  { binary: true },
)
