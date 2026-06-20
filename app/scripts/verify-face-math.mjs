/**
 * THROWAWAY headless verification for Story 05's pure math.
 *
 * Story 05's on-face behaviour cannot be verified without a GPU + webcam, but
 * the FILTER MATH can be exercised headlessly. This script bundles the real
 * source of `src/lib/oneEuro.ts` and `src/lib/faceMath.ts` with esbuild (so it
 * tests the shipping code, not a re-implementation) and asserts:
 *
 *   1. No NaNs/Infs ever leave the filters.
 *   2. Output is STABLE on a constant input (jitter rejection / AC5).
 *   3. Output LAG is reduced on a ramp vs. a plain heavy exponential filter
 *      (the one-Euro speed adaptation / AC3).
 *   4. FaceMatrixSmoother preserves a unit quaternion and tracks a moving pose.
 *
 * Run from app/:   node scripts/verify-face-math.mjs
 * It is build-time only — nothing in the app bundle imports it. Safe to delete.
 */
// esbuild lives in pnpm's nested store (not hoisted); resolve it explicitly.
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
    external: [], // bundle three in too
    alias: { '@': join(root, 'src') },
  })
  const dir = mkdtempSync(join(tmpdir(), 'vto-vfm-'))
  const file = join(dir, 'mod.mjs')
  writeFileSync(file, result.outputFiles[0].text)
  return import(pathToFileURL(file).href)
}

let failures = 0
function check(name, cond) {
  const ok = !!cond
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
  if (!ok) failures++
}

const oneEuro = await load('src/lib/oneEuro.ts')
const faceMath = await load('src/lib/faceMath.ts')

// ---- 1. No NaN on noisy input + 2. stable on constant input -----------------
{
  const f = new oneEuro.OneEuroFilter()
  let t = 0
  let anyNaN = false
  // constant 5.0 with tiny ±0.02 jitter
  const outs = []
  for (let i = 0; i < 200; i++) {
    t += 1000 / 30
    const noisy = 5 + (Math.random() - 0.5) * 0.04
    const y = f.filter(noisy, t)
    if (!Number.isFinite(y)) anyNaN = true
    if (i > 100) outs.push(y)
  }
  check('OneEuro: no NaN/Inf on noisy constant input', !anyNaN)
  const mean = outs.reduce((a, b) => a + b, 0) / outs.length
  const variance =
    outs.reduce((a, b) => a + (b - mean) ** 2, 0) / outs.length
  // Filtered std-dev should be a fraction of the input jitter std (~0.0115).
  check(
    `OneEuro: rejects jitter (out std ${Math.sqrt(variance).toExponential(2)} < 0.006)`,
    Math.sqrt(variance) < 0.006,
  )
  check('OneEuro: settles near the true constant', Math.abs(mean - 5) < 0.02)
}

// ---- 3. Reduced lag on a ramp vs. a heavy fixed exponential filter ----------
{
  const oe = new oneEuro.OneEuroFilter()
  // Heavy exponential (factor ~0.15) — the "too laggy" baseline the story warns
  // about. Lower factor = more lag.
  let expY = 0
  let expInit = false
  const EXP_A = 0.15
  let t = 0
  let oeErr = 0
  let expErr = 0
  for (let i = 0; i < 90; i++) {
    t += 1000 / 30
    const truth = i * 0.1 // fast linear ramp
    const oeY = oe.filter(truth, t)
    if (!expInit) {
      expY = truth
      expInit = true
    } else {
      expY = EXP_A * truth + (1 - EXP_A) * expY
    }
    if (i > 5) {
      oeErr += Math.abs(oeY - truth)
      expErr += Math.abs(expY - truth)
    }
  }
  check(
    `OneEuro: less lag on ramp than heavy exp (oeErr ${oeErr.toFixed(2)} < expErr ${expErr.toFixed(2)})`,
    oeErr < expErr,
  )
}

// ---- 4. FaceMatrixSmoother: unit quaternion + tracks a moving pose ----------
{
  const { Matrix4, Quaternion, Vector3, Euler } = await import('three')

  const smoother = new faceMath.FaceMatrixSmoother()
  let t = 0
  let badQuat = false
  let anyNaN = false
  const pos = new Vector3()
  const quat = new Quaternion()
  const scl = new Vector3()
  let lastY = 0
  for (let i = 0; i < 120; i++) {
    t += 1000 / 30
    // A head turning in yaw and translating right.
    const m = new Matrix4()
    const q = new Quaternion().setFromEuler(new Euler(0, i * 0.01, 0))
    m.compose(new Vector3(i * 0.002, 0, -0.3), q, new Vector3(1, 1, 1))
    const out = smoother.filter(m, t)
    out.decompose(pos, quat, scl)
    if (Math.abs(quat.length() - 1) > 1e-3) badQuat = true
    if (![pos.x, pos.y, pos.z, quat.x, quat.w, scl.x].every(Number.isFinite))
      anyNaN = true
    lastY = pos.x
  }
  check('FaceMatrixSmoother: quaternion stays unit-length', !badQuat)
  check('FaceMatrixSmoother: no NaN through decompose/recompose', !anyNaN)
  // After 120 frames of translating right, smoothed X should have tracked.
  check(`FaceMatrixSmoother: tracks translation (x≈${lastY.toFixed(3)} > 0.15)`, lastY > 0.15)
}

console.log(`\n${failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'}`)
process.exit(failures === 0 ? 0 : 1)
