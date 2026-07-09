/**
 * Peak-hours awareness for the quake assistant.
 *
 * Some LLM providers rate/price differently during fixed daily peak windows.
 * These are defined in UTC so the indicator is correct regardless of the host
 * timezone.
 *
 * Peak windows (UTC): 01:00–04:00 and 06:00–10:00.
 * Each window is [start, end) — start inclusive, end exclusive.
 */

export type PeakStatus = 'peak' | 'approaching' | 'off-peak';

/** Peak windows as [startHourUTC, endHourUTC) pairs. */
export const PEAK_WINDOWS_UTC: ReadonlyArray<readonly [number, number]> = [
  [1, 4],
  [6, 10],
];

/** How many minutes before a peak window we flag it as "approaching". */
export const APPROACHING_MINUTES = 60;

export interface PeakInfo {
  status: PeakStatus;
  /**
   * Minutes until the current window ends (status === 'peak') or until the next
   * window starts (status === 'approaching' | 'off-peak').
   */
  minutesUntilChange: number;
}

/** Classify the given moment against the UTC peak windows. */
export function getPeakInfo(now: Date): PeakInfo {
  const minutesOfDay = now.getUTCHours() * 60 + now.getUTCMinutes();

  // Inside a peak window?
  for (const [startHour, endHour] of PEAK_WINDOWS_UTC) {
    const start = startHour * 60;
    const end = endHour * 60;
    if (minutesOfDay >= start && minutesOfDay < end) {
      return { status: 'peak', minutesUntilChange: end - minutesOfDay };
    }
  }

  // Otherwise, minutes until the nearest upcoming peak start (wrapping midnight).
  let untilNext = Infinity;
  for (const [startHour] of PEAK_WINDOWS_UTC) {
    let delta = startHour * 60 - minutesOfDay;
    if (delta < 0) delta += 24 * 60;
    if (delta < untilNext) untilNext = delta;
  }

  const status: PeakStatus =
    untilNext <= APPROACHING_MINUTES ? 'approaching' : 'off-peak';
  return { status, minutesUntilChange: untilNext };
}

/** Format a minute count compactly, e.g. 90 → "1h30m", 45 → "45m". */
export function formatMinutes(total: number): string {
  const mins = Math.max(0, Math.round(total));
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h}h` : `${h}h${m}m`;
}

export interface PeakBadge {
  text: string;
  /** Ink/tmux color name for the badge. */
  color: string;
}

/** Build a compact colored badge for the quake overlay header. */
export function formatPeakBadge(info: PeakInfo): PeakBadge {
  switch (info.status) {
    case 'peak':
      return {
        text: `🔴 PEAK · ${formatMinutes(info.minutesUntilChange)} left`,
        color: 'red',
      };
    case 'approaching':
      return {
        text: `🟡 peak in ${formatMinutes(info.minutesUntilChange)}`,
        color: 'yellow',
      };
    default:
      return {
        text: `🟢 off-peak · ${formatMinutes(info.minutesUntilChange)} to peak`,
        color: 'green',
      };
  }
}
