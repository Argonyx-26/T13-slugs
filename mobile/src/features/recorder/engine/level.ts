// Loudness for the waveform: RMS in dBFS, mapped so room noise sits near 0 and a raised
// voice near 1. The curve keeps ordinary speech in the middle of the column.

const FLOOR_DB = -58;
const CEIL_DB = -12;

export function levelFromRms(rms: number): number {
  if (!(rms > 0)) return 0;
  const db = 20 * Math.log10(rms);
  const t = Math.min(1, Math.max(0, (db - FLOOR_DB) / (CEIL_DB - FLOOR_DB)));
  return t ** 1.4;
}

/** One analyser frame of time-domain samples (-1..1) → 0..1 */
export function levelFromSamples(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return levelFromRms(Math.sqrt(sum / samples.length));
}

/** The newest loudness values, oldest first, for the scrolling waveform */
export class LevelHistory {
  private values: number[] = [];
  /** performance.now() of the newest value, for smooth scrolling between samples */
  lastPushAt = 0;

  constructor(readonly capacity = 512) {}

  push(level: number, at: number) {
    this.values.push(level);
    if (this.values.length > this.capacity) this.values.shift();
    this.lastPushAt = at;
  }

  clear() {
    this.values = [];
    this.lastPushAt = 0;
  }

  get length() {
    return this.values.length;
  }

  /** 0 = newest */
  fromNewest(index: number): number | undefined {
    return this.values[this.values.length - 1 - index];
  }
}
