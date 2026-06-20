import { create } from 'zustand'
import type { NormalizedLandmark } from '@mediapipe/tasks-vision'

export type FaceStatus = 'idle' | 'loading' | 'ready' | 'loadError'

export interface FaceState {
  /** 478 normalized landmarks for the single tracked face, or null when no
   *  face has been seen for >500ms (or never). */
  faceLandmarks: NormalizedLandmark[] | null
  /** 16-element, column-major 4x4 facial transformation matrix (row-major in
   *  math terms but MediaPipe emits it in the order Three.js's
   *  `Matrix4.fromArray` expects). null when no face is tracked. */
  transformationMatrix: number[] | null
  /** Monotonic timestamp (rAF `now`) of the last frame a face was detected. */
  lastDetectionAt: number
  /** Video media-time (ms) of the frame the current matrix was computed from.
   *  Frame-accurate, so the pose smoother gets a correct dt/velocity even when
   *  detection (~30fps) and render (~60fps) run at different rates. */
  frameTimeMs: number
  /** Rolling-average detections per second (the tracker/worker loop). */
  fps: number
  /** Rolling-average R3F render FPS (dev HUD). With the worker, this should run
   *  ~60 while {@link fps} (detection) runs ~30 — the decoupling made visible. */
  renderFps: number
  /** Smoothed MediaPipe inference time per frame, in ms (dev HUD only). */
  detectMs: number
  /** Which MediaPipe delegate actually initialised. 'gpu' is ~5–15ms/frame;
   *  'cpu' (the fallback when GPU init throws) is ~80–250ms/frame and is the
   *  usual reason the whole locked view trails head motion. null until known. */
  delegate: 'gpu' | 'cpu' | null
  /** Lifecycle of the MediaPipe load + run. */
  status: FaceStatus
  /** Populated only when status === 'loadError' (Story 09 renders it). */
  error: string | null
}

export const useFaceStore = create<FaceState>(() => ({
  faceLandmarks: null,
  transformationMatrix: null,
  lastDetectionAt: 0,
  frameTimeMs: 0,
  fps: 0,
  renderFps: 0,
  detectMs: 0,
  delegate: null,
  status: 'idle',
  error: null,
}))
