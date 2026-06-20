/**
 * Detection-input downscaling for the slow CPU (XNNPACK) delegate.
 *
 * MediaPipe's per-frame cost on the CPU delegate scales with the input image
 * (image-to-tensor + the face-detection pass), so feeding it a smaller frame
 * trims latency on devices stuck on CPU — which is what makes the glasses trail
 * on those devices. We do this ONLY on the CPU delegate: on the GPU delegate
 * detection is already cheap, and downscaling there would only throw away
 * landmark precision (less "glued"). The in-scene background is always drawn
 * from the full-resolution frame, so display quality is unchanged either way.
 *
 * The detection size keeps the camera's 16:9 aspect (the pose matrix is
 * aspect-sensitive — only the pixel COUNT may change, not the shape), at 1/4 the
 * pixels of the 1280×720 capture.
 */

/** Detection input width (16:9 downscale of the 1280×720 capture). */
export const DETECT_WIDTH = 640
/** Detection input height (16:9 downscale of the 1280×720 capture). */
export const DETECT_HEIGHT = 360

let detectCanvas: HTMLCanvasElement | null = null
let detectCtx: CanvasRenderingContext2D | null = null

/**
 * Draw `video` into a reused offscreen canvas at the detection resolution and
 * return that canvas, for the MAIN-THREAD MediaPipe path to detect on (the
 * worker path downscales with `createImageBitmap`'s resize options instead).
 * Returns null if no 2D context is available, so the caller can fall back to
 * detecting on the full-resolution source.
 */
export function downscaleForDetection(
  video: HTMLVideoElement,
): HTMLCanvasElement | null {
  if (!detectCanvas) {
    if (typeof document === 'undefined') return null
    detectCanvas = document.createElement('canvas')
    detectCanvas.width = DETECT_WIDTH
    detectCanvas.height = DETECT_HEIGHT
    detectCtx = detectCanvas.getContext('2d', { desynchronized: true })
  }
  if (!detectCtx) return null
  detectCtx.drawImage(video, 0, 0, DETECT_WIDTH, DETECT_HEIGHT)
  return detectCanvas
}
