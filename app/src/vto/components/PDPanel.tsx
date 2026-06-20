import { useEffect, useRef } from 'react'
import { usePDMeasurement } from '@/vto/hooks/usePDMeasurement'
import { PoseQualityBar } from '@/vto/components/PoseQualityBar'
import { PDResult } from '@/vto/components/PDResult'

interface PDPanelProps {
  open: boolean
  onClose: () => void
}

/**
 * PD measurement panel (Story 08).
 *
 * Layout: slide-in from the right at ≥1024px (320px wide); full-width bottom
 * sheet (~60vh) below that. Closing discards any in-progress measurement
 * (AC10) — the hook is fed `active={open}` and clears its samples when inactive.
 *
 * Disclaimer hygiene: "estimate" and the optometrist disclaimer are always
 * visible with the result; never presented as a medical / prescription value.
 */
export function PDPanel({ open, onClose }: PDPanelProps) {
  const { samples, target, result, pose, lightingWarning, reset } =
    usePDMeasurement(open)
  const closeRef = useRef<HTMLButtonElement>(null)

  // Escape to close + focus the close button on open.
  useEffect(() => {
    if (!open) return
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  return (
    <>
      {/* Backdrop — click to close. Pointer-events only when open. */}
      <div
        aria-hidden={!open}
        onClick={onClose}
        role="presentation"
        className={`fixed inset-0 z-40 bg-ink/40 transition-opacity duration-200 ease-out ${
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      />

      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="pd-panel-title"
        aria-hidden={!open}
        className={[
          'fixed z-50 flex flex-col gap-6 overflow-y-auto border-border bg-surface p-6',
          // Bottom sheet (<1024px): full width, pinned to bottom, ~60vh.
          'inset-x-0 bottom-0 h-[60vh] rounded-t-xl border-t',
          'transition-transform duration-200 ease-out',
          open ? 'translate-y-0' : 'translate-y-full',
          // Slide-in panel (≥1024px): 320px, right edge, full height.
          'lg:inset-y-0 lg:left-auto lg:right-0 lg:h-auto lg:w-[320px]',
          'lg:rounded-none lg:border-l lg:border-t-0',
          open ? 'lg:translate-x-0' : 'lg:translate-x-full lg:translate-y-0',
        ].join(' ')}
      >
        <div className="flex items-start justify-between gap-4">
          <h2 id="pd-panel-title" className="text-lg font-semibold text-ink">
            Measure your PD
          </h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close PD panel"
            className="rounded-md px-2 py-1 text-sm text-muted transition-colors duration-150 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
          >
            Close
          </button>
        </div>

        <p className="text-sm text-muted">
          Face the camera straight on, eyes open, glasses off if possible. Hold
          still for 5 seconds.
        </p>

        {result ? (
          <div className="flex flex-col gap-6">
            <PDResult result={result} />
            <button
              type="button"
              onClick={reset}
              className="self-start rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium text-ink transition-colors duration-150 hover:border-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
            >
              Try again
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <PoseQualityBar pose={pose} />
            <p className="text-sm text-muted">
              {samples.length} / {target} samples
            </p>
            {lightingWarning && (
              <p className="text-sm text-error">
                Lighting check: we can&rsquo;t see your iris clearly. Move to a
                brighter, evenly lit spot and face the camera.
              </p>
            )}
            <p className="text-xs text-muted">
              This is an estimate (±5–10% on a laptop webcam), not a prescription
              measurement. Confirm with your optometrist.
            </p>
          </div>
        )}
      </aside>
    </>
  )
}
