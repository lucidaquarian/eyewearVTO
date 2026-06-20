/**
 * Thin determinate progress bar shown while MediaPipe (module + WASM + model)
 * loads, after the camera has granted. Pinned to the top edge of the viewport.
 *
 * The progress value is a faked-but-determinate creep owned by the
 * `FaceTrackerBridge` (MediaPipe surfaces no real load progress); it snaps to
 * 100% on completion.
 */
export function FaceTrackerLoader({ progress }: { progress: number }) {
  const clamped = Math.max(0, Math.min(100, progress))
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-10">
      <div
        role="progressbar"
        aria-label="Loading face tracking"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(clamped)}
        className="h-1 w-full bg-border"
      >
        <div
          className="h-full bg-ink transition-[width] duration-150 ease-out"
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  )
}
