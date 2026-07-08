import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DmuxPane } from '../src/types.js';

const tmuxServiceMock = vi.hoisted(() => ({
  setPaneTitle: vi.fn(async () => {}),
  sendKeys: vi.fn(async () => {}),
  sendShellCommand: vi.fn(async () => {}),
  sendTmuxKeys: vi.fn(async () => {}),
  selectLayout: vi.fn(async () => {}),
  refreshClient: vi.fn(async () => {}),
}));

const splitPaneMock = vi.hoisted(() => vi.fn(() => '%9'));

vi.mock('../src/services/TmuxService.js', () => ({
  TmuxService: {
    getInstance: vi.fn(() => tmuxServiceMock),
  },
}));

vi.mock('../src/utils/tmux.js', () => ({
  splitPane: splitPaneMock,
}));

vi.mock('../src/utils/geminiTrust.js', () => ({
  ensureGeminiFolderTrusted: vi.fn(),
}));

describe('pane restoration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    splitPaneMock.mockReturnValue('%9');
  });

  it('restores worktree panes with a FRESH agent session (no resume)', async () => {
    const { recreateMissingPanes } = await import('../src/hooks/usePaneLoading.js');

    const pane: DmuxPane = {
      id: 'dmux-1',
      slug: 'feature-codex',
      prompt: 'fix the failing tests',
      paneId: '%2',
      worktreePath: '/repo/.dmux/worktrees/feature-codex',
      projectRoot: '/repo',
      agent: 'codex',
      permissionMode: 'bypassPermissions',
    };

    await recreateMissingPanes([pane], '/repo/.dmux/dmux.config.json');

    // Fresh launch: `codex ...`, NOT `codex resume --last ...`.
    expect(tmuxServiceMock.sendShellCommand).toHaveBeenCalledWith(
      '%9',
      expect.stringContaining(
        "export DMUX_PANE_ID='dmux-1'; export DMUX_TMUX_PANE_ID='%9'; codex --enable hooks --dangerously-bypass-approvals-and-sandbox"
      )
    );
    const lastCall = tmuxServiceMock.sendShellCommand.mock.calls.at(-1) as unknown[] | undefined;
    expect(String(lastCall?.[1])).not.toContain('resume --last');
    expect(tmuxServiceMock.sendTmuxKeys).toHaveBeenCalledWith('%9', 'Enter');
  });
});

const pane = (over: Partial<DmuxPane>): DmuxPane => ({
  id: 'id',
  slug: 'slug',
  prompt: '',
  paneId: '%1',
  ...over,
}) as DmuxPane;

describe('shouldContinueSession', () => {
  it('is false for a plain launch', async () => {
    const { shouldContinueSession } = await import('../src/hooks/usePaneLoading.js');
    expect(shouldContinueSession([])).toBe(false);
    expect(shouldContinueSession(['--files-only'])).toBe(false);
  });

  it('is true for -c and --continue', async () => {
    const { shouldContinueSession } = await import('../src/hooks/usePaneLoading.js');
    expect(shouldContinueSession(['-c'])).toBe(true);
    expect(shouldContinueSession(['--continue'])).toBe(true);
    expect(shouldContinueSession(['--dev', '-c'])).toBe(true);
  });
});

describe('selectStalePanesToDrop', () => {
  const live = pane({ id: 'a', paneId: '%1', agent: 'claude' });
  const deadAgent = pane({ id: 'b', paneId: '%99', agent: 'claude', worktreePath: '/wt/b' });
  const deadShell = pane({ id: 'c', paneId: '%98', type: 'shell' });
  const panes = [live, deadAgent, deadShell];
  const allPaneIds = ['%1'];

  it('fresh start drops every non-live pane (so it cannot be reloaded/recreated)', async () => {
    const { selectStalePanesToDrop } = await import('../src/hooks/usePaneLoading.js');
    expect(selectStalePanesToDrop(panes, allPaneIds, false)).toEqual([deadAgent, deadShell]);
  });

  it('continue mode drops only dead shells, keeps dead worktree panes for restore', async () => {
    const { selectStalePanesToDrop } = await import('../src/hooks/usePaneLoading.js');
    expect(selectStalePanesToDrop(panes, allPaneIds, true)).toEqual([deadShell]);
  });

  it('never drops a live pane', async () => {
    const { selectStalePanesToDrop } = await import('../src/hooks/usePaneLoading.js');
    expect(selectStalePanesToDrop(panes, allPaneIds, false)).not.toContain(live);
    expect(selectStalePanesToDrop(panes, allPaneIds, true)).not.toContain(live);
  });
});

describe('selectMissingPanesToRecreate', () => {
  const live = pane({ id: 'a', paneId: '%1', agent: 'claude' });
  const deadAgent = pane({ id: 'b', paneId: '%99', agent: 'claude' });
  const deadShell = pane({ id: 'c', paneId: '%98', type: 'shell' });
  const panes = [live, deadAgent, deadShell];
  const allPaneIds = ['%1'];

  it('recreates nothing without continue mode (default dmux start)', async () => {
    const { selectMissingPanesToRecreate } = await import('../src/hooks/usePaneLoading.js');
    expect(selectMissingPanesToRecreate(panes, allPaneIds, true, false)).toEqual([]);
  });

  it('recreates only missing non-shell panes in continue mode', async () => {
    const { selectMissingPanesToRecreate } = await import('../src/hooks/usePaneLoading.js');
    expect(selectMissingPanesToRecreate(panes, allPaneIds, true, true)).toEqual([deadAgent]);
  });

  it('recreates nothing when not the initial load', async () => {
    const { selectMissingPanesToRecreate } = await import('../src/hooks/usePaneLoading.js');
    expect(selectMissingPanesToRecreate(panes, allPaneIds, false, true)).toEqual([]);
  });

  it('recreates nothing when tmux reports no panes yet', async () => {
    const { selectMissingPanesToRecreate } = await import('../src/hooks/usePaneLoading.js');
    expect(selectMissingPanesToRecreate(panes, [], true, true)).toEqual([]);
  });
});
