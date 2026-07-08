import { describe, expect, it } from 'vitest';
import { computeScrollWindow } from '../src/utils/scrollWindow.js';

describe('computeScrollWindow', () => {
  it('returns the full list when it fits', () => {
    expect(computeScrollWindow(0, 5, 8)).toEqual({ start: 0, end: 5 });
    expect(computeScrollWindow(4, 5, 5)).toEqual({ start: 0, end: 5 });
  });

  it('keeps the window at the top for early selections', () => {
    // 31 items (the ~/git project-list case), window of 8.
    expect(computeScrollWindow(0, 31, 8)).toEqual({ start: 0, end: 8 });
    expect(computeScrollWindow(2, 31, 8)).toEqual({ start: 0, end: 8 });
  });

  it('centers the window around a mid-list selection', () => {
    // selected 15, half-window 4 -> start 11.
    expect(computeScrollWindow(15, 31, 8)).toEqual({ start: 11, end: 19 });
  });

  it('pins the window to the bottom for late selections', () => {
    // Selecting the last item must keep it visible, never scroll past the end.
    expect(computeScrollWindow(30, 31, 8)).toEqual({ start: 23, end: 31 });
    expect(computeScrollWindow(29, 31, 8)).toEqual({ start: 23, end: 31 });
  });

  it('always keeps the selected index inside the returned window', () => {
    const total = 31;
    for (let sel = 0; sel < total; sel++) {
      const { start, end } = computeScrollWindow(sel, total, 8);
      expect(sel).toBeGreaterThanOrEqual(start);
      expect(sel).toBeLessThan(end);
      expect(end - start).toBe(8);
    }
  });

  it('clamps out-of-range selection and degenerate maxVisible', () => {
    expect(computeScrollWindow(-5, 31, 8).start).toBe(0);
    expect(computeScrollWindow(999, 31, 8).end).toBe(31);
    // maxVisible of 0 collapses to a single-row window, still valid.
    const w = computeScrollWindow(10, 31, 0);
    expect(w.end - w.start).toBe(1);
    expect(w.start).toBe(10);
  });
});
