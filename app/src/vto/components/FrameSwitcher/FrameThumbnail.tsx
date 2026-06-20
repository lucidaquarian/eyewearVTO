import { forwardRef } from 'react'
import type { Frame } from '@/vto/data/frames'
import { ModelPreview } from './ModelPreview'

interface FrameThumbnailProps {
  frame: Frame
  selected: boolean
  onSelect: (id: string) => void
  /** Custom uploads only: delete this frame (renders a small ✕ badge). */
  onDelete?: (id: string) => void
  /** Tab order: only the selected card is in the tab sequence (roving tabindex);
   *  arrow keys move within the group. */
  tabIndex: number
  onKeyDown: (e: React.KeyboardEvent<HTMLButtonElement>) => void
}

/**
 * One catalog frame card (Story 06 AC5/AC7/AC9):
 *  - 80×80 white card, 8px radius, 1px border (selected: 2px ink ring inset).
 *  - hover: border → ink, 150ms. focus-visible: ink ring.
 *  - thumbnail fills the card (object-cover); frame name below, 12px muted,
 *    single-line ellipsis.
 *  - 80×80 + the 8px gap/padding around it gives a ≥88px effective touch target.
 *  - user uploads additionally carry a small ✕ delete badge (a sibling button —
 *    never nested inside the radio button).
 */
export const FrameThumbnail = forwardRef<HTMLButtonElement, FrameThumbnailProps>(
  function FrameThumbnail(
    { frame, selected, onSelect, onDelete, tabIndex, onKeyDown },
    ref,
  ) {
    return (
      <div className="frame-switcher__item relative flex shrink-0 flex-col items-center gap-1">
        <button
          ref={ref}
          type="button"
          role="radio"
          aria-checked={selected}
          aria-label={frame.name}
          tabIndex={tabIndex}
          onClick={() => onSelect(frame.id)}
          onKeyDown={onKeyDown}
          className="group flex flex-col items-center gap-1 bg-transparent p-0"
        >
          <span
            className={[
              'flex h-20 w-20 items-center justify-center overflow-hidden rounded-lg bg-surface',
              'transition-colors duration-150',
              selected
                ? 'outline outline-2 -outline-offset-2 outline-ink border border-transparent'
                : 'border border-border group-hover:border-ink',
              'group-focus-visible:ring-2 group-focus-visible:ring-ink group-focus-visible:ring-offset-2 group-focus-visible:ring-offset-bg',
            ].join(' ')}
          >
            <ModelPreview modelUrl={frame.modelUrl} />
          </span>
          <span className="max-w-20 truncate text-xs text-muted">
            {frame.name}
          </span>
        </button>
        {onDelete && (
          <button
            type="button"
            aria-label={`Delete ${frame.name}`}
            onClick={() => onDelete(frame.id)}
            className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full border border-border bg-surface text-[10px] leading-none text-muted transition-colors duration-150 hover:border-ink hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
          >
            ✕
          </button>
        )}
      </div>
    )
  },
)
