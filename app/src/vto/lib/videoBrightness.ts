/**
 * Low-light detection (Story 09 AC6).
 *
 * Draws the live video into a tiny 32×32 offscreen canvas and averages the luma
 * (Rec. 601 weights) to a single 0–255 brightness value. Cheap enough to sample
 * every 2 seconds (see `LOW_LIGHT_SAMPLE_MS`).
 *
 * Hysteresis (see thresholds): below `LOW_LIGHT_ON` we show the hint, above
 * `LOW_LIGHT_OFF` we hide it. The gap between the two thresholds stops the hint
 * from flickering when the brightness hovers around a single value.
 */

/** Sample cadence in milliseconds — every 2s is plenty for ambient light. */
export const LOW_LIGHT_SAMPLE_MS = 2000

/** Below this average luma (0–255) the scene is "too dark" → show the hint. */
export const LOW_LIGHT_ON = 40

/** Above this average luma the scene is bright enough → hide the hint. */
export const LOW_LIGHT_OFF = 60

// A single reused offscreen canvas — no need to allocate one per sample.
let sampleCanvas: HTMLCanvasElement | null = null
let sampleCtx: CanvasRenderingContext2D | null = null

/**
 * Average luma (0–255) of the current video frame, or `null` if the frame can't
 * be sampled yet (video not ready, or 2D context unavailable).
 */
export function sampleBrightness(video: HTMLVideoElement): number | null {
  if (video.readyState < 2 || video.videoWidth === 0) return null

  if (!sampleCanvas) {
    sampleCanvas = document.createElement('canvas')
    sampleCanvas.width = 32
    sampleCanvas.height = 32
    sampleCtx = sampleCanvas.getContext('2d', { willReadFrequently: true })
  }
  const ctx = sampleCtx
  if (!ctx) return null

  try {
    ctx.drawImage(video, 0, 0, 32, 32)
    const { data } = ctx.getImageData(0, 0, 32, 32)
    let sum = 0
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i] ?? 0
      const g = data[i + 1] ?? 0
      const b = data[i + 2] ?? 0
      sum += 0.299 * r + 0.587 * g + 0.114 * b
    }
    return sum / (32 * 32)
  } catch {
    // getImageData can throw on a tainted canvas; treat as "can't sample".
    return null
  }
}

/**
 * Apply the hysteresis thresholds. Given the previous "is it dark" state and a
 * fresh brightness sample, return the next state. Pure — unit-testable.
 */
export function nextLowLightState(wasLow: boolean, brightness: number): boolean {
  if (wasLow) return brightness <= LOW_LIGHT_OFF
  return brightness < LOW_LIGHT_ON
}
