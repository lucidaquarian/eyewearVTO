import { lazy, Suspense, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import type { RootState } from '@react-three/fiber'
import { ReleaseGLContext } from '@/lib/ReleaseGLContext'
import { Lights } from '@/vto/components/Scene/Lights'
import { CameraBackground } from '@/vto/components/Scene/CameraBackground'
import { RenderStats } from '@/vto/components/Scene/RenderStats'
import { GlassesSwap } from '@/vto/components/Scene/GlassesSwap'
import { FaceAnchor } from '@/vto/components/Scene/FaceAnchor'
import { MIRROR_X, FLIP_Y } from '@/vto/lib/faceMath'
import { isDebug } from '@/vto/lib/debug'
import { FaceTrackerBridge } from '@/vto/components/Scene/FaceTrackerBridge'
import { FaceTrackerLoader } from '@/vto/components/FaceTrackerLoader'
import { DevDebugOverlay } from '@/vto/components/DevDebugOverlay'
import { logger } from '@/vto/lib/logger'
import { toast } from '@/vto/stores/uiStore'
import { setWebglCanvas } from '@/vto/stores/webglCanvasRef'

// Dev-only: lazily code-split LandmarkDebug behind `import.meta.env.DEV` so the
// debug overlay (and its whole module) is dropped from production bundles
// (Story 05 AC8 — "Removed in production"). In a prod build `import.meta.env.DEV`
// folds to `false`, the ternary's dynamic import is unreachable, and Rollup
// tree-shakes LandmarkDebug out entirely.
const LandmarkDebug = import.meta.env.DEV
  ? lazy(() =>
      import('@/vto/components/Scene/LandmarkDebug').then((m) => ({
        default: m.LandmarkDebug,
      })),
    )
  : null

/**
 * The R3F scene composited transparently on top of the camera `<video>`.
 *
 * Fills its (absolutely-positioned) parent exactly, so it shares the video's
 * pixel box and resizes with it — R3F's `<Canvas>` observes its container and
 * keeps the drawing buffer + camera aspect in sync on every resize/fullscreen
 * (AC3). The GL context is transparent (`alpha`) so the video shows through
 * (AC1).
 *
 * This whole module is lazy-imported by `ViewportFrame`, so R3F + three.js +
 * drei land in their own chunk, split out of the initial bundle (AC9).
 *
 * It also hosts the MediaPipe bridge (AC6) and the load progress bar / dev HUD
 * that Story 03 used to render — those move here because detection now lives in
 * the R3F render loop.
 */
export function SceneCanvas({ className = '' }: { className?: string }) {
  const [progress, setProgress] = useState(0)
  const [loading, setLoading] = useState(true)
  // Evaluated once at mount; in production builds isDebug() is statically false
  // so the LandmarkDebug subtree is dropped from the bundle.
  const debug = isDebug()

  // Set true right before we intentionally drop the GL context on unmount (see
  // <ReleaseGLContext> below), so the webglcontextlost handler can tell a normal
  // close apart from a real, unexpected context loss and stay quiet on close.
  const tearingDownRef = useRef(false)

  const handleCreated = ({ gl }: RootState) => {
    // Story 07: publish the live GL canvas so compositeFrame() can read it.
    // (preserveDrawingBuffer:true on the <Canvas> below keeps it readable.)
    setWebglCanvas(gl.domElement)

    // WebGL context-loss handler (AC7): log it and show a recovery toast.
    // We don't attempt automatic restore — a refresh re-creates everything
    // cleanly, which is the documented recovery path for this app.
    gl.domElement.addEventListener(
      'webglcontextlost',
      (e) => {
        e.preventDefault()
        // Drop the stale canvas ref so a capture can't read a dead context.
        setWebglCanvas(null)
        // Expected loss: we asked for it while unmounting the scene (closing the
        // try-on). Don't alarm the user with a "Refresh to recover" toast.
        if (tearingDownRef.current) return
        logger.error('WebGL context lost')
        // Story 09 AC8: refine the existing toast with a Reload action button.
        toast.error('3D view stopped working. Refresh to recover.', {
          label: 'Reload',
          onClick: () => window.location.reload(),
        })
      },
      { once: false },
    )
  }

  return (
    <>
      <Canvas
        className={className}
        // alpha → transparent background (video shows through);
        // preserveDrawingBuffer → required for Story 07 photo capture.
        gl={{ alpha: true, antialias: true, preserveDrawingBuffer: true }}
        // Camera matches MediaPipe's assumed virtual camera so the pose matrix
        // projects the glasses onto the face: vertical fov 63° (the constant
        // baked into the FaceLandmarker graph), camera at the origin looking −Z,
        // near/far straddling the centimetre-scale scene (face at z ≈ −60 cm).
        // Aspect is driven by the (16:9) canvas, matching the 1280×720 video.
        camera={{ fov: 63, near: 1, far: 10000, position: [0, 0, 0] }}
        dpr={[1, 2]}
        onCreated={handleCreated}
        // The canvas is decorative relative to the live video and must not
        // intercept clicks meant for the UI beneath it.
        aria-hidden
      >
        {/* Release the WebGL context when the try-on closes (camera stop unmounts
            this canvas). Without it each open/close leaks a context until the
            browser's per-process cap is hit and MediaPipe's GPU delegate can no
            longer allocate — the root cause of tracking degrading over a session.
            Outside <Suspense> so it isn't subject to suspense remounts. */}
        <ReleaseGLContext
          onBeforeLoss={() => {
            tearingDownRef.current = true
            setWebglCanvas(null)
          }}
        />
        <Suspense fallback={null}>
          <Lights />
          {/* The camera frame, rendered in-scene so face pixels + glasses share
              an instant (Bug #2 lock). Outside the mirror group; mirrors itself. */}
          <CameraBackground />
          <FaceTrackerBridge
            onProgress={setProgress}
            onLoaded={() => setLoading(false)}
            onLoadError={() => setLoading(false)}
          />
          {/* Story 05: the glasses live inside the face-anchor group, which
              drives its matrix from the smoothed MediaPipe head pose.
              Story 06: the static <Glasses/> child is replaced by <GlassesSwap/>,
              which renders the catalog-selected GLB and cross-fades on change.
              The selfie mirror is a scene-level scale here (NOT baked into the
              pose matrix — that would corrupt the smoother's decompose), applied
              OUTSIDE the smoother and matching the video's CSS mirror. */}
          <group scale={[MIRROR_X ? -1 : 1, FLIP_Y ? -1 : 1, 1]}>
            <FaceAnchor>
              <GlassesSwap />
            </FaceAnchor>
          </group>
          {debug && LandmarkDebug && (
            <LandmarkDebug indices={[168, 234, 454]} />
          )}
          {import.meta.env.DEV && <RenderStats />}
        </Suspense>
      </Canvas>

      {/* DOM overlays — rendered outside the Canvas so they're normal HTML. */}
      {loading && <FaceTrackerLoader progress={progress} />}
      <DevDebugOverlay />
    </>
  )
}

// Default export so `React.lazy(() => import('./Scene/SceneCanvas'))` works.
export default SceneCanvas
