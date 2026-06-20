import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  SAMPLE_TARGET,
  computeSample,
  isFrontal,
  irisPlausible,
  summarize,
  type PDSample,
  type PDResult,
} from '@/vto/lib/pd'
import { useFaceFrame } from '@/vto/hooks/useFaceFrame'
import { useFaceStore } from '@/vto/stores/faceStore'

/** Pose state used to color the pose-quality bar. */
export type PoseState = 'frontal' | 'off-axis' | 'no-face'

/** ms since last detection after which we treat the face as lost (freeze). */
const FACE_LOST_MS = 300

export interface PDMeasurement {
  samples: PDSample[]
  target: number
  result: PDResult | null
  /** Whether a face is currently visible (drives counter freeze + bar gray). */
  faceVisible: boolean
  /** Pose state for the quality bar. */
  pose: PoseState
  /** True when the most recent valid frame had an implausible iris size. */
  lightingWarning: boolean
  reset: () => void
}

/**
 * Collect up to 30 frontal PD samples and report mean ± std (Story 08).
 *
 * - Only banks a sample when a face is present AND the head is within ±5° of
 *   frontal on all three axes (AC3, AC8).
 * - Freezes the count when the face is lost; resumes on return (AC7) — no
 *   collected samples are discarded on transient loss.
 * - `reset()` clears everything to restart (AC6).
 * - When `active` is false the hook ignores all frames (panel closed → AC10:
 *   the caller also unmounts/clears on close).
 */
export function usePDMeasurement(active: boolean): PDMeasurement {
  const [samples, setSamples] = useState<PDSample[]>([])
  const [pose, setPose] = useState<PoseState>('no-face')
  const [faceVisible, setFaceVisible] = useState(false)
  const [lightingWarning, setLightingWarning] = useState(false)

  // Keep a live ref so the transient subscribe callback (which never re-binds)
  // can read the current `active` flag and sample count without resubscribing.
  const activeRef = useRef(active)
  activeRef.current = active

  const reset = useCallback(() => {
    setSamples([])
    setLightingWarning(false)
  }, [])

  // Clear in-progress measurement whenever collection is deactivated.
  useEffect(() => {
    if (!active) {
      setSamples([])
      setPose('no-face')
      setFaceVisible(false)
      setLightingWarning(false)
    }
  }, [active])

  useFaceFrame((landmarks, matrix, video) => {
    if (!activeRef.current) return

    setFaceVisible(true)

    const frontal = isFrontal(matrix)
    setPose(frontal ? 'frontal' : 'off-axis')
    if (!frontal) return

    // Compute the sample OUTSIDE any setState updater (no nested setState).
    const sample = computeSample(
      landmarks,
      video.videoWidth,
      video.videoHeight,
      matrix,
    )
    // Guard against NaN frames (degenerate iris contour).
    if (!Number.isFinite(sample.pdMm)) return

    const plausible = irisPlausible(sample.irisDiameterPx, video.videoWidth)
    setLightingWarning(!plausible)
    if (!plausible) return // implausible iris → lighting hint, don't bank

    // Append until full; freeze the set once SAMPLE_TARGET is reached.
    setSamples((prev) =>
      prev.length >= SAMPLE_TARGET ? prev : [...prev, sample],
    )
  })

  // Detect face loss to freeze the counter and gray the bar (the frame
  // callback only fires WHILE a face is present, so loss needs its own watch).
  useEffect(() => {
    if (!active) return
    const id = window.setInterval(() => {
      const { lastDetectionAt } = useFaceStore.getState()
      const lost = performance.now() - lastDetectionAt > FACE_LOST_MS
      if (lost) {
        setFaceVisible(false)
        setPose('no-face')
      }
    }, 150)
    return () => window.clearInterval(id)
  }, [active])

  const result = useMemo(
    () => (samples.length >= SAMPLE_TARGET ? summarize(samples) : null),
    [samples],
  )

  return {
    samples,
    target: SAMPLE_TARGET,
    result,
    faceVisible,
    pose,
    lightingWarning,
    reset,
  }
}
