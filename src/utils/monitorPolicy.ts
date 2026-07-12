/**
 * Pure decision core for Pane Monitor mode (the "monitor"/watchdog feature).
 *
 * Given a classification of a monitored pane plus the current cap-usage state,
 * decide what the monitor should do this tick. Kept side-effect-free so the
 * risk-bearing logic (when to relaunch, when to nudge, when to give up) is
 * fully unit-testable without tmux or an LLM in the loop.
 *
 * Distinct from the pre-existing `autopilot` feature (auto-accepting safe
 * option dialogs); this drives the periodic crash-recovery / stall-nudge sweep.
 */

/** Result of classifying a monitored pane on a single tick. */
export type MonitorClassification =
  /** Agent exited/crashed and the pane dropped back to a bare shell prompt. */
  | { kind: 'shell' }
  /** Agent is actively working (`in_progress`). */
  | { kind: 'working' }
  /** Agent is waiting on a genuine yes/no option dialog. */
  | { kind: 'option_dialog' }
  /** Agent is idle and has finished its task. */
  | { kind: 'idle_finished' }
  /** Agent is idle but paused mid-task (needs a nudge to continue). */
  | { kind: 'idle_stalled' }
  /** Agent is idle and it's unclear whether it finished or stalled. */
  | { kind: 'idle_ambiguous' };

/** Per-pane running cap usage. */
export interface MonitorCapsState {
  relaunches: number;
  nudges: number;
}

/** Configured caps (from settings). */
export interface MonitorCaps {
  maxRelaunches: number;
  maxNudges: number;
}

// --- Settings defaults + clamps (shared by settingsManager and PaneMonitorService) ---

export const DEFAULT_MONITOR_INTERVAL_MINUTES = 15;
export const MIN_MONITOR_INTERVAL_MINUTES = 1;
export const MAX_MONITOR_INTERVAL_MINUTES = 120;

export const DEFAULT_MONITOR_MAX_RELAUNCHES = 2;
export const DEFAULT_MONITOR_MAX_NUDGES = 3;
export const MIN_MONITOR_CAP = 1;
export const MAX_MONITOR_CAP = 20;

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.round(value)));
}

export function clampMonitorIntervalMinutes(value: unknown): number {
  return clampInt(
    value,
    MIN_MONITOR_INTERVAL_MINUTES,
    MAX_MONITOR_INTERVAL_MINUTES,
    DEFAULT_MONITOR_INTERVAL_MINUTES,
  );
}

export function clampMonitorMaxRelaunches(value: unknown): number {
  return clampInt(value, MIN_MONITOR_CAP, MAX_MONITOR_CAP, DEFAULT_MONITOR_MAX_RELAUNCHES);
}

export function clampMonitorMaxNudges(value: unknown): number {
  return clampInt(value, MIN_MONITOR_CAP, MAX_MONITOR_CAP, DEFAULT_MONITOR_MAX_NUDGES);
}

export type MonitorNotifyReason =
  | 'option_dialog'
  | 'finished'
  | 'cap_relaunch'
  | 'cap_nudge'
  | 'ambiguous';

export interface MonitorDecision {
  /** Action to send to the pane, if any. `recover` = relaunch agent, `nudge` = "continue". */
  send?: 'recover' | 'nudge';
  /** Disable monitoring on this pane after this tick. */
  stopMonitoring: boolean;
  /** Fire a user notification with this reason, if set. */
  notify?: MonitorNotifyReason;
  /** Reset the per-pane cap counters (agent is healthy/working again). */
  resetCaps?: boolean;
  /** Human-readable reason, for the forensic log. */
  reason: string;
}

/**
 * Decide the monitor action for a pane this tick. Pure function.
 *
 * Safety bias: never auto-answer a real yes/no dialog, never nudge when the
 * finished-vs-stalled call is ambiguous, and give up (stop + notify) once a cap
 * is hit rather than looping forever.
 */
export function decideMonitorAction(
  classification: MonitorClassification,
  caps: MonitorCapsState,
  limits: MonitorCaps,
): MonitorDecision {
  switch (classification.kind) {
    case 'shell':
      if (caps.relaunches >= limits.maxRelaunches) {
        return {
          stopMonitoring: true,
          notify: 'cap_relaunch',
          reason: `crash-loop guard: gave up after ${caps.relaunches} relaunch(es)`,
        };
      }
      return {
        send: 'recover',
        stopMonitoring: false,
        reason: 'agent dropped to shell; relaunching in continue mode',
      };

    case 'working':
      return {
        stopMonitoring: false,
        resetCaps: true,
        reason: 'agent working; no action',
      };

    case 'option_dialog':
      return {
        stopMonitoring: false,
        notify: 'option_dialog',
        reason: 'agent waiting on a yes/no prompt; notified (not auto-answered)',
      };

    case 'idle_finished':
      return {
        stopMonitoring: true,
        notify: 'finished',
        reason: 'agent finished its task; monitoring disabled',
      };

    case 'idle_stalled':
      if (caps.nudges >= limits.maxNudges) {
        return {
          stopMonitoring: true,
          notify: 'cap_nudge',
          reason: `still stalled after ${caps.nudges} nudge(s); gave up`,
        };
      }
      return {
        send: 'nudge',
        stopMonitoring: false,
        reason: 'agent stalled mid-task; nudging to continue',
      };

    case 'idle_ambiguous':
      return {
        stopMonitoring: true,
        notify: 'ambiguous',
        reason: 'unclear whether agent finished or stalled; stopping to be safe',
      };
  }
}
