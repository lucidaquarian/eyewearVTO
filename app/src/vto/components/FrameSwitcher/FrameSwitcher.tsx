import { useRef } from 'react'
import { FRAMES } from '@/vto/data/frames'
import { useCatalogStore } from '@/vto/stores/catalogStore'
import { FrameThumbnail } from './FrameThumbnail'
import { UploadFrame } from './UploadFrame'
import './FrameSwitcher.css'

/**
 * The frame catalog switcher (Story 06 AC5–AC10).
 *
 * Layout is responsive via a single rendered list whose container swaps between
 * a vertical column at ≥1024px and a horizontal scroller at <1024px. The actual
 * rail positioning (fixed, right edge, centred) lives on the wrapper in App.tsx
 * so the product thumbnail and the lens-tint strip share one rail. To avoid
 * duplicate DOM / duplicate focus targets we render ONE list and switch flex
 * direction with Tailwind `lg:` variants.
 *
 * Keyboard (AC8): every card is in the Tab order; Enter/Space selects (native
 * button behaviour); ArrowUp/Down (and Left/Right for the horizontal scroller)
 * move focus AND selection to the adjacent frame.
 *
 * USER UPLOADS: custom frames (IndexedDB-backed) are appended after the static
 * catalog with a ✕ delete badge, followed by the "Upload .glb" tile.
 */
export function FrameSwitcher() {
  const selectedFrameId = useCatalogStore((s) => s.selectedFrameId)
  const setSelected = useCatalogStore((s) => s.setSelected)
  const customFrames = useCatalogStore((s) => s.customFrames)
  const removeCustomFrame = useCatalogStore((s) => s.removeCustomFrame)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])

  const frames = [...FRAMES, ...customFrames]

  const move = (fromIndex: number, dir: -1 | 1) => {
    const next = fromIndex + dir
    if (next < 0 || next >= frames.length) return
    const frame = frames[next]
    if (!frame) return
    setSelected(frame.id)
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
      aria-label="Glasses frames"
      className={[
        'frame-switcher',
        // shared
        'flex gap-2',
        // <1024px: horizontal scroller
        'frame-switcher--horizontal max-w-full overflow-x-auto px-4 pb-2',
        // ≥1024px: vertical column inside the right rail (positioning lives on
        // the rail wrapper in App.tsx)
        'lg:frame-switcher--vertical lg:w-24 lg:flex-col lg:overflow-x-visible lg:px-0',
      ].join(' ')}
    >
      {frames.map((frame, i) => (
        <FrameThumbnail
          key={frame.id}
          ref={(el) => {
            itemRefs.current[i] = el
          }}
          frame={frame}
          selected={frame.id === selectedFrameId}
          onSelect={setSelected}
          onDelete={frame.custom ? removeCustomFrame : undefined}
          tabIndex={0}
          onKeyDown={onKeyDown(i)}
        />
      ))}
      <UploadFrame />
    </div>
  )
}
