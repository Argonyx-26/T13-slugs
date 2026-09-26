import { describe, expect, it } from 'vitest';
import { ageSex, formatBytes, formatDuration } from './format';

describe('formatDuration', () => {
  it('shows minutes and seconds, rounding down', () => {
    expect(formatDuration(0)).toBe('00:00');
    expect(formatDuration(7_999)).toBe('00:07');
    expect(formatDuration(252_000)).toBe('04:12');
    expect(formatDuration(59 * 60_000 + 59_999)).toBe('59:59');
  });

  it('adds hours from one hour on', () => {
    expect(formatDuration(60 * 60_000)).toBe('1:00:00');
    expect(formatDuration(64 * 60_000 + 5_000)).toBe('1:04:05');
  });

  it('never goes negative', () => {
    expect(formatDuration(-500)).toBe('00:00');
  });
});

describe('ageSex', () => {
  it('joins whatever is known', () => {
    expect(ageSex(54, 'M')).toBe('54 · M');
    expect(ageSex(null, 'F')).toBe('F');
    expect(ageSex(null, null)).toBe('');
  });
});

describe('formatBytes', () => {
  it('uses KB below a megabyte, MB above', () => {
    expect(formatBytes(300)).toBe('1 KB');
    expect(formatBytes(512 * 1024)).toBe('512 KB');
    expect(formatBytes(5.4 * 1024 * 1024)).toBe('5.4 MB');
  });
});
