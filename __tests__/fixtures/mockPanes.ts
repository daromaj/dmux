/**
 * Mock QmuxPane fixtures for testing
 */

import type { QmuxPane } from '../../src/types.js';

export function createMockPane(overrides?: Partial<QmuxPane>): QmuxPane {
  return {
    id: 'qmux-1',
    slug: 'test-pane',
    prompt: 'test prompt',
    paneId: '%42',
    worktreePath: '/test/worktree/path',
    agent: 'claude',
    type: 'worktree',
    autopilot: false,
    ...overrides,
  };
}

export function createShellPane(overrides?: Partial<QmuxPane>): QmuxPane {
  return createMockPane({
    type: 'shell',
    worktreePath: undefined,
    ...overrides,
  });
}

export function createWorktreePane(overrides?: Partial<QmuxPane>): QmuxPane {
  return createMockPane({
    type: 'worktree',
    worktreePath: '/test/project/.qmux/worktrees/test-pane',
    ...overrides,
  });
}

export function createMultiplePanes(count: number): QmuxPane[] {
  return Array.from({ length: count }, (_, i) => createMockPane({
    id: `qmux-${i + 1}`,
    slug: `test-pane-${i + 1}`,
    paneId: `%${40 + i}`,
  }));
}
