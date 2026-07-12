import { describe, expect, it } from 'vitest';
import {
  decideMonitorAction,
  clampMonitorIntervalMinutes,
  clampMonitorMaxRelaunches,
  clampMonitorMaxNudges,
  DEFAULT_MONITOR_INTERVAL_MINUTES,
  type MonitorClassification,
  type MonitorCaps,
  type MonitorCapsState,
} from '../src/utils/monitorPolicy.js';

const CAPS: MonitorCaps = { maxRelaunches: 2, maxNudges: 3 };
const FRESH: MonitorCapsState = { relaunches: 0, nudges: 0 };

function decide(
  classification: MonitorClassification,
  caps: Partial<MonitorCapsState> = {},
) {
  return decideMonitorAction(classification, { ...FRESH, ...caps }, CAPS);
}

describe('decideMonitorAction', () => {
  it('recovers a crashed agent sitting at a bare shell prompt', () => {
    const d = decide({ kind: 'shell' });
    expect(d.send).toBe('recover');
    expect(d.stopMonitoring).toBe(false);
  });

  it('stops and notifies once the relaunch cap is reached (crash loop)', () => {
    const d = decide({ kind: 'shell' }, { relaunches: 2 });
    expect(d.send).toBeUndefined();
    expect(d.stopMonitoring).toBe(true);
    expect(d.notify).toBe('cap_relaunch');
  });

  it('does nothing while the agent is working', () => {
    const d = decide({ kind: 'working' });
    expect(d.send).toBeUndefined();
    expect(d.stopMonitoring).toBe(false);
    expect(d.notify).toBeUndefined();
  });

  it('resets caps when the agent is observed working again', () => {
    const d = decideMonitorAction(
      { kind: 'working' },
      { relaunches: 2, nudges: 3 },
      CAPS,
    );
    expect(d.resetCaps).toBe(true);
  });

  it('notifies but never auto-answers a genuine yes/no dialog', () => {
    const d = decide({ kind: 'option_dialog' });
    expect(d.send).toBeUndefined();
    expect(d.stopMonitoring).toBe(false);
    expect(d.notify).toBe('option_dialog');
  });

  it('stops monitoring and notifies when the task is finished', () => {
    const d = decide({ kind: 'idle_finished' });
    expect(d.send).toBeUndefined();
    expect(d.stopMonitoring).toBe(true);
    expect(d.notify).toBe('finished');
  });

  it('nudges "continue" when the agent is idle but stalled mid-task', () => {
    const d = decide({ kind: 'idle_stalled' });
    expect(d.send).toBe('nudge');
    expect(d.stopMonitoring).toBe(false);
  });

  it('stops and notifies once the nudge cap is reached', () => {
    const d = decide({ kind: 'idle_stalled' }, { nudges: 3 });
    expect(d.send).toBeUndefined();
    expect(d.stopMonitoring).toBe(true);
    expect(d.notify).toBe('cap_nudge');
  });

  it('stops and notifies (never nudges) when finished-vs-stalled is ambiguous', () => {
    const d = decide({ kind: 'idle_ambiguous' });
    expect(d.send).toBeUndefined();
    expect(d.stopMonitoring).toBe(true);
    expect(d.notify).toBe('ambiguous');
  });
});

describe('monitor settings clamps', () => {
  it('clamps the interval into [1, 120] and defaults on garbage', () => {
    expect(clampMonitorIntervalMinutes(15)).toBe(15);
    expect(clampMonitorIntervalMinutes(0)).toBe(1);
    expect(clampMonitorIntervalMinutes(999)).toBe(120);
    expect(clampMonitorIntervalMinutes(2.6)).toBe(3);
    expect(clampMonitorIntervalMinutes('nope')).toBe(DEFAULT_MONITOR_INTERVAL_MINUTES);
    expect(clampMonitorIntervalMinutes(undefined)).toBe(DEFAULT_MONITOR_INTERVAL_MINUTES);
  });

  it('clamps caps into [1, 20]', () => {
    expect(clampMonitorMaxRelaunches(2)).toBe(2);
    expect(clampMonitorMaxRelaunches(0)).toBe(1);
    expect(clampMonitorMaxRelaunches(50)).toBe(20);
    expect(clampMonitorMaxNudges(3)).toBe(3);
    expect(clampMonitorMaxNudges(-4)).toBe(1);
  });
});
