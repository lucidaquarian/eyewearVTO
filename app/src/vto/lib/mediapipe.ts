import type { FaceLandmarker, FaceLandmarkerResult } from '@mediapipe/tasks-vision'

/**
 * MediaPipe FaceLandmarker wiring.
 *
 * `@mediapipe/tasks-vision` is ~1MB plus a WASM blob, so it is loaded via a
 * dynamic `import()` inside {@link createFaceLandmarker} — it must never land in
 * the initial bundle. The caller shows a determinate progress bar while this
 * resolves (see `FaceTrackerBridge`).
 */

// Story 11: WASM runtime and the model are SELF-HOSTED under
// `app/public/mediapipe/` (populated at build time by
// `scripts/fetch-mediapipe-assets.mjs`). Both paths resolve to the single
// `/mediapipe` dir served by the app — no CDN, no second `/mediapipe-wasm/`.
// This is what lets the production CSP collapse `connect-src` to `'self'`.
const WASM_PATH = '/mediapipe'
const MODEL_PATH = '/mediapipe/face_landmarker.task'

export type { FaceLandmarker, FaceLandmarkerResult }

/** A FaceLandmarker plus which delegate it actually initialised on. CPU is the
 *  slow fallback (~80–250ms/frame) and the usual cause of visible tracking lag. */
export interface CreatedFaceLandmarker {
  landmarker: FaceLandmarker
  delegate: 'gpu' | 'cpu'
}

/**
 * Lazily import tasks-vision, resolve the WASM fileset, and build a
 * FaceLandmarker configured for single-face VIDEO tracking with the 4x4 facial
 * transformation matrix enabled (blendshapes off for ~5ms/frame savings).
 *
 * Returns the active delegate alongside the landmarker so callers can surface
 * the GPU→CPU fallback (the dominant, nondeterministic source of tracking lag).
 */
export async function createFaceLandmarker(): Promise<CreatedFaceLandmarker> {
  const { FaceLandmarker, FilesetResolver } = await import(
    '@mediapipe/tasks-vision'
  )
  const fileset = await FilesetResolver.forVisionTasks(WASM_PATH)

  const sharedOpts = {
    runningMode: 'VIDEO' as const,
    numFaces: 1,
    outputFaceBlendshapes: false,
    outputFacialTransformationMatrixes: true,
    minFaceDetectionConfidence: 0.5,
    minFacePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  }

  // GPU delegate is faster but not universally supported. If it throws (common
  // on some mobile GPUs and certain WebGL configurations), fall back to CPU so
  // face tracking still works.
  try {
    const landmarker = await FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_PATH, delegate: 'GPU' },
      ...sharedOpts,
    })
    return { landmarker, delegate: 'gpu' }
  } catch (gpuErr) {
    console.warn('[mediapipe] GPU delegate failed, retrying with CPU', gpuErr)
    const landmarker = await FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_PATH, delegate: 'CPU' },
      ...sharedOpts,
    })
    return { landmarker, delegate: 'cpu' }
  }
}

/**
 * Run one inference pass against the current video frame.
 *
 * `timestamp` MUST be monotonic — pass the `now` argument from
 * `requestAnimationFrame`, never `Date.now()` (which can go backward and makes
 * `detectForVideo` throw).
 */
export function runOnVideo(
  landmarker: FaceLandmarker,
  video: HTMLVideoElement,
  timestamp: number,
): FaceLandmarkerResult {
  return landmarker.detectForVideo(video, timestamp)
}
