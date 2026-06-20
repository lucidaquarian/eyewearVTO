import { useRef } from 'react'
import { Matrix4 } from 'three'
import { FaceMatrixSmoother, matrixFromMediaPipe } from '@/vto/lib/faceMath'
import { useFaceStore } from '@/vto/stores/faceStore'

export interface FaceTransform {
  /** Smoothed head-pose matrix (reused instance — copy, don't retain). */
  matrix: Matrix4
  /** True on the frame a face is present and a matrix was produced. */
  visible: boolean
}

/**
 * Per-frame head-pose provider for the FaceAnchor.
 *
 * This hook deliberately does NOT use a React store selector: subscribing to
 * the transformation matrix via `useFaceStore((s) => s.matrix)` would re-render
 * the component ~30×/second. Instead it returns a `read()` callback that the
 * FaceAnchor calls inside `useFrame`, pulling the latest matrix imperatively
 * from the store and smoothing it with a one-Euro filter — all with zero React
 * re-renders (Story 05 Q3).
 *
 * No fit-to-face scale is computed here: MediaPipe's pose matrix is metric
 * (centimetres) and rigid, so a real-world-sized glasses model placed in the
 * canonical frame already tracks head size and distance 1:1. The model's size
 * and seating are fixed constants applied in the render tree (see GlassesSwap /
 * faceMath registration constants) rather than a per-frame heuristic.
 *
 * The returned object is stable across renders (held in a ref) and reused
 * between frames to avoid per-frame allocation.
 */
export function useFaceTransform(): {
  read: () => FaceTransform
} {
  const smoother = useRef<FaceMatrixSmoother>()
  if (!smoother.current) smoother.current = new FaceMatrixSmoother()

  const wasVisible = useRef(false)
  // Media time of the frame the smoother last advanced on. The render loop calls
  // read() ~60fps but a new pose only lands ~30fps (or slower under load), so we
  // must NOT re-feed the same frame to the one-Euro filter: a redundant call
  // looks like zero motion and decays the filter's velocity term toward 0, which
  // drops the speed-adaptive cutoff and adds lag — worse the slower detection
  // runs (more redundant calls per real sample). Advance the filter once per new
  // frame; on the in-between frames just return the last smoothed pose unchanged.
  const lastFrameTimeMs = useRef(-1)

  // Reused output object — never reallocated.
  const out = useRef<FaceTransform>({
    matrix: new Matrix4(),
    visible: false,
  })

  const read = (): FaceTransform => {
    // Drive the smoother off the frame's media time (not performance.now()): the
    // matrix only changes when a new camera frame is detected (~30fps) while this
    // runs every rendered frame (~60fps), so a frame-accurate timestamp keeps the
    // one-Euro dt/velocity correct.
    const { transformationMatrix, frameTimeMs } = useFaceStore.getState()
    const result = out.current!

    if (!transformationMatrix) {
      // Reset the filter on loss so re-acquire snaps in cleanly rather than
      // lerping from a stale pose.
      if (wasVisible.current) {
        smoother.current!.reset()
        wasVisible.current = false
        lastFrameTimeMs.current = -1
      }
      result.visible = false
      return result
    }

    // Same frame as last render tick: the smoother would only echo its last
    // output anyway, so skip it (re-running it corrupts the velocity term —
    // see lastFrameTimeMs above) and reuse the cached smoothed pose.
    if (result.visible && frameTimeMs === lastFrameTimeMs.current) {
      return result
    }
    lastFrameTimeMs.current = frameTimeMs

    const raw = matrixFromMediaPipe(transformationMatrix)
    const smoothed = smoother.current!.filter(raw, frameTimeMs)
    result.matrix.copy(smoothed)

    result.visible = true
    wasVisible.current = true
    return result
  }

  return { read }
}
