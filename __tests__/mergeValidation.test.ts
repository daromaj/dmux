import { beforeEach, describe, expect, it, vi } from 'vitest';
import { execSync } from 'child_process';
import { getGitStatus } from '../src/utils/mergeValidation.js';

vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

describe('mergeValidation', () => {
  beforeEach(() => {
    vi.mocked(execSync).mockReset();
  });

  it('ignores qmux metadata directories when checking git status', () => {
    vi.mocked(execSync).mockReturnValue(
      '?? .qmux/\nM  .qmux/worktrees/feature-a\n'
    );

    const status = getGitStatus('/repo');

    expect(status).toEqual({
      hasChanges: false,
      files: [],
      summary: '',
    });
  });

  it('ignores untracked hook scaffolding but preserves real hook changes', () => {
    vi.mocked(execSync).mockReturnValue(
      [
        '?? .qmux-hooks/',
        '?? .qmux-hooks/AGENTS.md',
        '?? .qmux-hooks/examples/pre_merge.example',
        ' M .qmux-hooks/pre_merge',
        '?? .qmux-hooks/custom_hook',
      ].join('\n')
    );

    const status = getGitStatus('/repo');

    expect(status).toEqual({
      hasChanges: true,
      files: [
        '.qmux-hooks/pre_merge',
        '.qmux-hooks/custom_hook',
      ],
      summary: ' M .qmux-hooks/pre_merge\n?? .qmux-hooks/custom_hook',
    });
  });

  it('keeps non-qmux files in the dirty-state result', () => {
    vi.mocked(execSync).mockReturnValue(
      ' M src/index.ts\nM package.json\n'
    );

    const status = getGitStatus('/repo');

    expect(status).toEqual({
      hasChanges: true,
      files: ['src/index.ts', 'package.json'],
      summary: 'M src/index.ts\nM package.json',
    });
  });
});
