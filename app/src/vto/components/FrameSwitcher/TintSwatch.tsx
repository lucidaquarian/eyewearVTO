import { forwardRef } from 'react'
import type { Tint } from '@/vto/data/tints'

interface TintSwatchProps {
  tint: Tint
  selected: boolean
  onSelect: (id: string) => void
  /** Roving tabindex: arrow keys move within the group (see TintSwitcher). */
  tabIndex: number
  onKeyDown: (e: React.KeyboardEvent<HTMLButtonElement>) => void
}

/**
 * One lens-tint swatch: a circular colour chip (fill = the tint colour) the user
 * clicks to recolour the live lens. Mirrors FrameThumbnail's selected/focus ring
 * and a11y. Colour is the only differentiator, so the accessible name is the
 * tint name (`aria-label`) and the fill is an INLINE style — a dynamic colour
 * can't be a Tailwind class. ~48px chip + the name below gives a ≥44px target.
 */
export const TintSwatch = forwardRef<HTMLButtonElement, TintSwatchProps>(
  function TintSwatch({ tint, selected, onSelect, tabIndex, onKeyDown }, ref) {
    return (
      <button
        ref={ref}
        type="button"
        role="radio"
        aria-checked={selected}
        aria-label={tint.name}
        title={tint.name}
        tabIndex={tabIndex}
        onClick={() => onSelect(tint.id)}
        onKeyDown={onKeyDown}
        className="frame-switcher__item group flex shrink-0 flex-col items-center gap-1 bg-transparent p-0"
      >
        <span
          style={{ backgroundColor: tint.colorHex }}
          className={[
            'h-12 w-12 rounded-full border border-border',
            'transition-shadow duration-150',
            selected
              ? 'ring-2 ring-ink ring-offset-2 ring-offset-bg'
              : 'group-hover:ring-2 group-hover:ring-ink group-hover:ring-offset-2 group-hover:ring-offset-bg',
            'group-focus-visible:ring-2 group-focus-visible:ring-ink group-focus-visible:ring-offset-2 group-focus-visible:ring-offset-bg',
          ].join(' ')}
        />
        <span className="max-w-16 truncate text-xs text-muted">{tint.name}</span>
      </button>
    )
  },
)
