import { useEffect, useRef } from 'react'
import type { NormalizedLandmark } from '@mediapipe/tasks-vision'
import { useFaceStore } from '@/vto/stores/faceStore'
import { useCameraStore } from '@/vto/stores/cameraStore'

type Callback = (
  landmarks: NormalizedLandmark[],
  matrix: number[],
  video: HTMLVideoElement,
) => void

/**
 * Fire `cb` once per *new* face-detection frame WITHOUT re-rendering React.
 *
 * The face store updates ~30×/sec; subscribing to it through a React selector
 * would re-render the component on every frame. Instead we use Zustand's
 * transient `subscribe` API and gate on `lastDetectionAt` changing.
 *
 * Story 03 put the live <video> in `cameraStore`, not `faceStore`, so the
 * element is read imperatively from `useCameraStore.getState().videoEl`.
 * The callback only fires when landmarks + matrix + a ready video are all
 * present, so consumers never see null inputs.
 */
export function useFaceFrame(cb: Callback): void {
  const cbRef = useRef(cb)
  cbRef.current = cb // always latest, no resubscribe

  useEffect(() => {
    const unsubscribe = useFaceStore.subscribe((s, prev) => {
      if (s.lastDetectionAt === prev.lastDetectionAt) return
      const { faceLandmarks, transformationMatrix } = s
      if (!faceLandmarks || !transformationMatrix) return
      const video = useCameraStore.getState().videoEl
      if (!video || video.videoWidth === 0) return
      cbRef.current(faceLandmarks, transformationMatrix, video)
    })
    return unsubscribe
  }, [])
}
