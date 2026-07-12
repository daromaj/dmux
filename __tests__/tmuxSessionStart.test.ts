import { beforeEach, describe, expect, it, vi } from 'vitest';

const { spawnSyncMock } = vi.hoisted(() => ({
  spawnSyncMock: vi.fn(),
}));

vi.mock('child_process', () => ({
  spawnSync: spawnSyncMock,
}));

import {
  attachTmuxSession,
  startDetachedTmuxSession,
} from '../src/utils/tmuxSessionStart.js';

describe('tmux session startup', () => {
  beforeEach(() => {
    spawnSyncMock.mockReset();
  });

  it('starts qmux as the pane command instead of sending keys to a shell', () => {
    spawnSyncMock.mockReturnValue({ status: 0, stderr: '' });

    startDetachedTmuxSession({
      sessionName: 'qmux-demo',
      startDirectory: '/repo',
      command: "env PATH='/usr/local/bin' '/usr/local/bin/qmux'",
    });

    expect(spawnSyncMock).toHaveBeenCalledWith(
      'tmux',
      [
        'new-session',
        '-d',
        '-s',
        'qmux-demo',
        '-c',
        '/repo',
        "env PATH='/usr/local/bin' '/usr/local/bin/qmux'",
      ],
      {
        encoding: 'utf-8',
        stdio: 'pipe',
      }
    );
  });

  it('omits the pane command so tmux launches the default shell (--quick)', () => {
    spawnSyncMock.mockReturnValue({ status: 0, stderr: '' });

    startDetachedTmuxSession({
      sessionName: 'qmux-quick',
      startDirectory: '/repo',
      // no command → bare shell session
    });

    expect(spawnSyncMock).toHaveBeenCalledWith(
      'tmux',
      ['new-session', '-d', '-s', 'qmux-quick', '-c', '/repo'],
      {
        encoding: 'utf-8',
        stdio: 'pipe',
      }
    );
  });

  it('attaches to the target session through tmux arguments', () => {
    spawnSyncMock.mockReturnValue({ status: 0 });

    attachTmuxSession('qmux-demo');

    expect(spawnSyncMock).toHaveBeenCalledWith(
      'tmux',
      ['attach-session', '-t', 'qmux-demo'],
      { stdio: 'inherit' }
    );
  });

  it('throws when detached session startup fails', () => {
    spawnSyncMock.mockReturnValue({ status: 1, stderr: 'duplicate session' });

    expect(() => startDetachedTmuxSession({
      sessionName: 'qmux-demo',
      startDirectory: '/repo',
      command: 'qmux',
    })).toThrow('Failed to start tmux session qmux-demo: duplicate session');
  });
});
