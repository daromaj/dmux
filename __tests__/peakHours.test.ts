import { describe, expect, it } from 'vitest';
import {
  getPeakInfo,
  formatMinutes,
  formatPeakBadge,
  APPROACHING_MINUTES,
} from '../src/utils/peakHours.js';

/** Build a Date at a given UTC hour/minute (date component is irrelevant). */
function utc(hour: number, minute = 0): Date {
  return new Date(Date.UTC(2026, 0, 1, hour, minute, 0));
}

describe('getPeakInfo', () => {
  it('reports peak inside the 01:00–04:00 window', () => {
    const info = getPeakInfo(utc(1, 30));
    expect(info.status).toBe('peak');
    // 04:00 - 01:30 = 150 minutes left
    expect(info.minutesUntilChange).toBe(150);
  });

  it('reports peak inside the 06:00–10:00 window', () => {
    const info = getPeakInfo(utc(9, 0));
    expect(info.status).toBe('peak');
    expect(info.minutesUntilChange).toBe(60);
  });

  it('treats the window start as peak (inclusive)', () => {
    expect(getPeakInfo(utc(1, 0)).status).toBe('peak');
    expect(getPeakInfo(utc(6, 0)).status).toBe('peak');
  });

  it('treats the window end as off-peak (exclusive)', () => {
    expect(getPeakInfo(utc(4, 0)).status).not.toBe('peak');
    expect(getPeakInfo(utc(10, 0)).status).not.toBe('peak');
  });

  it('reports approaching within the warning window before a peak', () => {
    // 00:30 is 30 min before the 01:00 peak
    const info = getPeakInfo(utc(0, 30));
    expect(info.status).toBe('approaching');
    expect(info.minutesUntilChange).toBe(30);
  });

  it('reports approaching exactly at the warning boundary', () => {
    // 05:00 is exactly APPROACHING_MINUTES (60) before the 06:00 peak
    const info = getPeakInfo(utc(6 - APPROACHING_MINUTES / 60, 0));
    expect(info.status).toBe('approaching');
    expect(info.minutesUntilChange).toBe(APPROACHING_MINUTES);
  });

  it('reports off-peak well outside any window', () => {
    const info = getPeakInfo(utc(12, 0));
    expect(info.status).toBe('off-peak');
    // Next peak start is 01:00 next day: 13h from 12:00 = 780 min
    expect(info.minutesUntilChange).toBe(780);
  });

  it('wraps past midnight when computing the next peak', () => {
    const info = getPeakInfo(utc(23, 30));
    expect(info.status).toBe('off-peak');
    // 01:00 next day is 90 minutes away
    expect(info.minutesUntilChange).toBe(90);
  });
});

describe('formatMinutes', () => {
  it('formats sub-hour values', () => {
    expect(formatMinutes(45)).toBe('45m');
    expect(formatMinutes(0)).toBe('0m');
  });

  it('formats whole hours', () => {
    expect(formatMinutes(60)).toBe('1h');
    expect(formatMinutes(120)).toBe('2h');
  });

  it('formats mixed hours and minutes', () => {
    expect(formatMinutes(90)).toBe('1h30m');
    expect(formatMinutes(150)).toBe('2h30m');
  });
});

describe('formatPeakBadge', () => {
  it('is red during peak', () => {
    const badge = formatPeakBadge(getPeakInfo(utc(2, 0)));
    expect(badge.color).toBe('red');
    expect(badge.text).toContain('PEAK');
  });

  it('is yellow when approaching', () => {
    const badge = formatPeakBadge(getPeakInfo(utc(0, 30)));
    expect(badge.color).toBe('yellow');
    expect(badge.text).toContain('peak in');
  });

  it('is green when off-peak', () => {
    const badge = formatPeakBadge(getPeakInfo(utc(12, 0)));
    expect(badge.color).toBe('green');
    expect(badge.text).toContain('off-peak');
  });
});
