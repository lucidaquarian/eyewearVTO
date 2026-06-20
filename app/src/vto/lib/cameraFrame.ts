/**
 * Shared snapshot of the camera frame the CURRENT pose was computed from.
 *
 * Bug #2 lock: the live `<video>` DOM layer shows whatever frame the browser
 * compositor has RIGHT NOW, but the glasses pose trails by inference + smoothing,
 * so the face pixels and the glasses come from different instants and the glasses
 * "bounce" on fast motion. Instead, the detection path draws each newly-detected
 * frame here and `CameraBackground` renders it INSIDE the WebGL scene — so the
 * face pixels and the glasses are always from the same frame and stay locked
 * together regardless of the absolute pipeline latency.
 *
 * Main-thread only (uses a 2D canvas). The worker path posts its frame bitmap
 * back to the main thread, which then calls {@link setCameraFrame} with it.
 */

const W = 1280
const H = 720

let canvas: HTMLCanvasElement | null = null
let ctx: CanvasRenderingContext2D | null = null
let version = 0

function ensure(): CanvasRenderingContext2D | null {
  if (!ctx && typeof document !== 'undefined') {
    canvas = document.createElement('canvas')
    canvas.width = W
    canvas.height = H
    // `desynchronized` lets the 2D canvas skip a frame of compositing latency.
    ctx = canvas.getContext('2d', { desynchronized: true })
  }
  return ctx
}

/** Draw the just-detected frame (the video element, or a worker-returned bitmap)
 *  into the snapshot. Bumps the version so the texture only re-uploads on change. */
export function setCameraFrame(source: CanvasImageSource): void {
  const c = ensure()
  if (!c) return
  c.drawImage(source, 0, 0, W, H)
  version++
}

/** The snapshot canvas, used as a CanvasTexture source. Created lazily. */
export function getCameraFrameCanvas(): HTMLCanvasElement | null {
  ensure()
  return canvas
}

/** Monotonic counter bumped on every new frame (so the texture re-uploads only
 *  when the content actually changed, not every rendered frame). */
export function getCameraFrameVersion(): number {
  return version
}
