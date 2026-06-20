/**
 * FaceLandmarker Web Worker (Bug #2): runs MediaPipe detection OFF the main
 * thread so the render loop stays smooth and frame pacing is even.
 *
 * Built as a CLASSIC worker (Vite's `?worker` default format) on purpose:
 * tasks-vision calls `importScripts()` internally to load its WASM glue, which a
 * `{ type: 'module' }` worker forbids. For the same reason tasks-vision is
 * imported STATICALLY here (Vite bundles it into the worker) — a classic worker
 * cannot use the dynamic `import()` that `lib/mediapipe.createFaceLandmarker` uses.
 *
 * Protocol:
 *   main → { type:'init' }                        → worker → { type:'ready' | 'error' }
 *   main → { type:'detect', bitmap, timestampMs } → worker → { type:'result', …, bitmap }
 * The detected frame's ImageBitmap is transferred back so the main thread can show
 * it as the in-scene background paired with exactly this pose (the shared-frame lock).
 */
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision'

// Same self-hosted paths as lib/mediapipe.ts (served from /mediapipe, same origin).
const WASM_PATH = '/mediapipe'
const MODEL_PATH = '/mediapipe/face_landmarker.task'

// The app tsconfig uses the DOM lib (where `self` is typed as Window). Cast to
// just the worker surface we use rather than pulling in the WebWorker lib.
const ctx = self as unknown as {
  postMessage(message: unknown, transfer?: Transferable[]): void
  onmessage: ((e: MessageEvent) => void) | null
}

let landmarker: FaceLandmarker | null = null
let lastTs = 0
// Which delegate actually initialised — reported in the 'ready' message so the
// main thread can surface it. CPU is the slow fallback that causes the lag.
let activeDelegate: 'gpu' | 'cpu' = 'gpu'

async function init(): Promise<void> {
  const fileset = await FilesetResolver.forVisionTasks(WASM_PATH)
  const opts = {
    runningMode: 'VIDEO' as const,
    numFaces: 1,
    outputFaceBlendshapes: false,
    outputFacialTransformationMatrixes: true,
    minFaceDetectionConfidence: 0.5,
    minFacePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  }
  try {
    landmarker = await FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_PATH, delegate: 'GPU' },
      ...opts,
    })
    activeDelegate = 'gpu'
  } catch {
    // GPU delegate is unsupported on some workers/GPUs — fall back to CPU.
    landmarker = await FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_PATH, delegate: 'CPU' },
      ...opts,
    })
    activeDelegate = 'cpu'
  }
}

ctx.onmessage = (e: MessageEvent) => {
  const msg = e.data as
    | { type: 'init' }
    | { type: 'detect'; bitmap: ImageBitmap; timestampMs: number }

  if (msg.type === 'init') {
    init().then(
      () => ctx.postMessage({ type: 'ready', delegate: activeDelegate }),
      (err: unknown) => ctx.postMessage({ type: 'error', error: String(err) }),
    )
    return
  }

  const { bitmap, timestampMs } = msg
  if (!landmarker) {
    bitmap.close()
    return
  }
  // detectForVideo demands strictly-increasing timestamps.
  const ts = timestampMs > lastTs ? timestampMs : lastTs + 1
  lastTs = ts

  let landmarks: unknown = null
  let matrix: number[] | null = null
  const t0 = performance.now()
  try {
    const result = landmarker.detectForVideo(bitmap, ts)
    landmarks = result.faceLandmarks[0] ?? null
    const m = result.facialTransformationMatrixes?.[0]?.data
    matrix = m ? Array.from(m) : null
  } catch {
    // Swallow and still post a (null) result so the client clears `inFlight`.
  }
  const detectMs = performance.now() - t0

  // Transfer the frame back so the main thread can render it as the background
  // paired with THIS pose, then free it there.
  ctx.postMessage(
    { type: 'result', landmarks, matrix, timestampMs: ts, detectMs, bitmap },
    [bitmap],
  )
}
