import type { PDResult as PDResultData } from '@/vto/lib/pd'

/**
 * The finished PD readout (Story 08 AC4, AC5).
 *
 * Disclaimer hygiene: the word "estimate" is ALWAYS shown beside the number,
 * the disclaimer line is always rendered, and this is never presented as a
 * medical / "prescription" measurement.
 */
export function PDResult({ result }: { result: PDResultData }) {
  const pd = Math.round(result.mean)
  const low = result.low.toFixed(1)
  const high = result.high.toFixed(1)

  return (
    <div>
      <p className="flex items-baseline gap-2">
        <span className="text-display font-bold tracking-tight text-ink">
          {pd}
        </span>
        <span className="text-base text-muted">mm (estimate)</span>
      </p>
      <p className="mt-2 text-xs text-muted">
        Approximate range: {low}–{high} mm.
      </p>
      <p className="mt-1 text-xs text-muted">
        Approximate. Confirm with your optometrist.
      </p>
    </div>
  )
}
