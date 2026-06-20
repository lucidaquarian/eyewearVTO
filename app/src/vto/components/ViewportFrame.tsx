import { Suspense, lazy, useEffect, useRef, useState } from 'react'
import { useCameraStore } from '@/vto/stores/cameraStore'
import { queryCameraPermission } from '@/vto/lib/permissions'
import { CameraView } from '@/vto/components/CameraView'
import { PermissionCard } from '@/vto/components/PermissionCard'
import { Toaster } from '@/vto/components/Toaster'
import { CountdownOverlay } from '@/vto/components/CountdownOverlay'
import { StateHints } from '@/vto/components/states/StateHints'

// Lazy-load the R3F scene so three.js + @react-three/* land in their own chunk,
// split out of the initial bundle (AC9). It only mounts once the camera is live.
const SceneCanvas = lazy(() => import('@/vto/components/Scene/SceneCanvas'))

/**
 * The centered 16:9 viewport. Owns:
 *  - the permission pre-check (auto-start if already granted)
 *  - the camera lifecycle (start on grant, stop on unmount)
 *  - the cross-fade between the permission card and the live video
 */
export function ViewportFrame() {
  const status = useCameraStore((s) => s.status)
  const start = useCameraStore((s) => s.start)
  const stop = useCameraStore((s) => s.stop)

  const isLive = status === 'live'

  // On mount: if permission is already granted, auto-start and skip the card.
  // Strict-mode runs this twice in dev; the `cancelled` guard stops the
  // first-mount stream so we never leak a second camera track.
  const didCheck = useRef(false)
  useEffect(() => {
    let cancelled = false

    if (!didCheck.current) {
      didCheck.current = true
      void queryCameraPermission().then((state) => {
        if (cancelled) return
        if (state === 'granted') void start()
      })
    }

    return () => {
      cancelled = true
      stop()
    }
  }, [start, stop])

  return (
    <div
      className="relative aspect-video w-full max-w-[1280px] overflow-hidden rounded-xl border border-border bg-surface"
    >
      {/* Live video layer (CSS-mirrored for a natural selfie view). */}
      <Fade show={isLive} className="absolute inset-0">
        <CameraView />
      </Fade>

      {/* R3F scene composited transparently over the video, sized to the same
          frame and stacked absolutely with pointer-events-none so clicks fall
          through. It hosts the MediaPipe bridge (single shared RAF), the load
          progress bar, and the dev HUD. Mounted only while live so the GL
          context + landmarker tear down with the camera. */}
      {isLive && (
        <Suspense fallback={<div />}>
          <SceneCanvas className="absolute inset-0 !pointer-events-none" />
        </Suspense>
      )}

      {/* Permission / error card layer (centered) */}
      <Fade
        show={!isLive}
        className="absolute inset-0 flex items-center justify-center bg-bg"
      >
        <PermissionCard />
      </Fade>

      {/* Story 09: in-viewport hints (no-face, low-light) + the MediaPipe
          load-failure toast. Mounted only while live so brightness sampling and
          face-absence polling don't run before the camera is up. Enforces the
          no-face > low-light priority internally. pointer-events:none overlays
          so they never block clicks. */}
      {isLive && <StateHints />}

      {/* Story 07: the 3→2→1 capture countdown overlays the video + scene.
          Anchored here (the viewport's relative container) so its `inset-0`
          covers exactly the frame. Driven by the shared captureStore. */}
      <CountdownOverlay />

      {/* Toasts (e.g. WebGL context-loss "Refresh to recover") anchor to the
          viewport frame. */}
      <Toaster />
    </div>
  )
}

/**
 * A 200ms opacity cross-fade wrapper. Honors prefers-reduced-motion via the
 * global CSS rule in index.css (which forces transition-duration to ~0).
 * The hidden layer is taken out of the tab order and pointer flow.
 */
function Fade({
  show,
  className = '',
  children,
}: {
  show: boolean
  className?: string
  children: React.ReactNode
}) {
  // Keep a mounted flag so the outgoing layer can finish its fade.
  const [mounted, setMounted] = useState(show)

  useEffect(() => {
    if (show) {
      setMounted(true)
      return
    }
    const t = window.setTimeout(() => setMounted(false), 200)
    return () => window.clearTimeout(t)
  }, [show])

  if (!show && !mounted) return null

  return (
    <div
      aria-hidden={!show}
      className={`${className} transition-opacity duration-200 ease-out ${
        show ? 'opacity-100' : 'pointer-events-none opacity-0'
      }`}
      style={{ transitionTimingFunction: 'cubic-bezier(0.2,0,0,1)' }}
    >
      {children}
    </div>
  )
}
