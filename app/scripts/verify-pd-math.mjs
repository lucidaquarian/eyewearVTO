/**
 * THROWAWAY headless verification for Story 08's pure PD math.
 *
 * The on-face accuracy (AC9, ±10% vs a ruler) needs a real webcam + face and is
 * inherently human. But the px→mm geometry and the pose gate CAN be exercised
 * headlessly. This script bundles the real source of `src/lib/pd.ts` with
 * esbuild (so it tests the shipping code, not a re-implementation) and asserts:
 *
 *   1. computeSample on a synthetic face with KNOWN geometry returns the exact
 *      expected PD in mm (within rounding).
 *   2. isFrontal ACCEPTS a frontal (identity-rotation) matrix and REJECTS a
 *      10°-yaw matrix.
 *   3. No NaN/Inf is produced; extractEulers reads back a known yaw.
 *   4. irisPlausible flags implausibly small / large iris diameters.
 *
 * Run from app/:   node scripts/verify-pd-math.mjs
 * Build-time only — nothing in the app bundle imports it. Safe to delete.
 */
const { build } = await import(
  '../node_modules/.pnpm/esbuild@0.25.12/node_modules/esbuild/lib/main.js'
)
import { pathToFileURL } from 'node:url'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')

async function load(entry) {
  const result = await build({
    entryPoints: [join(root, entry)],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    external: [],
    alias: { '@': join(root, 'src') },
  })
  const dir = mkdtempSync(join(tmpdir(), 'vto-vpd-'))
  const file = join(dir, 'mod.mjs')
  writeFileSync(file, result.outputFiles[0].text)
  return import(pathToFileURL(file).href)
}

let failures = 0
function assert(name, cond, detail = '') {
  const ok = !!cond
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}
function approx(a, b, tol) {
  return Math.abs(a - b) <= tol
}

const pd = await load('src/lib/pd.ts')

// --- Build a synthetic 478-landmark face with EXACT pixel geometry -----------
// Video frame 1280×720. Normalized coords = px / dimension.
const W = 1280
const H = 720

// Choose exact pixel targets:
//   iris horizontal diameter = 39 px on BOTH eyes
//   pupil-to-pupil distance   = 213.675 px  (purely horizontal)
// Expected PD = 213.675 × (11.7 / 39) = 64.1025 mm  → rounds to 64 mm.
const IRIS_PX = 39
const PUPIL_PX = 213.675
const cy = 360 // eye line, px
const lPupilX = 533.1625 // left pupil px
const rPupilX = lPupilX + PUPIL_PX

const lm = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }))
const N = (px, py) => ({ x: px / W, y: py / H, z: 0 })

// Left eye (indices 468–472): center 468, ring 469 right / 470 top / 471 left.
lm[468] = N(lPupilX, cy)
lm[469] = N(lPupilX + IRIS_PX / 2, cy) // right edge
lm[471] = N(lPupilX - IRIS_PX / 2, cy) // left edge
lm[470] = N(lPupilX, cy - IRIS_PX / 2)
lm[472] = N(lPupilX, cy + IRIS_PX / 2)
// Right eye (473–477): center 473, ring 474 right / 475 top / 476 left.
lm[473] = N(rPupilX, cy)
lm[474] = N(rPupilX + IRIS_PX / 2, cy)
lm[476] = N(rPupilX - IRIS_PX / 2, cy)
lm[475] = N(rPupilX, cy - IRIS_PX / 2)
lm[477] = N(rPupilX, cy + IRIS_PX / 2)

// Identity 4x4 column-major = perfectly frontal.
const frontalMatrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

const s = pd.computeSample(lm, W, H, frontalMatrix)
assert(
  '1a. pupilDistancePx exact',
  approx(s.pupilDistancePx, PUPIL_PX, 1e-6),
  `got ${s.pupilDistancePx.toFixed(4)}`,
)
assert(
  '1b. irisDiameterPx exact',
  approx(s.irisDiameterPx, IRIS_PX, 1e-6),
  `got ${s.irisDiameterPx.toFixed(4)}`,
)
assert(
  '1c. pdMm ≈ 64.1025 mm',
  approx(s.pdMm, 64.1025, 1e-3),
  `got ${s.pdMm.toFixed(4)}, rounds to ${Math.round(s.pdMm)}`,
)
assert('1d. no NaN/Inf in sample', Object.values(s).every(Number.isFinite))

// --- Pose gate ----------------------------------------------------------------
assert('2a. isFrontal ACCEPTS frontal matrix', pd.isFrontal(frontalMatrix))

// 10° yaw about Y (column-major). cos/sin of 10°.
const a = (10 * Math.PI) / 180
const c = Math.cos(a)
const sn = Math.sin(a)
// Rotation about Y: columns -> [c,0,-s,0, 0,1,0,0, s,0,c,0, 0,0,0,1]
const yaw10 = [c, 0, -sn, 0, 0, 1, 0, 0, sn, 0, c, 0, 0, 0, 0, 1]
assert('2b. isFrontal REJECTS 10° yaw', !pd.isFrontal(yaw10))

const e = pd.extractEulers(yaw10)
assert(
  '3a. extractEulers reads back ~10° yaw',
  approx(Math.abs(e.yawDeg), 10, 0.01),
  `yaw=${e.yawDeg.toFixed(3)} pitch=${e.pitchDeg.toFixed(3)} roll=${e.rollDeg.toFixed(3)}`,
)
assert(
  '3b. frontal matrix → ~0° on all axes',
  ['yawDeg', 'pitchDeg', 'rollDeg'].every(
    (k) => Math.abs(pd.extractEulers(frontalMatrix)[k]) < 1e-6,
  ),
)

// --- Iris plausibility / lighting hint ---------------------------------------
assert('4a. 39px iris @1280 is plausible', pd.irisPlausible(39, 1280))
assert('4b. 5px iris @1280 implausible (too small)', !pd.irisPlausible(5, 1280))
assert('4c. 140px iris @1280 implausible (too large)', !pd.irisPlausible(140, 1280))
// thresholds scale with width: at 640-wide, min is 5px so 8px is plausible.
assert('4d. thresholds scale with width (8px @640 plausible)', pd.irisPlausible(8, 640))

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
