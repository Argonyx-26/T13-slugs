import { describe, expect, it } from 'vitest';
import { ElapsedClock } from './elapsed-clock';

function fakeClock() {
  let now = 0;
  const clock = new ElapsedClock(() => now);
  return { clock, at: (ms: number) => (now = ms) };
}

describe('ElapsedClock', () => {
  it('counts only the time spent recording, across several pauses', () => {
    const { clock, at } = fakeClock();
    clock.start();
    at(5_000);
    expect(clock.elapsed()).toBe(5_000);

    clock.pause();
    at(9_000); // 4 s paused
    expect(clock.elapsed()).toBe(5_000);

    clock.resume();
    at(12_000);
    expect(clock.elapsed()).toBe(8_000);

    clock.pause();
    at(60_000); // a long pause
    clock.resume();
    at(61_500);
    expect(clock.stop()).toBe(9_500);
    at(90_000);
    expect(clock.elapsed()).toBe(9_500); // stopped clocks stay put
  });

  it('ignores a second pause or resume', () => {
    const { clock, at } = fakeClock();
    clock.start();
    at(1_000);
    clock.pause();
    clock.pause();
    at(2_000);
    clock.resume();
    at(3_000);
    clock.resume();
    at(4_000);
    expect(clock.elapsed()).toBe(3_000);
  });

  it('starts again from zero, and resets to zero', () => {
    const { clock, at } = fakeClock();
    clock.start();
    at(4_000);
    clock.stop();
    at(10_000);
    clock.start();
    at(11_000);
    expect(clock.elapsed()).toBe(1_000);
    clock.reset();
    expect(clock.elapsed()).toBe(0);
  });
});
