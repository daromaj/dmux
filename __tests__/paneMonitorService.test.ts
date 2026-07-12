import { describe, expect, it, beforeEach } from 'vitest';
import { PaneMonitorService, type MonitorDeps, type MonitorLogEntry } from '../src/services/PaneMonitorService.js';
import type { MonitorClassification } from '../src/utils/monitorPolicy.js';
import type { QmuxPane } from '../src/types.js';

function makePane(overrides: Partial<QmuxPane> = {}): QmuxPane {
  return {
    id: 'pane-1',
    slug: 'feature',
    prompt: 'do the thing',
    paneId: '%1',
    agent: 'claude',
    monitor: true,
    ...overrides,
  } as QmuxPane;
}

interface Harness {
  service: PaneMonitorService;
  calls: {
    recover: string[];
    nudge: string[];
    notify: Array<{ paneId: string; reason: string }>;
    disabled: string[];
    logs: MonitorLogEntry[];
  };
  setClassification: (c: MonitorClassification) => void;
  setPanes: (panes: QmuxPane[]) => void;
}

function harness(initial: MonitorClassification): Harness {
  let classification = initial;
  let panes: QmuxPane[] = [makePane()];
  const calls = {
    recover: [] as string[],
    nudge: [] as string[],
    notify: [] as Array<{ paneId: string; reason: string }>,
    disabled: [] as string[],
    logs: [] as MonitorLogEntry[],
  };
  const deps: MonitorDeps = {
    getPanes: () => panes,
    getCaps: () => ({ maxRelaunches: 2, maxNudges: 3 }),
    classify: async () => classification,
    recover: async (pane) => { calls.recover.push(pane.id); },
    nudge: async (pane) => { calls.nudge.push(pane.id); },
    notify: async (pane, reason) => { calls.notify.push({ paneId: pane.id, reason }); },
    disableMonitor: async (paneId) => {
      calls.disabled.push(paneId);
      panes = panes.map((p) => (p.id === paneId ? { ...p, monitor: false } : p));
    },
    log: (entry) => { calls.logs.push(entry); },
  };
  return {
    service: new PaneMonitorService(deps),
    calls,
    setClassification: (c) => { classification = c; },
    setPanes: (p) => { panes = p; },
  };
}

describe('PaneMonitorService.runTickForPane', () => {
  let h: Harness;
  beforeEach(() => { h = harness({ kind: 'working' }); });

  it('recovers a crashed agent and does not stop monitoring', async () => {
    h.setClassification({ kind: 'shell' });
    await h.service.runTickForPane(makePane());
    expect(h.calls.recover).toEqual(['pane-1']);
    expect(h.calls.disabled).toEqual([]);
  });

  it('gives up after the relaunch cap and disables monitoring', async () => {
    h.setClassification({ kind: 'shell' });
    // 2 relaunches allowed, then the 3rd tick should give up.
    await h.service.runTickForPane(makePane());
    await h.service.runTickForPane(makePane());
    await h.service.runTickForPane(makePane());
    expect(h.calls.recover).toHaveLength(2);
    expect(h.calls.disabled).toEqual(['pane-1']);
    expect(h.calls.notify.at(-1)?.reason).toBe('cap_relaunch');
  });

  it('nudges a stalled agent, then gives up at the nudge cap', async () => {
    h.setClassification({ kind: 'idle_stalled' });
    await h.service.runTickForPane(makePane());
    await h.service.runTickForPane(makePane());
    await h.service.runTickForPane(makePane());
    await h.service.runTickForPane(makePane());
    expect(h.calls.nudge).toHaveLength(3);
    expect(h.calls.disabled).toEqual(['pane-1']);
    expect(h.calls.notify.at(-1)?.reason).toBe('cap_nudge');
  });

  it('resets caps once the agent is seen working again', async () => {
    h.setClassification({ kind: 'shell' });
    await h.service.runTickForPane(makePane()); // relaunch #1
    h.setClassification({ kind: 'working' });
    await h.service.runTickForPane(makePane()); // reset
    h.setClassification({ kind: 'shell' });
    await h.service.runTickForPane(makePane()); // relaunch #2 (counter reset -> still recovers)
    await h.service.runTickForPane(makePane()); // relaunch #3
    expect(h.calls.recover).toHaveLength(3);
    expect(h.calls.disabled).toEqual([]);
  });

  it('stops and notifies when the task is finished', async () => {
    h.setClassification({ kind: 'idle_finished' });
    await h.service.runTickForPane(makePane());
    expect(h.calls.disabled).toEqual(['pane-1']);
    expect(h.calls.notify).toEqual([{ paneId: 'pane-1', reason: 'finished' }]);
    expect(h.calls.recover).toEqual([]);
    expect(h.calls.nudge).toEqual([]);
  });

  it('notifies but never auto-answers an option dialog', async () => {
    h.setClassification({ kind: 'option_dialog' });
    await h.service.runTickForPane(makePane());
    expect(h.calls.notify).toEqual([{ paneId: 'pane-1', reason: 'option_dialog' }]);
    expect(h.calls.disabled).toEqual([]);
    expect(h.calls.recover).toEqual([]);
  });

  it('logs every tick', async () => {
    h.setClassification({ kind: 'working' });
    await h.service.runTickForPane(makePane());
    expect(h.calls.logs).toHaveLength(1);
    expect(h.calls.logs[0]).toMatchObject({ paneId: 'pane-1', classification: 'working' });
  });
});

describe('PaneMonitorService.runTick', () => {
  it('only processes panes with monitor enabled', async () => {
    const h = harness({ kind: 'shell' });
    h.setPanes([
      makePane({ id: 'a', monitor: true }),
      makePane({ id: 'b', monitor: false }),
    ]);
    await h.service.runTick();
    expect(h.calls.recover).toEqual(['a']);
  });

  it('isolates a failing pane so others still run', async () => {
    const h = harness({ kind: 'shell' });
    h.setPanes([makePane({ id: 'a' }), makePane({ id: 'b' })]);
    // Make classify throw for pane 'a' only.
    (h.service as unknown as { deps: MonitorDeps }).deps.classify = async (pane) => {
      if (pane.id === 'a') throw new Error('boom');
      return { kind: 'shell' };
    };
    await h.service.runTick();
    expect(h.calls.recover).toEqual(['b']);
  });
});
