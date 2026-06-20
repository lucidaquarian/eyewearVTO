import { Matrix4, Euler } from 'three'
import type { NormalizedLandmark } from '@mediapipe/tasks-vision'

/**
 * Pure, framework-free PD (pupillary distance) math — Story 08.
 *
 * No React, no Zustand, no DOM. Takes plain landmarks + video dimensions +
 * the head transformation matrix, returns numbers. This is the only part of
 * Story 08 that is unit-testable headlessly (see scripts/verify-pd-math.mjs).
 *
 * Scale-free method (research: Bertelsen–Visee iris constant):
 *   pd_mm = pupil_px_distance × (IRIS_DIAMETER_MM / iris_px_diameter)
 * The horizontal iris diameter (a known physical length, ~11.7mm across humans)
 * provides the px→mm scale, so no camera calibration is needed.
 */

/** Average human horizontal iris diameter in mm (Bertelsen–Visee, ±0.5mm). */
export const IRIS_DIAMETER_MM = 11.7

/** Frontal pose tolerance in degrees on each of yaw / pitch / roll. */
export const POSE_LIMIT_DEG = 5

/** Number of valid frontal samples to collect before reporting. */
export const SAMPLE_TARGET = 30

/** Reference frame width the iris-plausibility px thresholds are stated against. */
const REF_VIDEO_WIDTH = 1280
const IRIS_MIN_PX_AT_REF = 10
const IRIS_MAX_PX_AT_REF = 100

// MediaPipe refined-iris landmark indices.
const LEFT_PUPIL = 468
const LEFT_IRIS_RIGHT = 469
const LEFT_IRIS_LEFT = 471
const RIGHT_PUPIL = 473
const RIGHT_IRIS_RIGHT = 474
const RIGHT_IRIS_LEFT = 476

export interface PDSample {
  pdMm: number
  irisDiameterPx: number
  pupilDistancePx: number
  yawDeg: number
  pitchDeg: number
  rollDeg: number
}

export interface PDResult {
  /** Mean PD in mm across the collected samples. */
  mean: number
  /** Population standard deviation in mm. */
  std: number
  /** mean − std. */
  low: number
  /** mean + std. */
  high: number
}

function deg(d: number): number {
  return (d * Math.PI) / 180
}

/** Euclidean pixel distance between two normalized landmarks. */
export function pixelDist(
  a: NormalizedLandmark,
  b: NormalizedLandmark,
  w: number,
  h: number,
): number {
  const dx = (a.x - b.x) * w
  const dy = (a.y - b.y) * h
  return Math.hypot(dx, dy)
}

/**
 * Extract head yaw / pitch / roll (degrees) from the MediaPipe facial
 * transformation matrix. Uses Euler order 'YXZ' so yaw is the clean outermost
 * angle (see handoff Q3) — the natural decomposition for a face looking around.
 */
export function extractEulers(matrix: number[] | Float32Array): {
  yawDeg: number
  pitchDeg: number
  rollDeg: number
} {
  const m4 = new Matrix4().fromArray(
    matrix instanceof Float32Array ? Array.from(matrix) : matrix,
  )
  const e = new Euler().setFromRotationMatrix(m4, 'YXZ')
  const r = (rad: number) => (rad * 180) / Math.PI
  return { yawDeg: r(e.y), pitchDeg: r(e.x), rollDeg: r(e.z) }
}

/**
 * True when the head is within `limitDeg` of frontal on all three axes.
 * Pose gate for sample collection (AC3, AC7).
 */
export function isFrontal(
  matrix: number[] | Float32Array,
  limitDeg = POSE_LIMIT_DEG,
): boolean {
  const m4 = new Matrix4().fromArray(
    matrix instanceof Float32Array ? Array.from(matrix) : matrix,
  )
  const e = new Euler().setFromRotationMatrix(m4, 'YXZ')
  const lim = deg(limitDeg)
  return Math.abs(e.x) < lim && Math.abs(e.y) < lim && Math.abs(e.z) < lim
}

/** Alias matching the story's pure-function naming. */
export const gateByPose = isFrontal

/**
 * Is the measured iris pixel diameter physically plausible? Thresholds are
 * stated at a 1280-wide reference frame and scaled to the actual width so the
 * check is resolution-independent. Implausible → caller shows a lighting hint.
 */
export function irisPlausible(irisDiameterPx: number, videoW: number): boolean {
  if (!Number.isFinite(irisDiameterPx) || irisDiameterPx <= 0) return false
  const scale = videoW > 0 ? videoW / REF_VIDEO_WIDTH : 1
  return (
    irisDiameterPx >= IRIS_MIN_PX_AT_REF * scale &&
    irisDiameterPx <= IRIS_MAX_PX_AT_REF * scale
  )
}

/**
 * Compute a single PD sample from one detection frame.
 *
 * pupilDistancePx = px distance between left (468) and right (473) pupil centers.
 * irisDiameterPx  = average of each eye's HORIZONTAL iris span
 *                   (left 469↔471, right 474↔476).
 * pdMm            = pupilDistancePx × (IRIS_DIAMETER_MM / irisDiameterPx).
 *
 * Throws if required landmarks are missing (caller must ensure 478 landmarks).
 */
export function computeSample(
  landmarks: NormalizedLandmark[],
  videoW: number,
  videoH: number,
  matrix: number[] | Float32Array,
): PDSample {
  const lPupil = landmarks[LEFT_PUPIL]
  const rPupil = landmarks[RIGHT_PUPIL]
  const lIrisR = landmarks[LEFT_IRIS_RIGHT]
  const lIrisL = landmarks[LEFT_IRIS_LEFT]
  const rIrisR = landmarks[RIGHT_IRIS_RIGHT]
  const rIrisL = landmarks[RIGHT_IRIS_LEFT]

  if (!lPupil || !rPupil || !lIrisR || !lIrisL || !rIrisR || !rIrisL) {
    throw new Error('computeSample: missing iris/pupil landmarks (need 478)')
  }

  const pupilDistancePx = pixelDist(lPupil, rPupil, videoW, videoH)

  const lIrisHorizontal = pixelDist(lIrisL, lIrisR, videoW, videoH)
  const rIrisHorizontal = pixelDist(rIrisL, rIrisR, videoW, videoH)
  const irisDiameterPx = (lIrisHorizontal + rIrisHorizontal) / 2

  const pdMm = pupilDistancePx * (IRIS_DIAMETER_MM / irisDiameterPx)

  return {
    pdMm,
    irisDiameterPx,
    pupilDistancePx,
    ...extractEulers(matrix),
  }
}

/** Reduce a set of samples to mean ± std PD (population std). Null if empty. */
export function summarize(samples: PDSample[]): PDResult | null {
  if (samples.length === 0) return null
  const n = samples.length
  const mean = samples.reduce((a, s) => a + s.pdMm, 0) / n
  const variance =
    samples.reduce((a, s) => a + (s.pdMm - mean) ** 2, 0) / n
  const std = Math.sqrt(variance)
  return { mean, std, low: mean - std, high: mean + std }
}
