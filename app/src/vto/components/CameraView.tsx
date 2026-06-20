import { useEffect, useRef } from 'react'
import { useCameraStore } from '@/vto/stores/cameraStore'

/**
 * Renders the live <video> element.
 *
 * The stream is CSS-mirrored (`scale-x-[-1]`) for a natural selfie view ONLY.
 * The underlying MediaStream is un-mirrored — Story 03's MediaPipe consumer
 * reads the raw frames, so it must account for the display mirror itself.
 */
export function CameraView() {
  const stream = useCameraStore((s) => s.stream)
  const setVideoEl = useCameraStore((s) => s.setVideoEl)
  const videoRef = useRef<HTMLVideoElement>(null)

  // Register the DOM node so Stories 03/04 can subscribe to it via the store.
  useEffect(() => {
    setVideoEl(videoRef.current)
    return () => setVideoEl(null)
  }, [setVideoEl])

  // Attach / detach the MediaStream to the element.
  useEffect(() => {
    const el = videoRef.current
    if (el && stream) {
      el.srcObject = stream
    }
    return () => {
      if (el) el.srcObject = null
    }
  }, [stream])

  return (
    <video
      ref={videoRef}
      autoPlay
      playsInline
      muted
      aria-label="Live camera preview"
      className="h-full w-full object-cover scale-x-[-1]"
    />
  )
}
