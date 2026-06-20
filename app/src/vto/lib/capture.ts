/**
 * Photo capture, compositing, download, and share (Story 07).
 *
 * Framework-light: no React, no Zustand. The only DOM it needs is the live
 * `<video>` element and the R3F WebGL `<canvas>`, both passed in by the caller.
 */
import { logger } from '@/vto/lib/logger'
import { toast } from '@/vto/stores/uiStore'

export const CAPTURE_WIDTH = 1280
export const CAPTURE_HEIGHT = 720

/**
 * Composite the live camera frame + the 3D glasses overlay into one
 * 1280×720 PNG blob.
 *
 * The video is mirrored (`ctx.scale(-1, 1)`) so the saved photo matches the
 * on-screen selfie view (AC9). The WebGL canvas is drawn on top WITHOUT an
 * extra flip: the selfie mirror is applied as a scene-level scale (SceneCanvas,
 * driven by faceMath MIRROR_X), so the GL canvas pixels are already in the same
 * screen orientation as the mirrored video. A faint "Virtual Try-On" watermark
 * is drawn bottom-right (AC8).
 */
export async function compositeFrame(opts: {
  video: HTMLVideoElement
  webglCanvas: HTMLCanvasElement
}): Promise<Blob> {
  const w = CAPTURE_WIDTH
  const h = CAPTURE_HEIGHT
  const out = document.createElement('canvas')
  out.width = w
  out.height = h
  const ctx = out.getContext('2d')
  if (!ctx) throw new Error('2D canvas context unavailable')

  // Live video — mirrored to match the user's on-screen (selfie) view.
  ctx.save()
  ctx.translate(w, 0)
  ctx.scale(-1, 1)
  ctx.drawImage(opts.video, 0, 0, w, h)
  ctx.restore()

  // WebGL overlay — already in screen orientation (mirror baked into the
  // pose matrix), so draw it straight. preserveDrawingBuffer keeps it readable.
  ctx.drawImage(opts.webglCanvas, 0, 0, w, h)

  // Faint watermark, bottom-right (AC8): 12px white at 60% opacity.
  ctx.font = '12px "Inter Variable", Inter, system-ui, sans-serif'
  ctx.fillStyle = 'rgba(255, 255, 255, 0.6)'
  ctx.textAlign = 'right'
  ctx.textBaseline = 'alphabetic'
  ctx.fillText('Virtual Try-On', w - 16, h - 16)

  return new Promise<Blob>((resolve, reject) => {
    out.toBlob((b) => {
      if (b) resolve(b)
      // A null blob almost always means a CORS-tainted canvas (see story
      // risks); all GLBs are same-origin so this should not happen.
      else reject(new Error('Canvas export failed (toBlob returned null)'))
    }, 'image/png')
  })
}

/**
 * Build the capture filename: `vto-<frameId>-<timestamp>.png`.
 * Timestamp is a filesystem-safe ISO-ish stamp (no colons).
 */
export function captureFilename(frameId: string): string {
  const ts = new Date()
    .toISOString()
    .replace(/[:.]/g, '-')
    .replace(/T/, '_')
    .replace(/Z$/, '')
  return `vto-${frameId}-${ts}.png`
}

/** Trigger a browser save dialog for `blob` under `filename` (AC5). */
export function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/**
 * Share the photo via the Web Share API (AC6) if available; otherwise copy a
 * data URL to the clipboard and show a confirmation toast.
 */
export async function share(blob: Blob, filename: string): Promise<void> {
  const file = new File([blob], filename, { type: 'image/png' })

  if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'My virtual try-on' })
      return
    } catch (err) {
      // User-cancelled share rejects with AbortError — that's not an error.
      if (err instanceof DOMException && err.name === 'AbortError') return
      logger.warn('navigator.share failed, falling back to clipboard', err)
      // fall through to the clipboard fallback
    }
  }

  await copyDataUrlToClipboard(blob)
}

async function copyDataUrlToClipboard(blob: Blob): Promise<void> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })

  try {
    await navigator.clipboard.writeText(dataUrl)
    toast.info('Image copied. Paste it anywhere.')
  } catch (err) {
    logger.warn('clipboard write failed', err)
    toast.error('Could not copy image. Try Download instead.')
  }
}
