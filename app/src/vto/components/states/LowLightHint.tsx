import { useEffect, useState } from 'react'
import { useCameraStore } from '@/vto/stores/cameraStore'
import {
  LOW_LIGHT_SAMPLE_MS,
  nextLowLightState,
  sampleBrightness,
} from '@/vto/lib/videoBrightness'

/**
 * Low-light hint (Story 09 AC6). Samples the live video brightness every 2s and
 * fades in a "too dark" hint with hysteresis (see {@link nextLowLightState}) so
 * it doesn't flicker. Overlay is `pointer-events: none` so it never blocks
 * clicks.
 *
 * Exposes its current state to the parent via `onChange` so `ViewportFrame` can
 * enforce the priority rule (low light is lowest priority — when it's showing,
 * the no-face hint is suppressed... but here low light yields to no-face, so the
 * parent passes `suppressed` when a higher-priority hint is active).
 */
export function LowLightHint({
  suppressed = false,
  onChange,
}: {
  suppressed?: boolean
  onChange?: (low: boolean) => void
}) {
  const videoEl = useCameraStore((s) => s.videoEl)
  const status = useCameraStore((s) => s.status)
  const [low, setLow] = useState(false)

  useEffect(() => {
    if (!videoEl || status !== 'live') {
      setLow(false)
      return
    }
    let current = false
    const tick = () => {
      const b = sampleBrightness(videoEl)
      if (b === null) return
      const next = nextLowLightState(current, b)
      if (next !== current) {
        current = next
        setLow(next)
      }
    }
    tick()
    const id = window.setInterval(tick, LOW_LIGHT_SAMPLE_MS)
    return () => window.clearInterval(id)
  }, [videoEl, status])

  useEffect(() => {
    onChange?.(low)
  }, [low, onChange])

  const visible = low && !suppressed

  return (
    <div
      aria-hidden={!visible}
      className={`pointer-events-none absolute inset-x-0 bottom-4 z-10 flex justify-center transition-opacity duration-200 ease-out ${
        visible ? 'opacity-100' : 'opacity-0'
      }`}
    >
      <p className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink">
        It&apos;s too dark. Try better lighting.
      </p>
    </div>
  )
}
