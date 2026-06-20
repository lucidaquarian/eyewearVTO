import { useEffect, useState } from 'react'
import { useFaceStore } from '@/vto/stores/faceStore'

/** No-face must hold this long before the hint fades in (Story 09 AC5). */
const NO_FACE_HINT_MS = 3000

/** Poll cadence for the absence check — light, 500ms is imperceptible. */
const POLL_MS = 500

/**
 * Soft "move into the frame" hint with a faint face outline, centered in the
 * viewport (Story 09 AC5). Fades in once no face has been detected for >3s and
 * the tracker is otherwise running (`status === 'ready'`).
 *
 * The overlay container is `pointer-events: none` so it NEVER blocks clicks on
 * the UI beneath it (frame switcher, capture button, etc.).
 *
 * Priority: this is only mounted by `ViewportFrame` AFTER the camera-error and
 * browser-unsupported gates, and it suppresses itself when the low-light hint is
 * showing (`suppressed` prop) so the two never appear at once.
 */
export function NoFaceHint({ suppressed = false }: { suppressed?: boolean }) {
  const status = useFaceStore((s) => s.status)
  const [show, setShow] = useState(false)

  useEffect(() => {
    if (status !== 'ready') {
      setShow(false)
      return
    }
    // Poll the imperative store (the tracker writes lastDetectionAt without
    // re-rendering). Show the hint once a face has been absent for >3s.
    const tick = () => {
      const { faceLandmarks, lastDetectionAt } = useFaceStore.getState()
      const absentFor = performance.now() - lastDetectionAt
      setShow(faceLandmarks === null && absentFor > NO_FACE_HINT_MS)
    }
    tick()
    const id = window.setInterval(tick, POLL_MS)
    return () => window.clearInterval(id)
  }, [status])

  const visible = show && !suppressed

  return (
    <div
      aria-hidden={!visible}
      className={`pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center transition-opacity duration-200 ease-out ${
        visible ? 'opacity-100' : 'opacity-0'
      }`}
    >
      {/* Faint face outline: oval + two eye dots at ~20% opacity. */}
      <svg
        width="160"
        height="200"
        viewBox="0 0 160 200"
        fill="none"
        aria-hidden="true"
        className="text-ink opacity-20"
      >
        <ellipse
          cx="80"
          cy="100"
          rx="56"
          ry="76"
          stroke="currentColor"
          strokeWidth="3"
        />
        <circle cx="60" cy="92" r="6" fill="currentColor" />
        <circle cx="100" cy="92" r="6" fill="currentColor" />
      </svg>
      <p className="mt-4 rounded-md bg-surface/80 px-3 py-1 text-sm text-ink">
        Move into the frame
      </p>
    </div>
  )
}
