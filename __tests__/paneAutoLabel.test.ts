import { describe, expect, it } from 'vitest';
import {
  computeShellPaneLabel,
  isShellCommand,
} from '../src/utils/paneAutoLabel.js';

describe('isShellCommand', () => {
  it('treats bare and login shells as shells', () => {
    for (const cmd of ['zsh', 'bash', '-zsh', 'FISH', ' sh ']) {
      expect(isShellCommand(cmd)).toBe(true);
    }
  });

  it('treats empty/undefined as a shell (idle)', () => {
    expect(isShellCommand(undefined)).toBe(true);
    expect(isShellCommand('')).toBe(true);
  });

  it('treats real tools as non-shell', () => {
    for (const cmd of ['nvim', 'node', 'psql', 'lazygit', 'htop']) {
      expect(isShellCommand(cmd)).toBe(false);
    }
  });
});

describe('computeShellPaneLabel', () => {
  it('prefers the active tool over branch and dir', () => {
    expect(
      computeShellPaneLabel({
        currentCommand: 'nvim',
        currentPath: '/home/me/dmux/src',
        branch: 'feat-x',
      })
    ).toBe('nvim');
  });

  it('falls back to git branch when the pane is an idle shell', () => {
    expect(
      computeShellPaneLabel({
        currentCommand: 'zsh',
        currentPath: '/home/me/dmux',
        branch: 'feature/labels',
      })
    ).toBe('labels'); // last segment of a slashed branch
  });

  it('falls back to the directory basename when there is no branch', () => {
    expect(
      computeShellPaneLabel({
        currentCommand: '-bash',
        currentPath: '/home/me/dmux/docs',
      })
    ).toBe('docs');
  });

  it('returns undefined when no signal is meaningful', () => {
    expect(computeShellPaneLabel({ currentCommand: 'zsh' })).toBeUndefined();
    expect(computeShellPaneLabel({})).toBeUndefined();
  });

  it('truncates overly long labels with an ellipsis', () => {
    const label = computeShellPaneLabel({
      currentCommand: 'zsh',
      currentPath: '/home/me/a-really-long-directory-name-that-overflows',
    });
    expect(label).toBeDefined();
    expect(label!.length).toBeLessThanOrEqual(24);
    expect(label!.endsWith('…')).toBe(true);
  });
});
