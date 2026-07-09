import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { QmuxPane } from '../src/types.js';

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

    const pane: QmuxPane = {
      id: 'qmux-1',
      slug: 'feature-codex',
      prompt: 'fix the failing tests',
      paneId: '%2',
      worktreePath: '/repo/.qmux/worktrees/feature-codex',
      projectRoot: '/repo',
      agent: 'codex',
      permissionMode: 'bypassPermissions',
    };

    await recreateMissingPanes([pane], '/repo/.qmux/qmux.config.json');

    // Fresh launch: `codex ...`, NOT `codex resume --last ...`.
    expect(tmuxServiceMock.sendShellCommand).toHaveBeenCalledWith(
      '%9',
      expect.stringContaining(
        "export QMUX_PANE_ID='qmux-1'; export QMUX_TMUX_PANE_ID='%9'; codex --enable hooks --dangerously-bypass-approvals-and-sandbox"
      )
    );
    const lastCall = tmuxServiceMock.sendShellCommand.mock.calls.at(-1) as unknown[] | undefined;
    expect(String(lastCall?.[1])).not.toContain('resume --last');
    expect(tmuxServiceMock.sendTmuxKeys).toHaveBeenCalledWith('%9', 'Enter');
  });

  it('restores a shell pane as a fresh shell in its recorded directory (no agent)', async () => {
    const { recreateMissingPanes } = await import('../src/hooks/usePaneLoading.js');

    const pane: QmuxPane = {
      id: 'qmux-3',
      slug: 'shell-3',
      prompt: '',
      paneId: '%98',
      type: 'shell',
      shellType: 'zsh',
      projectRoot: '/repo',
    };

    await recreateMissingPanes([pane], '/repo/.qmux/qmux.config.json');

    // A new pane is split in the shell's recorded project directory.
    expect(splitPaneMock).toHaveBeenCalledWith({ cwd: '/repo' });
    // The pane record is rebound to the new live tmux id.
    expect(pane.paneId).toBe('%9');
    // No agent is launched for a shell pane.
    expect(tmuxServiceMock.sendShellCommand).not.toHaveBeenCalled();
  });
});

const pane = (over: Partial<QmuxPane>): QmuxPane => ({
  id: 'id',
  slug: 'slug',
  prompt: '',
  paneId: '%1',
  ...over,
}) as QmuxPane;

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

  it('continue mode keeps dead shells AND dead worktree panes for restore (drops nothing)', async () => {
    // `qmux -c` restores the previous session. Shell panes are recreated as fresh
    // shells, so they must NOT be dropped here — otherwise a shell-only session
    // (the common case) restores to nothing.
    const { selectStalePanesToDrop } = await import('../src/hooks/usePaneLoading.js');
    expect(selectStalePanesToDrop(panes, allPaneIds, true)).toEqual([]);
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

  it('recreates nothing without continue mode (default qmux start)', async () => {
    const { selectMissingPanesToRecreate } = await import('../src/hooks/usePaneLoading.js');
    expect(selectMissingPanesToRecreate(panes, allPaneIds, true, false)).toEqual([]);
  });

  it('recreates all missing panes including shells in continue mode', async () => {
    const { selectMissingPanesToRecreate } = await import('../src/hooks/usePaneLoading.js');
    expect(selectMissingPanesToRecreate(panes, allPaneIds, true, true)).toEqual([deadAgent, deadShell]);
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
