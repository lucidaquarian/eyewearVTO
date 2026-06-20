import { useEffect, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { createFaceLandmarker } from '@/vto/lib/mediapipe'
import type { FaceLandmarker } from '@/vto/lib/mediapipe'
import { setCameraFrame } from '@/vto/lib/cameraFrame'
import { downscaleForDetection } from '@/vto/lib/detectionInput'
import { startFaceWorker, type FaceWorkerHandle } from '@/vto/lib/faceWorkerClient'
import { FPS } from '@/vto/lib/fps'
import { isWebKit } from '@/vto/lib/platform'
import { useCameraStore } from '@/vto/stores/cameraStore'
import { useFaceStore } from '@/vto/stores/faceStore'
import { logger } from '@/vto/lib/logger'

/** How long a face may be absent before we clear it from the store. */
const NO_FACE_TIMEOUT_MS = 500

/**
 * Bridges MediaPipe face detection into the app.
 *
 * Preferred path (Bug #2): detection runs in a Web Worker pumped by
 * `requestVideoFrameCallback` (see lib/faceWorkerClient), so the R3F render loop
 * stays a smooth 60fps and frame pacing is even. If the worker can't be created
 * or fails to initialise (e.g. an environment where tasks-vision won't run in a
 * worker), it falls back to running one detection per frame inside R3F's
 * `useFrame` on the main thread — the original, proven path. Either way results
 * are written imperatively into `useFaceStore` (no React re-renders) and the
 * detected frame is snapshotted for the in-scene background.
 *
 * Renders nothing; it's a logic node living inside the `<Canvas>` tree.
 */
export function FaceTrackerBridge({
  onProgress,
  onLoaded,
  onLoadError,
}: {
  onProgress?: (pct: number) => void
  onLoaded?: () => void
  onLoadError?: (message: string) => void
}) {
  const video = useCameraStore((s) => s.videoEl)
  const landmarkerRef = useRef<FaceLandmarker | null>(null)
  const workerRef = useRef<FaceWorkerHandle | null>(null)
  // True once the worker is detecting; the main-thread useFrame then stands down.
  const workerActiveRef = useRef(false)
  const fpsRef = useRef(new FPS())
  // EMA of per-frame inference time (ms), surfaced in the dev HUD to tell apart
  // "detection is the bottleneck" from a render-bound frame (Phase-0 triage).
  const detectMsRef = useRef(0)
  // Media-time of the last frame we ran inference on, so we never re-detect the
  // same camera frame (render can tick faster than the camera delivers frames).
  const lastMediaTimeRef = useRef(-1)
  // Which delegate the main-thread landmarker initialised on. On 'cpu' we detect
  // on a downscaled frame to cut inference cost; 'gpu' detects full-res.
  const mainDelegateRef = useRef<'gpu' | 'cpu' | null>(null)

  useEffect(() => {
    // Detection (worker or fallback) needs the video element as its frame source.
    if (!video) return

    let cancelled = false

    // Fake determinate progress — MediaPipe exposes no real load progress, so
    // creep 0 -> 90% then snap to 100% on load (sanctioned in tech-stack.md).
    let fake = 0
    onProgress?.(0)
    const progressTimer = window.setInterval(() => {
      fake = Math.min(90, fake + 6)
      onProgress?.(fake)
    }, 40)

    useFaceStore.setState({ status: 'loading', error: null })

    const finishLoad = () => {
      window.clearInterval(progressTimer)
      onProgress?.(100)
      useFaceStore.setState({ status: 'ready' })
      onLoaded?.()
    }

    // Fallback: run detection on the main thread (original Story 03 path).
    const startMainThread = () => {
      createFaceLandmarker()
        .then(({ landmarker, delegate }) => {
          if (cancelled) {
            landmarker.close()
            return
          }
          landmarkerRef.current = landmarker
          mainDelegateRef.current = delegate
          useFaceStore.setState({ delegate })
          finishLoad()
        })
        .catch((e) => {
          window.clearInterval(progressTimer)
          if (cancelled) return
          logger.error('FaceLandmarker init failed', e)
          useFaceStore.setState({ status: 'loadError', error: String(e) })
          onLoadError?.(String(e))
        })
    }

    // WebKit (Safari + all iOS browsers): MediaPipe's GPU delegate can't get a
    // reliable WebGL2 context inside the worker (OffscreenCanvas WebGL is missing
    // / flaky in WebKit), so the worker silently falls back to the ~80-250ms/frame
    // CPU delegate and the glasses lag. The main thread has full WebGL2 there, so
    // run detection on it to keep the GPU delegate. Skip the worker entirely on
    // WebKit — trying it first would just burn a model load on the slow path.
    // Chromium keeps the off-thread worker below (GPU + a free main thread).
    if (isWebKit()) {
      logger.info('WebKit detected; running face detection on the main thread')
      startMainThread()
    } else {
      // Prefer the off-thread worker; fall back to main-thread detection on failure.
      try {
        workerRef.current = startFaceWorker(video, {
          onReady: () => {
            if (cancelled) {
              workerRef.current?.stop()
              workerRef.current = null
              return
            }
            workerActiveRef.current = true
            finishLoad()
          },
          onError: (message) => {
            logger.warn('Face worker failed; using main-thread detection', message)
            workerRef.current?.stop()
            workerRef.current = null
            workerActiveRef.current = false
            if (!cancelled && !landmarkerRef.current) startMainThread()
          },
        })
      } catch (err) {
        logger.warn('Face worker unavailable; using main-thread detection', err)
        startMainThread()
      }
    }

    return () => {
      cancelled = true
      window.clearInterval(progressTimer)
      workerRef.current?.stop()
      workerRef.current = null
      workerActiveRef.current = false
      landmarkerRef.current?.close()
      landmarkerRef.current = null
      useFaceStore.setState({ fps: 0, detectMs: 0, delegate: null })
    }
    // Re-run only when the video element appears/changes; onProgress/onLoaded/
    // onLoadError are idempotent UI callbacks and must not re-init detection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [video])

  useFrame(() => {
    // When the worker is driving detection, the main-thread path stands down.
    if (workerActiveRef.current) return

    const lm = landmarkerRef.current
    if (!video || !lm || video.readyState < 2) return

    // Only run inference on a NEW camera frame: render can tick at 60fps while the
    // camera delivers ~30fps, and re-detecting the same frame wastes the GPU and
    // feeds the pose smoother zero-motion samples (corrupting its velocity term).
    const mediaTime = video.currentTime
    if (mediaTime === lastMediaTimeRef.current) return
    lastMediaTimeRef.current = mediaTime

    // Snapshot this exact frame for the in-scene background, so the rendered face
    // pixels and the pose computed below come from the same instant (Bug #2 lock).
    // Always the FULL-RES video — only the detection input below may be downscaled.
    setCameraFrame(video)

    // On the slow CPU delegate, detect on a downscaled copy of this same frame to
    // cut inference cost; the GPU delegate detects the full frame for maximum
    // landmark precision. The downscaled canvas is the same instant as the
    // background, so the shared-frame lock still holds.
    const detectInput =
      mainDelegateRef.current === 'cpu'
        ? (downscaleForDetection(video) ?? video)
        : video

    // Monotonic timestamp required by detectForVideo — never Date.now().
    const now = performance.now()
    const result = lm.detectForVideo(detectInput, now)
    // Inference cost for this frame (the `now` above is the call's start time).
    const detectMs = performance.now() - now
    detectMsRef.current =
      detectMsRef.current === 0
        ? detectMs
        : detectMsRef.current * 0.9 + detectMs * 0.1
    const face = result.faceLandmarks[0]

    if (face) {
      useFaceStore.setState({
        faceLandmarks: face,
        transformationMatrix:
          result.facialTransformationMatrixes?.[0]?.data ?? null,
        lastDetectionAt: now,
        // Frame-accurate media time for the pose smoother's dt (Bug #2).
        frameTimeMs: mediaTime * 1000,
      })
    } else {
      // Preserve Story 03 AC #4: clear landmarks after 500ms with no face.
      // Clear only once to avoid churning the store every frame.
      const { lastDetectionAt, faceLandmarks } = useFaceStore.getState()
      if (faceLandmarks !== null && now - lastDetectionAt > NO_FACE_TIMEOUT_MS) {
        useFaceStore.setState({ faceLandmarks: null, transformationMatrix: null })
      }
    }

    fpsRef.current.tick(now)
    useFaceStore.setState({
      fps: fpsRef.current.value,
      detectMs: detectMsRef.current,
    })
  })

  return null
}
