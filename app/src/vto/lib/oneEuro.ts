/**
 * One-Euro filter — Casiez, Roussel & Vogel, CHI 2012.
 * "1€ Filter: A Simple Speed-based Low-pass Filter for Noisy Input in
 *  Interactive Systems." https://gery.casiez.net/1euro/
 *
 * A speed-adaptive low-pass filter: at low movement speed the cutoff
 * frequency is low (heavy smoothing → no jitter at rest), and as the signal
 * moves faster the cutoff rises (light smoothing → low lag while moving).
 * This beats plain exponential smoothing, which forces a single fixed
 * jitter-vs-lag tradeoff (see Story 05 AC3/AC5).
 *
 * We filter a head pose at ~30 FPS. Parameters (see DEFAULTS below) are tuned
 * for that: a low `minCutoff` removes resting jitter, a small `beta` restores
 * responsiveness on fast turns.
 */

/** Smoothing factor for a first-order low-pass given cutoff and sample period. */
function alpha(cutoff: number, dt: number): number {
  // tau = 1 / (2*pi*cutoff); a = 1 / (1 + tau/dt)
  const tau = 1 / (2 * Math.PI * cutoff)
  return 1 / (1 + tau / dt)
}

/** A single first-order low-pass with remembered previous value. */
class LowPass {
  private y = 0
  private initialised = false

  filter(x: number, a: number): number {
    if (!this.initialised) {
      this.y = x
      this.initialised = true
      return x
    }
    this.y = a * x + (1 - a) * this.y
    return this.y
  }

  get value(): number {
    return this.y
  }

  get hasValue(): boolean {
    return this.initialised
  }

  reset(): void {
    this.initialised = false
    this.y = 0
  }
}

export interface OneEuroParams {
  /** Minimum cutoff frequency (Hz). Lower = smoother at rest. */
  minCutoff: number
  /** Speed coefficient. Higher = less lag on fast motion. */
  beta: number
  /** Cutoff for the derivative low-pass (Hz). 1.0 is the canonical default. */
  dCutoff: number
}

/** Defaults tuned for 30 FPS head pose. See Q2 in handoff-05-to-dev.md. */
export const DEFAULTS: OneEuroParams = {
  minCutoff: 1.0,
  beta: 0.015,
  dCutoff: 1.0,
}

/** One-Euro filter for a single scalar channel. */
export class OneEuroFilter {
  private readonly x = new LowPass()
  private readonly dx = new LowPass()
  private lastTime: number | null = null

  constructor(private readonly p: OneEuroParams = DEFAULTS) {}

  /**
   * @param value the raw sample
   * @param timestampMs monotonic time in milliseconds (e.g. performance.now())
   */
  filter(value: number, timestampMs: number): number {
    let dt = 1 / 30 // sensible default before we have two samples
    if (this.lastTime != null) {
      const seconds = (timestampMs - this.lastTime) / 1000
      // Guard against a zero/negative/huge dt (paused tab, clock jumps).
      if (seconds > 1e-4 && seconds < 1) dt = seconds
    }
    this.lastTime = timestampMs

    // Estimate the rate of change, then low-pass it.
    const dValue = this.x.hasValue ? (value - this.x.value) / dt : 0
    const edValue = this.dx.filter(dValue, alpha(this.p.dCutoff, dt))

    // Speed-dependent cutoff.
    const cutoff = this.p.minCutoff + this.p.beta * Math.abs(edValue)
    return this.x.filter(value, alpha(cutoff, dt))
  }

  /**
   * Smoothed rate of change from the most recent {@link filter} call, in
   * value-units per second (the internal derivative low-pass). Zero until two
   * samples have been seen, and after {@link reset}. FaceMatrixSmoother reads
   * this to forward-predict the pose and cancel pipeline latency.
   */
  get velocity(): number {
    return this.dx.hasValue ? this.dx.value : 0
  }

  reset(): void {
    this.x.reset()
    this.dx.reset()
    this.lastTime = null
  }
}

/** A bank of one-Euro filters, one per channel of a fixed-length vector. */
export class OneEuroVector {
  private readonly filters: OneEuroFilter[]

  constructor(size: number, params: OneEuroParams = DEFAULTS) {
    this.filters = Array.from({ length: size }, () => new OneEuroFilter(params))
  }

  /** Filters `values` in place into `out` (length must match). */
  filter(values: number[], timestampMs: number, out: number[]): number[] {
    for (let i = 0; i < this.filters.length; i++) {
      // Non-null: constructed 1:1 with `filters`, callers pass matching length.
      out[i] = this.filters[i]!.filter(values[i] ?? 0, timestampMs)
    }
    return out
  }

  /** Smoothed per-channel velocity (value-units/sec) from the last filter() call. */
  velocity(i: number): number {
    return this.filters[i]?.velocity ?? 0
  }

  reset(): void {
    for (const f of this.filters) f.reset()
  }
}
