import { useCameraStore } from '@/vto/stores/cameraStore'
import { CameraErrorCard } from '@/vto/components/states/CameraErrorCard'

/**
 * Pre-camera card. Shows the friendly "grant access" prompt; on any camera
 * failure it delegates to the refined {@link CameraErrorCard} (Story 09 AC1–AC4)
 * so there is a single source of truth for camera-error UI.
 */
export function PermissionCard() {
  const status = useCameraStore((s) => s.status)
  const start = useCameraStore((s) => s.start)

  const isError = status === 'denied' || status === 'error'
  const isRequesting = status === 'requesting'

  if (isError) return <CameraErrorCard />

  return (
    <div className="w-[480px] max-w-[calc(100vw-32px)] rounded-xl border border-border bg-surface p-6">
      <h2 className="text-lg font-semibold text-ink">See yourself in our frames</h2>
      <p className="mt-2 text-sm text-muted">
        Grant camera access to try glasses on in real time.
      </p>
      <button
        type="button"
        onClick={() => void start()}
        disabled={isRequesting}
        className="mt-6 inline-flex h-10 items-center justify-center rounded-lg bg-ink px-4 text-sm font-medium text-bg transition-opacity duration-150 ease-out hover:opacity-90 active:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:cursor-not-allowed disabled:opacity-40"
      >
        {isRequesting ? 'Requesting…' : 'Use my camera'}
      </button>
    </div>
  )
}
