import { useEffect, useState } from 'react'
import { useCaptureStore } from '@/vto/stores/captureStore'

const HOLD_MS = 700
const FADE_MS = 300
const STEP_MS = HOLD_MS + FADE_MS // ~1s per numeral → ~3s total

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

/**
 * Full-viewport (of the camera frame) 3→2→1 countdown overlay (AC2).
 *
 * Rendered INSIDE the viewport's relative container (by ViewportFrame) so its
 * `absolute inset-0` covers the video + scene. A 30%-opacity ink scrim with a
 * large white numeral centered (the largest type-scale step, `text-display`
 * 32px, scaled up 3× as a decorative glyph — no off-scale font size literal).
 * Each numeral fades in then out over 300ms
 * with a 700ms hold; total ~3s. When `prefers-reduced-motion: reduce` is set,
 * the fade is replaced by a hard cut. On completion it calls `captureStore`'s
 * `finish()`, which clears the flag and fires the CaptureButton's capture.
 */
export function CountdownOverlay() {
  const active = useCaptureStore((s) => s.countingDown)
  const finish = useCaptureStore((s) => s.finish)
  // null = idle; 3,2,1 = the numeral being shown.
  const [count, setCount] = useState<number | null>(null)
  const [visible, setVisible] = useState(false)
  const reduced = prefersReducedMotion()

  useEffect(() => {
    if (!active) {
      setCount(null)
      setVisible(false)
      return
    }

    let n = 3
    setCount(n)
    setVisible(true)

    const timers: number[] = []

    const schedule = () => {
      // Fade the current numeral out near the end of its step (skipped when
      // reduced-motion → hard cut).
      if (!reduced) {
        timers.push(window.setTimeout(() => setVisible(false), HOLD_MS))
      }
      // Advance to the next numeral (or finish) at the end of the step.
      timers.push(
        window.setTimeout(() => {
          n -= 1
          if (n >= 1) {
            setCount(n)
            setVisible(true)
            schedule()
          } else {
            setCount(null)
            setVisible(false)
            finish()
          }
        }, STEP_MS),
      )
    }

    schedule()

    return () => {
      timers.forEach((t) => window.clearTimeout(t))
    }
    // Re-run only when activation flips. `finish`/`reduced` are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  if (count === null) return null

  return (
    <div
      className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-ink/30"
      aria-hidden="true"
    >
      <span
        className={`select-none scale-[3] text-display font-bold leading-none text-bg transition-opacity ease-out ${
          visible ? 'opacity-100' : 'opacity-0'
        }`}
        style={{
          transitionDuration: reduced ? '0.01ms' : `${FADE_MS}ms`,
        }}
      >
        {count}
      </span>
    </div>
  )
}
