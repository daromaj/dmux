/**
 * Pane Monitor mode — the periodic watchdog.
 *
 * Every N minutes it sweeps the panes with `monitor` enabled and, per pane:
 *   - if the agent has crashed back to a shell prompt, relaunches it (capped),
 *   - if the agent is idle but stalled mid-task, nudges it "continue" (capped),
 *   - if the agent finished (or the situation is ambiguous), stops monitoring
 *     that pane and fires a native notification.
 *
 * This file is the thin, fully-testable orchestrator: all IO (tmux, LLM,
 * notifications, persistence) is injected via `MonitorDeps`, and the risk
 * logic lives in the pure `decideMonitorAction` (see monitorPolicy.ts). The
 * real dependency wiring lives in `createPaneMonitorService` at the bottom.
 *
 * Distinct from the pre-existing `autopilot` feature (auto-accepting safe
 * option dialogs reactively, 1s poll); this is the slow crash/stall sweep.
 */

import { appendFile } from 'fs/promises';
import { join } from 'path';
import type { QmuxPane } from '../types.js';
import {
  decideMonitorAction,
  type MonitorCaps,
  type MonitorCapsState,
  type MonitorClassification,
  type MonitorNotifyReason,
} from '../utils/monitorPolicy.js';
import {
  isShellCommand,
  parseFinishedVerdict,
  FINISHED_JUDGE_SYSTEM_PROMPT,
} from '../utils/monitorClassify.js';
import type { PaneAnalyzer } from './PaneAnalyzer.js';
import type { TmuxService } from './TmuxService.js';
import type { QmuxFocusService } from './QmuxFocusService.js';
import { LogService } from './LogService.js';
import { capturePaneContentAsync } from '../utils/paneCapture.js';
import { callChatCompletion } from '../utils/aiClient.js';
import { buildAgentResumeOrLaunchCommand } from '../utils/agentLaunch.js';

/** One forensic record appended to `.qmux/monitor.jsonl` per tick. */
export interface MonitorLogEntry {
  paneId: string;
  paneName?: string;
  classification: MonitorClassification['kind'];
  action?: 'recover' | 'nudge';
  notify?: MonitorNotifyReason;
  stopped: boolean;
  reason: string;
}

/** Injected IO seam — everything the orchestrator needs to touch the world. */
export interface MonitorDeps {
  /** Current panes (the orchestrator filters for `monitor` itself). */
  getPanes: () => QmuxPane[];
  /** Configured caps, read fresh each tick so settings changes take effect. */
  getCaps: () => MonitorCaps;
  /** Classify a monitored pane this tick. */
  classify: (pane: QmuxPane, signal: AbortSignal) => Promise<MonitorClassification>;
  /** Relaunch a crashed agent (resume-or-launch in the pane). */
  recover: (pane: QmuxPane) => Promise<void>;
  /** Nudge a stalled agent to continue. */
  nudge: (pane: QmuxPane) => Promise<void>;
  /** Fire a user notification for this pane. */
  notify: (pane: QmuxPane, reason: MonitorNotifyReason) => Promise<void>;
  /** Turn off `monitor` for this pane and persist. */
  disableMonitor: (paneId: string) => Promise<void>;
  /** Append a forensic log entry (best-effort). */
  log: (entry: MonitorLogEntry) => void;
}

function freshCaps(): MonitorCapsState {
  return { relaunches: 0, nudges: 0 };
}

export class PaneMonitorService {
  private readonly caps = new Map<string, MonitorCapsState>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private abort = new AbortController();
  private running = false;
  private ticking = false;

  constructor(private readonly deps: MonitorDeps) {}

  /** Run the monitor decision + side effects for a single pane. */
  async runTickForPane(pane: QmuxPane): Promise<void> {
    const classification = await this.deps.classify(pane, this.abort.signal);
    const state = this.caps.get(pane.id) ?? freshCaps();
    const decision = decideMonitorAction(classification, state, this.deps.getCaps());

    if (decision.resetCaps) {
      this.caps.set(pane.id, freshCaps());
    }

    let action: 'recover' | 'nudge' | undefined;
    if (decision.send === 'recover') {
      await this.deps.recover(pane);
      this.bump(pane.id, 'relaunches');
      action = 'recover';
    } else if (decision.send === 'nudge') {
      await this.deps.nudge(pane);
      this.bump(pane.id, 'nudges');
      action = 'nudge';
    }

    if (decision.notify) {
      await this.deps.notify(pane, decision.notify);
    }

    this.deps.log({
      paneId: pane.id,
      classification: classification.kind,
      action,
      notify: decision.notify,
      stopped: decision.stopMonitoring,
      reason: decision.reason,
    });

    if (decision.stopMonitoring) {
      this.caps.delete(pane.id);
      await this.deps.disableMonitor(pane.id);
    }
  }

  /** Sweep every monitored pane once. A failure on one pane never aborts the rest. */
  async runTick(): Promise<void> {
    const monitored = this.deps.getPanes().filter((pane) => pane.monitor);
    const liveIds = new Set(monitored.map((p) => p.id));

    // Drop cap state for panes that are no longer monitored.
    for (const id of this.caps.keys()) {
      if (!liveIds.has(id)) {
        this.caps.delete(id);
      }
    }

    for (const pane of monitored) {
      try {
        await this.runTickForPane(pane);
      } catch (error) {
        this.deps.log({
          paneId: pane.id,
          classification: 'idle_ambiguous',
          stopped: false,
          reason: `monitor tick failed: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }
  }

  private bump(paneId: string, key: keyof MonitorCapsState): void {
    const state = this.caps.get(paneId) ?? freshCaps();
    this.caps.set(paneId, { ...state, [key]: state[key] + 1 });
  }

  /** Start the periodic sweep. `intervalMs` is re-read from `getIntervalMs` each tick. */
  start(getIntervalMs: () => number): void {
    if (this.running) return;
    this.running = true;
    if (this.abort.signal.aborted) {
      this.abort = new AbortController();
    }

    const scheduleNext = () => {
      if (!this.running) return;
      this.timer = setTimeout(async () => {
        if (!this.running) return;
        if (!this.ticking) {
          this.ticking = true;
          try {
            await this.runTick();
          } catch {
            // runTick already isolates per-pane failures; swallow anything left.
          } finally {
            this.ticking = false;
          }
        }
        scheduleNext();
      }, Math.max(1000, getIntervalMs()));
    };

    scheduleNext();
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    this.abort.abort();
    this.caps.clear();
  }
}

/* ------------------------------------------------------------------ *
 * Real dependency wiring
 * ------------------------------------------------------------------ */

const NUDGE_TEXT = 'continue';

export interface CreatePaneMonitorServiceOptions {
  projectRoot: string;
  analyzer: PaneAnalyzer;
  tmux: TmuxService;
  focusService: QmuxFocusService;
  getPanes: () => QmuxPane[];
  disableMonitor: (paneId: string) => Promise<void>;
  getCaps: () => MonitorCaps;
  notificationsEnabled: () => boolean;
}

/**
 * Wire the orchestrator to the real tmux/LLM/notification/persistence layers.
 */
export function createPaneMonitorService(
  options: CreatePaneMonitorServiceOptions
): PaneMonitorService {
  const logService = LogService.getInstance();
  const historyPath = join(options.projectRoot, '.qmux', 'monitor.jsonl');

  const classify = async (
    pane: QmuxPane,
    signal: AbortSignal
  ): Promise<MonitorClassification> => {
    // 1. Cheap pre-check: is the pane sitting at a bare shell (agent gone)?
    const currentCommand = await options.tmux.getPaneCurrentCommand(pane.paneId);
    if (isShellCommand(currentCommand)) {
      return { kind: 'shell' };
    }

    // 2. LLM classifier: working / option dialog / idle.
    const analysis = await options.analyzer.analyzePane(pane.paneId, signal, pane.id);
    if (analysis.state === 'in_progress') {
      return { kind: 'working' };
    }
    if (analysis.state === 'option_dialog') {
      return { kind: 'option_dialog' };
    }

    // 3. Idle: decide finished vs stalled with a second, focused judgment.
    const content = await capturePaneContentAsync(pane.paneId, 50);
    if (!content.trim()) {
      return { kind: 'idle_ambiguous' };
    }
    try {
      const reply = await callChatCompletion({
        messages: [
          { role: 'system', content: FINISHED_JUDGE_SYSTEM_PROMPT },
          { role: 'user', content: `Recent terminal output:\n\n${content}` },
        ],
        signal,
        temperature: 0,
        maxTokens: 8,
      });
      const verdict = parseFinishedVerdict(reply);
      if (verdict === 'finished') return { kind: 'idle_finished' };
      if (verdict === 'stalled') return { kind: 'idle_stalled' };
      return { kind: 'idle_ambiguous' };
    } catch (error) {
      logService.debug(
        `Monitor: finished-judge failed for ${pane.id}: ${error instanceof Error ? error.message : String(error)}`,
        'monitor',
        pane.id
      );
      return { kind: 'idle_ambiguous' };
    }
  };

  const recover = async (pane: QmuxPane): Promise<void> => {
    if (!pane.agent) {
      logService.warn(`Monitor: cannot recover "${pane.id}" — no agent recorded`, 'monitor', pane.id);
      return;
    }
    const command = buildAgentResumeOrLaunchCommand(pane.agent, pane.permissionMode);
    await options.tmux.sendShellCommand(pane.paneId, command);
    await options.tmux.sendTmuxKeys(pane.paneId, 'Enter');
    logService.info(`Monitor: relaunched agent in "${pane.id}" via \`${command}\``, 'monitor', pane.id);
  };

  const nudge = async (pane: QmuxPane): Promise<void> => {
    await options.tmux.sendShellCommand(pane.paneId, NUDGE_TEXT);
    await options.tmux.sendTmuxKeys(pane.paneId, 'Enter');
    logService.info(`Monitor: nudged stalled agent in "${pane.id}"`, 'monitor', pane.id);
  };

  const notify = async (pane: QmuxPane, reason: MonitorNotifyReason): Promise<void> => {
    if (!options.notificationsEnabled()) return;
    // Do not notify when the user is already looking at this pane.
    const surface = await options.focusService.getPaneAttentionSurface(pane.paneId);
    if (surface === 'fully-focused') return;

    const { title, body } = describeNotification(reason);
    await options.focusService.sendAttentionNotification({
      title,
      body,
      subtitle: pane.displayName || pane.slug,
      tmuxPaneId: pane.paneId,
    });
  };

  const log = (entry: MonitorLogEntry): void => {
    void appendFile(historyPath, `${JSON.stringify({ ...entry, ts: new Date().toISOString() })}\n`).catch(() => {
      // Best-effort forensic log; never throw from the monitor loop.
    });
  };

  return new PaneMonitorService({
    getPanes: options.getPanes,
    getCaps: options.getCaps,
    classify,
    recover,
    nudge,
    notify,
    disableMonitor: options.disableMonitor,
    log,
  });
}

function describeNotification(reason: MonitorNotifyReason): { title: string; body: string } {
  switch (reason) {
    case 'finished':
      return { title: 'Monitor: task finished', body: 'The agent finished its task. Monitoring stopped.' };
    case 'option_dialog':
      return { title: 'Monitor: decision needed', body: 'The agent is waiting on a yes/no prompt. Open the pane to choose.' };
    case 'cap_relaunch':
      return { title: 'Monitor: crash loop', body: 'The agent kept crashing. Gave up relaunching and stopped monitoring.' };
    case 'cap_nudge':
      return { title: 'Monitor: still stalled', body: 'The agent stayed stalled after repeated nudges. Stopped monitoring.' };
    case 'ambiguous':
      return { title: 'Monitor: needs a look', body: "Couldn't tell if the agent finished or stalled. Stopped monitoring to be safe." };
  }
}
