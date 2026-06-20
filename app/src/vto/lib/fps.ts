/**
 * Rolling FPS calculator backed by a ring buffer of frame timestamps.
 *
 * Feed it the monotonic `now` from `requestAnimationFrame` on every frame.
 * `value` is the average frames-per-second over the last `size` frames
 * (default 30), computed from the elapsed time between the oldest and newest
 * retained timestamps. Returns 0 until at least two frames have been recorded.
 */
export class FPS {
  private readonly size: number
  private readonly buffer: number[]
  private index = 0
  private count = 0

  constructor(size = 30) {
    this.size = size
    this.buffer = new Array<number>(size).fill(0)
  }

  /** Record a frame timestamp (the `now` argument from requestAnimationFrame). */
  tick(now: number): void {
    this.buffer[this.index] = now
    this.index = (this.index + 1) % this.size
    if (this.count < this.size) this.count += 1
  }

  /** Rolling average FPS over the retained window, or 0 if not enough data. */
  get value(): number {
    if (this.count < 2) return 0
    // Oldest retained sample index.
    const oldestIndex = this.count < this.size ? 0 : this.index
    const newestIndex = (this.index - 1 + this.size) % this.size
    const oldest = this.buffer[oldestIndex] ?? 0
    const newest = this.buffer[newestIndex] ?? 0
    const elapsed = newest - oldest
    if (elapsed <= 0) return 0
    // (count - 1) intervals over `elapsed` ms.
    return ((this.count - 1) * 1000) / elapsed
  }

  reset(): void {
    this.buffer.fill(0)
    this.index = 0
    this.count = 0
  }
}
