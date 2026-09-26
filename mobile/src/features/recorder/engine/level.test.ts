import { describe, expect, it } from 'vitest';
import { LevelHistory, levelFromRms, levelFromSamples } from './level';

describe('levelFromRms', () => {
  it('maps silence to 0 and a loud signal to 1', () => {
    expect(levelFromRms(0)).toBe(0);
    expect(levelFromRms(Number.NaN)).toBe(0);
    expect(levelFromRms(0.0005)).toBe(0); // about -66 dBFS: room noise
    expect(levelFromRms(0.5)).toBe(1); // about -6 dBFS
  });

  it('rises with loudness and stays in 0..1', () => {
    const levels = [0.001, 0.003, 0.01, 0.03, 0.1, 0.3].map(levelFromRms);
    for (let i = 1; i < levels.length; i++) expect(levels[i]).toBeGreaterThan(levels[i - 1]);
    for (const level of levels) {
      expect(level).toBeGreaterThanOrEqual(0);
      expect(level).toBeLessThanOrEqual(1);
    }
  });
});

describe('levelFromSamples', () => {
  it('uses the RMS of the frame', () => {
    const square = Float32Array.from({ length: 256 }, (_, i) => (i % 2 ? 0.1 : -0.1));
    expect(levelFromSamples(square)).toBeCloseTo(levelFromRms(0.1), 6); // 0.1 is stored as float32
    expect(levelFromSamples(new Float32Array(0))).toBe(0);
  });
});

describe('LevelHistory', () => {
  it('keeps the newest values up to its capacity', () => {
    const history = new LevelHistory(3);
    [0.1, 0.2, 0.3, 0.4].forEach((v, i) => history.push(v, i * 100));
    expect(history.length).toBe(3);
    expect(history.fromNewest(0)).toBe(0.4);
    expect(history.fromNewest(2)).toBe(0.2);
    expect(history.fromNewest(3)).toBeUndefined();
    expect(history.lastPushAt).toBe(300);
    history.clear();
    expect(history.length).toBe(0);
  });
});
