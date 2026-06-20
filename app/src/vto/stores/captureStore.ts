import { create } from 'zustand'

interface CaptureState {
  /** True while the 3→2→1 countdown is running (CaptureButton sets it). */
  countingDown: boolean
  /** Fired by the overlay when the countdown reaches 0 (CaptureButton sets it). */
  onDone: (() => void) | null
  /** Begin a countdown that calls `onDone` on completion. */
  start: (onDone: () => void) => void
  /** Clear the countdown flag (called by the overlay after firing onDone). */
  finish: () => void
}

/**
 * Shared capture flag (Story 07). The CaptureButton (rendered below the
 * viewport) calls `start(onDone)`; the CountdownOverlay (rendered INSIDE the
 * viewport frame by ViewportFrame so it covers the video + scene) subscribes to
 * `countingDown` and invokes `onDone` when the numerals finish. This avoids
 * threading props across the App layout while keeping the overlay anchored to
 * the viewport's relative container.
 */
export const useCaptureStore = create<CaptureState>((set, get) => ({
  countingDown: false,
  onDone: null,
  start: (onDone) => set({ countingDown: true, onDone }),
  finish: () => {
    const { onDone } = get()
    set({ countingDown: false, onDone: null })
    onDone?.()
  },
}))
