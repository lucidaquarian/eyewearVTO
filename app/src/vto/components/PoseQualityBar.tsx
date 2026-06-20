import type { PoseState } from '@/vto/hooks/usePDMeasurement'

const LABEL: Record<PoseState, string> = {
  frontal: 'Good — hold still',
  'off-axis': 'Face the camera straight on',
  'no-face': 'No face detected',
}

// Token-driven fills — palette only (no off-palette accent colours, per
// DESIGN-PRINCIPLES "not branded"). success when frontal; the neutral `muted`
// (not an alarming colour) for the off-axis partial state; `border` when empty.
// The text label below carries the actual meaning for the off-axis case.
const FILL: Record<PoseState, string> = {
  frontal: 'bg-success',
  'off-axis': 'bg-muted',
  'no-face': 'bg-border',
}

const WIDTH: Record<PoseState, string> = {
  frontal: 'w-full',
  'off-axis': 'w-1/2',
  'no-face': 'w-0',
}

/**
 * 4px horizontal pose-quality indicator (Story 08 AC3).
 * Green + full when frontal (±5°), amber + half when off-axis, gray + empty
 * when no face is detected. The text below it is the accessible status.
 */
export function PoseQualityBar({ pose }: { pose: PoseState }) {
  return (
    <div>
      <div
        className="h-1 w-full overflow-hidden rounded-full bg-border"
        role="progressbar"
        aria-label="Head pose quality"
        aria-valuetext={LABEL[pose]}
      >
        <div
          className={`h-full rounded-full transition-all duration-150 ease-out ${FILL[pose]} ${WIDTH[pose]}`}
        />
      </div>
      <p className="mt-2 text-sm text-muted" aria-live="polite">
        {LABEL[pose]}
      </p>
    </div>
  )
}
