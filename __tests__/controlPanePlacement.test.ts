import { describe, it, expect } from 'vitest';
import {
  sanitizeControlPanePosition,
  clampControlPaneHeight,
  DEFAULT_CONTROL_PANE_HEIGHT,
  MIN_CONTROL_PANE_HEIGHT,
  MAX_CONTROL_PANE_HEIGHT,
} from '../src/utils/controlPanePlacement.js';

describe('sanitizeControlPanePosition', () => {
  it('accepts the two valid positions', () => {
    expect(sanitizeControlPanePosition('left')).toBe('left');
    expect(sanitizeControlPanePosition('bottom')).toBe('bottom');
  });

  it('defaults to left on anything else', () => {
    expect(sanitizeControlPanePosition('right')).toBe('left');
    expect(sanitizeControlPanePosition('')).toBe('left');
    expect(sanitizeControlPanePosition(undefined)).toBe('left');
    expect(sanitizeControlPanePosition(42)).toBe('left');
  });
});

describe('clampControlPaneHeight', () => {
  it('passes through in-range integers', () => {
    expect(clampControlPaneHeight(12)).toBe(12);
    expect(clampControlPaneHeight(MIN_CONTROL_PANE_HEIGHT)).toBe(MIN_CONTROL_PANE_HEIGHT);
    expect(clampControlPaneHeight(MAX_CONTROL_PANE_HEIGHT)).toBe(MAX_CONTROL_PANE_HEIGHT);
  });

  it('clamps out-of-range values into [MIN, MAX]', () => {
    expect(clampControlPaneHeight(1)).toBe(MIN_CONTROL_PANE_HEIGHT);
    expect(clampControlPaneHeight(999)).toBe(MAX_CONTROL_PANE_HEIGHT);
  });

  it('rounds fractional values', () => {
    expect(clampControlPaneHeight(12.4)).toBe(12);
    expect(clampControlPaneHeight(15.6)).toBe(16);
  });

  it('defaults on garbage input', () => {
    expect(clampControlPaneHeight(NaN)).toBe(DEFAULT_CONTROL_PANE_HEIGHT);
    expect(clampControlPaneHeight('12' as unknown)).toBe(DEFAULT_CONTROL_PANE_HEIGHT);
    expect(clampControlPaneHeight(undefined)).toBe(DEFAULT_CONTROL_PANE_HEIGHT);
  });
});
