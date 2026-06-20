import { useCameraStore } from '@/vto/stores/cameraStore'
import type { CameraErrorCode } from '@/vto/lib/camera'

/**
 * Refined camera-error card (Story 09 AC1–AC4). This replaces the inline error
 * branch that lived in Story 02's `PermissionCard`: same ink-only card chrome
 * and "Try again" CTA, now with cause-specific copy AND — for the `denied`
 * case — a browser-specific "How to re-enable" expander (AC1).
 *
 * `PermissionCard` delegates its error branch here so there is a single source
 * of truth for camera-error UI (no forked/parallel copy).
 */

/** Cause-specific explanation copy. Sentence case, no exclamation marks. */
const ERROR_COPY: Record<CameraErrorCode, string> = {
  denied: 'You blocked camera access for this site. Re-allow it, then try again.',
  'no-device':
    'No camera was found. Check that one is connected and not disabled, then try again.',
  'in-use':
    'Your camera is being used by another app. Close that app, then try again.',
  'insecure-context':
    'Camera access needs a secure connection. Open this page over https rather than http.',
  unknown: 'Something went wrong while starting your camera. Try again.',
}

/** Short heading per cause. */
const ERROR_TITLE: Record<CameraErrorCode, string> = {
  denied: "We couldn't access your camera",
  'no-device': 'No camera found',
  'in-use': 'Your camera is busy',
  'insecure-context': 'A secure connection is required',
  unknown: "We couldn't access your camera",
}

type Browser = 'chrome' | 'edge' | 'firefox' | 'safari' | 'other'

function detectBrowser(): Browser {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent
  if (/Edg\//.test(ua)) return 'edge'
  if (/Chrome\/\d/.test(ua) && !/Edg\//.test(ua)) return 'chrome'
  if (/Firefox\//.test(ua)) return 'firefox'
  if (/Safari\//.test(ua)) return 'safari'
  return 'other'
}

/** Browser-specific steps to re-grant camera permission (sentence case). */
const REENABLE_STEPS: Record<Browser, string[]> = {
  chrome: [
    'Click the camera icon at the right of the address bar.',
    'Choose to always allow camera access for this site.',
    'Refresh the page.',
  ],
  edge: [
    'Click the camera icon at the right of the address bar.',
    'Choose to always allow camera access for this site.',
    'Refresh the page.',
  ],
  firefox: [
    'Click the camera icon to the left of the address bar.',
    'Remove the blocked camera permission for this site.',
    'Refresh the page.',
  ],
  safari: [
    'Open the Safari menu, then Settings for this website.',
    'Set Camera to Allow.',
    'Refresh the page.',
  ],
  other: [
    'Open your site permissions from the address bar or browser settings.',
    'Allow camera access for this site.',
    'Refresh the page.',
  ],
}

export function CameraErrorCard() {
  const error = useCameraStore((s) => s.error) ?? 'unknown'
  const start = useCameraStore((s) => s.start)
  const browser = detectBrowser()

  return (
    <div className="vto-camera-error-card w-[480px] max-w-[calc(100vw-32px)] rounded-xl border border-border bg-surface p-6">
      <h2 className="text-lg font-semibold text-error">{ERROR_TITLE[error]}</h2>
      <p className="mt-2 text-sm text-muted">{ERROR_COPY[error]}</p>

      {error === 'denied' && (
        <details className="vto-reenable mt-4 rounded-md border border-border bg-bg p-3 text-sm text-ink">
          <summary className="cursor-pointer select-none font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-bg">
            How to re-enable camera access
          </summary>
          <ol className="mt-3 list-decimal space-y-1 pl-5 text-muted">
            {REENABLE_STEPS[browser].map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </details>
      )}

      <button
        type="button"
        onClick={() => void start()}
        className="mt-6 inline-flex h-10 items-center justify-center rounded-lg bg-ink px-4 text-sm font-medium text-bg transition-opacity duration-150 ease-out hover:opacity-90 active:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
      >
        Try again
      </button>
    </div>
  )
}
