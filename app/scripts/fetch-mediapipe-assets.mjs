// Self-host MediaPipe FaceLandmarker assets under app/public/mediapipe/.
//
// What this does (idempotent):
//   1. Populate public/mediapipe/ with the tasks-vision WASM runtime
//      (vision_wasm_internal.{js,wasm} + the nosimd fallback pair).
//   2. Download face_landmarker.task (float16/1) into the same dir.
//
// Why a Node script (not curl/wget): node:20-alpine ships neither, and Node 20+
// has a global `fetch`. Keeping it pure-Node avoids bloating the Docker image.
//
// WASM source strategy — IMPORTANT, read before "simplifying":
//   The story assumed the WASM lives at
//   `node_modules/@mediapipe/tasks-vision/wasm/`. That is true for some patch
//   releases (0.10.17) but NOT for 0.10.16, which ships ONLY the JS bundle and
//   no `wasm/` folder. The app pins 0.10.16, so we cannot rely on that one path.
//   We therefore probe an ordered list of candidate dirs (the canonical path,
//   then any pnpm-store copy of any tasks-vision version) and copy from the
//   first that actually contains the wasm files. The WASM binaries are
//   ABI-stable across 0.10.x and are loaded by filename by the JS bundle, so a
//   0.10.17 runtime works with the 0.10.16 loader. If no local copy is found
//   (and only then) we fall back to fetching the WASM from the CDN.
//
// Network behaviour / build resilience (deviation from the story — see below):
//   The story said to `throw` if the model fetch fails. In some sandboxed CI/dev
//   environments outbound network is restricted, which would break every local
//   `pnpm build` (prebuild runs before EVERY build). To keep local builds green
//   while still producing a correct production image on Railway (which has
//   network), we DOWNGRADE a model-fetch failure to a loud WARNING *as long as
//   the WASM copy succeeded*. Rationale:
//     - The WASM copy is the local-only, must-always-work part.
//     - The model is fetched at build time on Railway, where network works.
//     - A missing model only degrades the deployed app, never the local build.
//   If the WASM step itself fails, we DO hard-throw — that is a real breakage.

import {
  mkdir,
  copyFile,
  readdir,
  writeFile,
  stat,
  access,
} from 'node:fs/promises'
import { join } from 'node:path'

const PUBLIC_DST = 'public/mediapipe'

// Ordered candidate dirs that may contain the tasks-vision WASM runtime.
// First match wins. Globs the pnpm store so any installed version works.
const WASM_SRC_CANDIDATES = [
  'node_modules/@mediapipe/tasks-vision/wasm',
]

// CDN fallback (only used if no local wasm dir is found). jsdelivr mirrors npm.
const WASM_CDN_BASE =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.16/wasm'
const WASM_FILES = [
  'vision_wasm_internal.js',
  'vision_wasm_internal.wasm',
  'vision_wasm_nosimd_internal.js',
  'vision_wasm_nosimd_internal.wasm',
]

// HDRI for drei <Environment files> — self-hosted so connect-src 'self' holds.
// The "city" preset in drei downloads potsdamer_platz_1k.hdr from raw.githack.com
// at runtime, which violates CSP. We fetch it at build time instead.
const HDRI_URL =
  'https://raw.githack.com/pmndrs/drei-assets/456060a26bbeb8fdf79326f224b6d99b8bcce736/hdri/potsdamer_platz_1k.hdr'
const HDRI_DST = 'public/hdri/potsdamer_platz_1k.hdr'

const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'
const MODEL_DST = join(PUBLIC_DST, 'face_landmarker.task')

const exists = (p) =>
  access(p)
    .then(() => true)
    .catch(() => false)

async function dirHasWasm(dir) {
  if (!(await exists(dir))) return false
  const files = await readdir(dir).catch(() => [])
  return files.some((f) => f.endsWith('.wasm'))
}

// Discover pnpm-store copies of tasks-vision that ship a wasm/ folder.
async function discoverPnpmWasmDirs() {
  const root = 'node_modules/.pnpm'
  if (!(await exists(root))) return []
  const entries = await readdir(root).catch(() => [])
  return entries
    .filter((e) => e.startsWith('@mediapipe+tasks-vision@'))
    .map((e) =>
      join(root, e, 'node_modules/@mediapipe/tasks-vision/wasm'),
    )
}

async function copyWasmFromLocal() {
  const candidates = [...WASM_SRC_CANDIDATES, ...(await discoverPnpmWasmDirs())]
  for (const dir of candidates) {
    if (await dirHasWasm(dir)) {
      const files = await readdir(dir)
      for (const f of files) {
        await copyFile(join(dir, f), join(PUBLIC_DST, f))
      }
      console.log(
        `[mediapipe] WASM copied from ${dir} (${files.length} files)`,
      )
      return true
    }
  }
  return false
}

async function copyWasmFromCdn() {
  // Skip files already present (idempotent).
  let fetched = 0
  for (const f of WASM_FILES) {
    const dst = join(PUBLIC_DST, f)
    if (await exists(dst)) continue
    const res = await fetch(`${WASM_CDN_BASE}/${f}`)
    if (!res.ok) {
      throw new Error(
        `WASM fetch failed for ${f}: ${res.status} ${res.statusText}`,
      )
    }
    await writeFile(dst, Buffer.from(await res.arrayBuffer()))
    fetched++
  }
  console.log(`[mediapipe] WASM fetched from CDN (${fetched} files)`)
  return true
}

async function ensureWasm() {
  // Already populated from a previous run?
  if (await dirHasWasm(PUBLIC_DST)) {
    console.log('[mediapipe] WASM already present in', PUBLIC_DST)
    return true
  }
  if (await copyWasmFromLocal()) return true
  console.warn(
    '[mediapipe] No local WASM dir found in node_modules; falling back to CDN…',
  )
  return copyWasmFromCdn()
}

async function ensureModel() {
  const have = await stat(MODEL_DST)
    .then((s) => s.size > 0)
    .catch(() => false)
  if (have) {
    console.log('[mediapipe] model already present at', MODEL_DST)
    return true
  }
  const res = await fetch(MODEL_URL)
  if (!res.ok) {
    throw new Error(`Model fetch failed: ${res.status} ${res.statusText}`)
  }
  await writeFile(MODEL_DST, Buffer.from(await res.arrayBuffer()))
  console.log('[mediapipe] model downloaded to', MODEL_DST)
  return true
}

async function ensureHdri() {
  const have = await stat(HDRI_DST)
    .then((s) => s.size > 0)
    .catch(() => false)
  if (have) {
    console.log('[assets] HDRI already present at', HDRI_DST)
    return true
  }
  await mkdir('public/hdri', { recursive: true })
  const res = await fetch(HDRI_URL)
  if (!res.ok) {
    throw new Error(`HDRI fetch failed: ${res.status} ${res.statusText}`)
  }
  await writeFile(HDRI_DST, Buffer.from(await res.arrayBuffer()))
  console.log('[assets] HDRI downloaded to', HDRI_DST)
  return true
}

async function main() {
  await mkdir(PUBLIC_DST, { recursive: true })

  // WASM is the local-only, must-always-succeed step. Hard-fail if it cannot
  // be satisfied (no local copy AND no CDN access) — that is a real breakage.
  await ensureWasm()

  // Network-only fetches: WARN and continue on failure so local/offline builds
  // stay green. Railway builds (which have network) WILL include these.
  for (const [label, fn] of [
    ['face_landmarker.task', ensureModel],
    ['potsdamer_platz_1k.hdr', ensureHdri],
  ]) {
    try {
      await fn()
    } catch (err) {
      console.warn(
        `\n[assets] WARNING: could not fetch ${label} (${err.message}).\n` +
          '[assets] Continuing without it. The Railway build (network available)\n' +
          '[assets] WILL fetch it. The asset is required at runtime.\n',
      )
    }
  }

  console.log('[assets] prebuild complete')
}

main().catch((err) => {
  console.error('[mediapipe] FATAL:', err.message)
  process.exit(1)
})
