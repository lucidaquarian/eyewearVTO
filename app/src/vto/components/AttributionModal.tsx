import { useEffect, useRef } from 'react'
import { FRAMES } from '@/vto/data/frames'

interface AttributionModalProps {
  open: boolean
  onClose: () => void
}

/**
 * Centered modal listing every catalog frame's attribution (Story 06 AC11).
 *
 * Per DESIGN-PRINCIPLES: centered card on a dim backdrop, no decoration. Each
 * row shows the frame name, creator, license, and a source link that opens in a
 * new tab (`_blank rel="noopener"`). Closes on Escape, backdrop click, or the
 * close button. Motion is gated globally by the prefers-reduced-motion rule in
 * index.css.
 */
export function AttributionModal({ open, onClose }: AttributionModalProps) {
  const closeRef = useRef<HTMLButtonElement>(null)

  // Escape to close + move focus to the close button when opened.
  useEffect(() => {
    if (!open) return
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-6"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="attribution-title"
        className="max-h-[calc(100vh-64px)] w-[480px] max-w-[calc(100vw-32px)] overflow-y-auto rounded-xl border border-border bg-surface p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <h2 id="attribution-title" className="text-lg font-semibold text-ink">
            Model attributions
          </h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md px-2 py-1 text-sm text-muted transition-colors duration-150 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
          >
            Close
          </button>
        </div>

        <ul className="mt-4 flex flex-col gap-3">
          {FRAMES.map((frame) => (
            <li key={frame.id} className="text-sm">
              <span className="font-medium text-ink">{frame.name}</span>
              <span className="text-muted">
                {' — '}
                {frame.attribution.creator}, {frame.attribution.license}
                {' · '}
                <a
                  href={frame.attribution.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline transition-colors duration-150 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
                >
                  source
                </a>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
