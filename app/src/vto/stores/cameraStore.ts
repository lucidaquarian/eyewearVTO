import { create } from 'zustand'
import { classifyCameraError, startCamera, stopCamera } from '@/vto/lib/camera'
import type { CameraErrorCode } from '@/vto/lib/camera'
import { logger } from '@/vto/lib/logger'

export type CameraStatus = 'idle' | 'requesting' | 'live' | 'denied' | 'error'

export interface CameraState {
  status: CameraStatus
  stream: MediaStream | null
  /** Set by CameraView on mount; Story 03+ reads it to feed MediaPipe. */
  videoEl: HTMLVideoElement | null
  error: CameraErrorCode | null
  start: () => Promise<void>
  stop: () => void
  setVideoEl: (el: HTMLVideoElement | null) => void
  reset: () => void
}

export const useCameraStore = create<CameraState>((set, get) => ({
  status: 'idle',
  stream: null,
  videoEl: null,
  error: null,

  start: async () => {
    // Don't double-request if a stream is already coming/here.
    const { status } = get()
    if (status === 'requesting' || status === 'live') return

    set({ status: 'requesting', error: null })
    try {
      const stream = await startCamera()
      set({ status: 'live', stream, error: null })
      logger.info('camera live')
    } catch (err) {
      const code = classifyCameraError(err)
      set({
        status: code === 'denied' ? 'denied' : 'error',
        stream: null,
        error: code,
      })
      logger.warn('camera start failed', code)
    }
  },

  stop: () => {
    const { stream } = get()
    stopCamera(stream)
    set({ status: 'idle', stream: null })
  },

  setVideoEl: (el) => set({ videoEl: el }),

  reset: () => {
    const { stream } = get()
    stopCamera(stream)
    set({ status: 'idle', stream: null, error: null })
  },
}))
