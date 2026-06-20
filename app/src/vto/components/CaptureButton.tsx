import { useState } from 'react'
import { compositeFrame } from '@/vto/lib/capture'
import { useCameraStore } from '@/vto/stores/cameraStore'
import { useCaptureStore } from '@/vto/stores/captureStore'
import { getWebglCanvas } from '@/vto/stores/webglCanvasRef'
import { logger } from '@/vto/lib/logger'
import { toast } from '@/vto/stores/uiStore'
import { PhotoPreviewModal } from '@/vto/components/PhotoPreviewModal'

/**
 * The "Capture" button (AC1), placed below the viewport. Clicking it runs the
 * 3→2→1 countdown (rendered INSIDE the viewport by ViewportFrame, driven via
 * the shared captureStore), then composites the freshest video + scene render
 * into a 1280×720 PNG and opens the preview modal (AC2–AC4).
 *
 * The countdown completion is signalled back here through the captureStore's
 * `onDone` ref so the double-RAF capture stays co-located with the button's
 * busy state.
 */
export function CaptureButton() {
  const start = useCaptureStore((s) => s.start)
  const cameraStatus = useCameraStore((s) => s.status)
  const [busy, setBusy] = useState(false)
  const [blob, setBlob] = useState<Blob | null>(null)

  const ready = cameraStatus === 'live' && !busy

  const startCapture = () => {
    if (!ready) return
    setBusy(true)
    start(handleCountdownDone)
  }

  const handleCountdownDone = () => {
    // Wait two nested RAFs so the captured frame reflects the freshest scene
    // render (avoids a 1-frame-stale MediaPipe result — see story timing note).
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        void doCapture()
      })
    })
  }

  const doCapture = async () => {
    try {
      const video = useCameraStore.getState().videoEl
      const webglCanvas = getWebglCanvas()
      if (!video || !webglCanvas) {
        throw new Error('camera/scene not ready for capture')
      }
      const out = await compositeFrame({ video, webglCanvas })
      setBlob(out)
    } catch (err) {
      logger.error('photo capture failed', err)
      toast.error('Could not capture photo. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={startCapture}
        disabled={!ready}
        className="rounded-md bg-ink px-4 py-2 text-sm font-medium text-bg transition-opacity duration-150 hover:opacity-90 active:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:cursor-not-allowed disabled:opacity-40"
      >
        Capture
      </button>

      <PhotoPreviewModal blob={blob} onClose={() => setBlob(null)} />
    </>
  )
}
