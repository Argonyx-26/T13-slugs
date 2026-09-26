/**
 * Recording time that only runs while recording: paused spans never count.
 * Built from clock deltas rather than counted ticks, so it never drifts.
 */
export class ElapsedClock {
  private accumulated = 0;
  private startedAt: number | null = null;

  constructor(private readonly now: () => number = () => performance.now()) {}

  start() {
    this.accumulated = 0;
    this.startedAt = this.now();
  }

  pause() {
    if (this.startedAt === null) return;
    this.accumulated += this.now() - this.startedAt;
    this.startedAt = null;
  }

  resume() {
    if (this.startedAt !== null) return;
    this.startedAt = this.now();
  }

  /** Stops the clock and returns the total recorded time. */
  stop(): number {
    this.pause();
    return this.accumulated;
  }

  reset() {
    this.accumulated = 0;
    this.startedAt = null;
  }

  elapsed(): number {
    return this.accumulated + (this.startedAt === null ? 0 : this.now() - this.startedAt);
  }
}
