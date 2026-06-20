import FaceLandmarkerWorker from '../workers/faceLandmarker.worker.ts?worker'
import type { NormalizedLandmark } from '@mediapipe/tasks-vision'
import { setCameraFrame } from '@/vto/lib/cameraFrame'
import { DETECT_WIDTH, DETECT_HEIGHT } from '@/vto/lib/detectionInput'
import { useFaceStore } from '@/vto/stores/faceStore'
import { FPS } from '@/vto/lib/fps'

/**
 * Main-thread driver for the FaceLandmarker worker (Bug #2).
 *
 * Pumps one frame per NEW camera frame via `requestVideoFrameCallback` (falling
 * back to rAF + `currentTime` where rVFC is unsupported), grabbing an ImageBitmap
 * and transferring it to the worker. Applies backpressure (one frame in flight;
 * extras are dropped) so detection always works on the freshest frame and latency
 * can't pile up. Results are written imperatively into `useFaceStore` (zero React
 * re-renders), and the returned frame is shown as the in-scene background paired
 * with its pose before being freed.
 */

const NO_FACE_TIMEOUT_MS = 500

/** rVFC isn't in the standard DOM lib types yet; declare the surface we use. */
interface RVFCVideo {
  requestVideoFrameCallback?: (
    cb: (now: number, meta: { mediaTime: number }) => void,
  ) => number
  cancelVideoFrameCallback?: (handle: number) => void
}

export interface FaceWorkerHandle {
  stop(): void
}

export function startFaceWorker(
  video: HTMLVideoElement,
  cb: { onReady: () => void; onError: (message: string) => void },
): FaceWorkerHandle {
  const worker = new FaceLandmarkerWorker()
  const v = video as HTMLVideoElement & RVFCVideo
  const useRVFC = typeof v.requestVideoFrameCallback === 'function'

  const fps = new FPS()
  let detectEma = 0
  let inFlight = false
  let stopped = false
  let rvfcHandle = 0
  let rafHandle = 0
  let lastMediaTime = -1
  // Active delegate (from the worker's 'ready' message). On 'cpu' we downscale
  // the detection input; null/'gpu' send the full frame.
  let delegate: 'gpu' | 'cpu' | null = null
  // On the CPU path, the full-res frame kept on the main thread to show as the
  // background while a downscaled copy is sent to the worker for detection.
  let pendingFullFrame: ImageBitmap | null = null

  const pump = (mediaTimeMs: number) => {
    if (stopped || inFlight || video.readyState < 2) return
    inFlight = true
    createImageBitmap(video).then(
      (full) => {
        if (stopped) {
          full.close()
          inFlight = false
          return
        }
        if (delegate !== 'cpu') {
          // GPU (or not-yet-known): efficient shared-frame lock — send the one
          // full-res frame; the worker echoes it back and we show exactly it.
          worker.postMessage(
            { type: 'detect', bitmap: full, timestampMs: mediaTimeMs },
            [full],
          )
          return
        }
        // Slow CPU delegate: detect on a downscaled copy to cut inference + transfer
        // cost, but keep the full-res frame to show as the in-scene background (same
        // instant, so the lock holds). The worker echoes the small bitmap back; the
        // result handler discards it and shows pendingFullFrame instead.
        createImageBitmap(full, {
          resizeWidth: DETECT_WIDTH,
          resizeHeight: DETECT_HEIGHT,
          resizeQuality: 'low',
        }).then(
          (small) => {
            if (stopped) {
              full.close()
              small.close()
              inFlight = false
              return
            }
            pendingFullFrame?.close()
            pendingFullFrame = full
            worker.postMessage(
              { type: 'detect', bitmap: small, timestampMs: mediaTimeMs },
              [small],
            )
          },
          () => {
            // resize unsupported/failed — detect on the full frame this time.
            if (stopped) {
              full.close()
              inFlight = false
              return
            }
            worker.postMessage(
              { type: 'detect', bitmap: full, timestampMs: mediaTimeMs },
              [full],
            )
          },
        )
      },
      () => {
        inFlight = false
      },
    )
  }

  const onRVFC = (_now: number, meta: { mediaTime: number }) => {
    if (stopped) return
    lastMediaTime = meta.mediaTime * 1000
    pump(lastMediaTime)
    rvfcHandle = v.requestVideoFrameCallback!(onRVFC)
  }
  const onRAF = () => {
    if (stopped) return
    const mt = video.currentTime * 1000
    if (mt !== lastMediaTime) {
      lastMediaTime = mt
      pump(mt)
    }
    rafHandle = requestAnimationFrame(onRAF)
  }

  worker.onmessage = (e: MessageEvent) => {
    const msg = e.data as
      | { type: 'ready'; delegate: 'gpu' | 'cpu' }
      | { type: 'error'; error: string }
      | {
          type: 'result'
          landmarks: NormalizedLandmark[] | null
          matrix: number[] | null
          timestampMs: number
          detectMs: number
          bitmap: ImageBitmap
        }

    if (msg.type === 'ready') {
      if (stopped) return
      delegate = msg.delegate
      useFaceStore.setState({ delegate: msg.delegate })
      cb.onReady()
      if (useRVFC) rvfcHandle = v.requestVideoFrameCallback!(onRVFC)
      else rafHandle = requestAnimationFrame(onRAF)
      return
    }
    if (msg.type === 'error') {
      cb.onError(msg.error)
      return
    }

    // result — clear backpressure, show the frame, write the pose.
    inFlight = false
    const { landmarks, matrix, timestampMs, detectMs, bitmap } = msg
    if (pendingFullFrame) {
      // CPU path: `bitmap` is the downscaled detection frame the worker echoed
      // back — discard it and show the kept full-res frame from the same instant.
      bitmap.close()
      setCameraFrame(pendingFullFrame)
      pendingFullFrame.close()
      pendingFullFrame = null
    } else {
      setCameraFrame(bitmap)
      bitmap.close()
    }
    detectEma = detectEma === 0 ? detectMs : detectEma * 0.9 + detectMs * 0.1
    fps.tick(performance.now())
    if (landmarks) {
      useFaceStore.setState({
        faceLandmarks: landmarks,
        transformationMatrix: matrix,
        lastDetectionAt: performance.now(),
        frameTimeMs: timestampMs,
        fps: fps.value,
        detectMs: detectEma,
      })
    } else {
      const { lastDetectionAt, faceLandmarks } = useFaceStore.getState()
      if (
        faceLandmarks !== null &&
        performance.now() - lastDetectionAt > NO_FACE_TIMEOUT_MS
      ) {
        useFaceStore.setState({
          faceLandmarks: null,
          transformationMatrix: null,
        })
      }
      useFaceStore.setState({ fps: fps.value, detectMs: detectEma })
    }
  }

  worker.onerror = (e: ErrorEvent) => {
    if (!stopped) cb.onError(e.message || 'face worker error')
  }

  worker.postMessage({ type: 'init' })

  return {
    stop() {
      stopped = true
      if (rvfcHandle && typeof v.cancelVideoFrameCallback === 'function') {
        v.cancelVideoFrameCallback(rvfcHandle)
      }
      if (rafHandle) cancelAnimationFrame(rafHandle)
      pendingFullFrame?.close()
      pendingFullFrame = null
      worker.terminate()
    },
  }
}
