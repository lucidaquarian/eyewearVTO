import { useEffect, useMemo, useRef, useState } from 'react'
import { captureFilename, download, share } from '@/vto/lib/capture'
import { useCatalogStore } from '@/vto/stores/catalogStore'

interface PhotoPreviewModalProps {
  /** The captured PNG blob, or null when the modal is closed. */
  blob: Blob | null
  /** Close + discard the captured photo (revokes the object URL upstream). */
  onClose: () => void
}

/**
 * Preview modal shown after a capture (AC4). Displays the photo at max
 * 720×405 (16:9) on a dim backdrop with centered Download + Share buttons.
 * Esc or scrim click closes and discards the blob (AC7). The object URL is
 * created here and revoked on unmount / blob change to avoid leaks.
 */
export function PhotoPreviewModal({ blob, onClose }: PhotoPreviewModalProps) {
  const selectedFrameId = useCatalogStore((s) => s.selectedFrameId)
  const closeRef = useRef<HTMLButtonElement>(null)
  const [sharing, setSharing] = useState(false)

  // Build a fresh object URL per blob; revoke it when the blob changes/clears.
  const url = useMemo(() => (blob ? URL.createObjectURL(blob) : null), [blob])
  useEffect(() => {
    if (!url) return
    return () => URL.revokeObjectURL(url)
  }, [url])

  // Esc to close + focus management while open.
  useEffect(() => {
    if (!blob) return
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [blob, onClose])

  if (!blob || !url) return null

  const filename = captureFilename(selectedFrameId)

  const handleShare = async () => {
    setSharing(true)
    try {
      await share(blob, filename)
    } finally {
      setSharing(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-6"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="photo-preview-title"
        className="flex max-h-[calc(100vh-64px)] max-w-[calc(100vw-32px)] flex-col items-center gap-6 overflow-y-auto rounded-xl border border-border bg-surface p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex w-full items-start justify-between gap-4">
          <h2
            id="photo-preview-title"
            className="text-lg font-semibold text-ink"
          >
            Your photo
          </h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close and discard photo"
            className="rounded-md px-2 py-1 text-sm text-muted transition-colors duration-150 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
          >
            Close
          </button>
        </div>

        <img
          src={url}
          alt="Your virtual try-on photo"
          width={720}
          height={405}
          className="aspect-video w-full max-w-[720px] rounded-md border border-border object-cover"
        />

        <div className="flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => download(blob, filename)}
            className="rounded-md bg-ink px-4 py-2 text-sm font-medium text-bg transition-opacity duration-150 hover:opacity-90 active:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
          >
            Download
          </button>
          <button
            type="button"
            onClick={handleShare}
            disabled={sharing}
            className="rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium text-ink transition-colors duration-150 hover:border-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:cursor-not-allowed disabled:opacity-40"
          >
            Share
          </button>
        </div>
      </div>
    </div>
  )
}
