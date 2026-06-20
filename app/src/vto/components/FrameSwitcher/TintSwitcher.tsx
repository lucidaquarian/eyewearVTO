import { useRef } from 'react'
import { TINTS } from '@/vto/data/tints'
import { useCatalogStore } from '@/vto/stores/catalogStore'
import { TintSwatch } from './TintSwatch'
import './FrameSwitcher.css'

/**
 * Lens-tint switcher — a strip of colour swatches that recolour the live lens.
 *
 * Mirrors FrameSwitcher's keyboard model (every swatch tabbable; Enter/Space
 * selects; Arrow keys move focus + selection) and reuses its `.frame-switcher`
 * scroll/snap CSS. It does NOT position itself — the right-rail wrapper in
 * App.tsx lays the product thumbnail and this strip out together (a fixed
 * vertical rail ≥1024px, stacked horizontal scrollers below the viewport on
 * mobile). Selecting a tint only updates the store; GlassesSwap applies it to
 * the lens material without reloading the GLB.
 */
export function TintSwitcher() {
  const selectedTintId = useCatalogStore((s) => s.selectedTintId)
  const setSelectedTint = useCatalogStore((s) => s.setSelectedTint)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])

  const move = (fromIndex: number, dir: -1 | 1) => {
    const next = fromIndex + dir
    if (next < 0 || next >= TINTS.length) return
    const tint = TINTS[next]
    if (!tint) return
    setSelectedTint(tint.id)
    itemRefs.current[next]?.focus()
  }

  const onKeyDown =
    (index: number) => (e: React.KeyboardEvent<HTMLButtonElement>) => {
      switch (e.key) {
        case 'ArrowDown':
        case 'ArrowRight':
          e.preventDefault()
          move(index, 1)
          break
        case 'ArrowUp':
        case 'ArrowLeft':
          e.preventDefault()
          move(index, -1)
          break
        default:
          break
      }
    }

  return (
    <div
      role="radiogroup"
      aria-label="Lens tint"
      className={[
        'frame-switcher',
        // shared
        'flex gap-2',
        // <1024px: horizontal scroller
        'frame-switcher--horizontal max-w-full overflow-x-auto px-4 pb-2',
        // ≥1024px: vertical column inside the right rail (positioning lives on
        // the rail wrapper, not here)
        'lg:frame-switcher--vertical lg:w-24 lg:flex-col lg:overflow-x-visible lg:px-0',
      ].join(' ')}
    >
      {TINTS.map((tint, i) => (
        <TintSwatch
          key={tint.id}
          ref={(el) => {
            itemRefs.current[i] = el
          }}
          tint={tint}
          selected={tint.id === selectedTintId}
          onSelect={setSelectedTint}
          tabIndex={0}
          onKeyDown={onKeyDown(i)}
        />
      ))}
    </div>
  )
}
