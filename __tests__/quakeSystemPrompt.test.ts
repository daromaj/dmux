import { describe, it, expect } from 'vitest';
import { buildQuakeSystemPrompt } from '../src/utils/quakeSystemPrompt.js';
import type { QuakeWorkspaceContext } from '../src/utils/quakeTypes.js';

function baseCtx(overrides: Partial<QuakeWorkspaceContext> = {}): QuakeWorkspaceContext {
  return {
    sessionName: 'qmux-abc123',
    projectRoot: '/mnt/storage/git/qmux',
    gridColumns: 0,
    controlPanePosition: 'bottom',
    panes: [],
    ...overrides,
  };
}

describe('buildQuakeSystemPrompt', () => {
  it('includes session name, project root, and layout settings', () => {
    const ctx = baseCtx({ gridColumns: 2, controlPanePosition: 'left' });
    const prompt = buildQuakeSystemPrompt(ctx);

    expect(prompt).toContain('qmux-abc123');
    expect(prompt).toContain('/mnt/storage/git/qmux');
    expect(prompt).toContain('2');
    expect(prompt).toContain('left');
  });

  it('renders grid columns as "auto" when gridColumns is 0', () => {
    const ctx = baseCtx({ gridColumns: 0 });
    const prompt = buildQuakeSystemPrompt(ctx);

    expect(prompt).toContain('Grid columns: auto');
  });

  it('renders a provided pane with slug, paneId, and agent', () => {
    const ctx = baseCtx({
      panes: [
        {
          id: 'pane-1',
          slug: 'feature-login',
          paneId: '%4',
          agent: 'claude',
          worktreePath: '/path/wt',
          status: 'working',
        },
      ],
    });
    const prompt = buildQuakeSystemPrompt(ctx);

    expect(prompt).toContain('feature-login');
    expect(prompt).toContain('%4');
    expect(prompt).toContain('agent=claude');
    expect(prompt).toContain('worktree=/path/wt');
    expect(prompt).toContain('status=working');
  });

  it('falls back to shell/-/unknown for missing optional pane fields', () => {
    const ctx = baseCtx({
      panes: [
        {
          id: 'pane-2',
          slug: 'shell-pane',
          paneId: '%7',
        },
      ],
    });
    const prompt = buildQuakeSystemPrompt(ctx);

    expect(prompt).toContain('shell-pane');
    expect(prompt).toContain('%7');
    expect(prompt).toContain('agent=shell');
    expect(prompt).toContain('worktree=-');
    expect(prompt).toContain('status=unknown');
  });

  it('handles an empty panes list', () => {
    const ctx = baseCtx({ panes: [] });
    const prompt = buildQuakeSystemPrompt(ctx);

    expect(prompt).toContain('No content panes open.');
  });

  it('contains the key command protocol tokens', () => {
    const ctx = baseCtx();
    const prompt = buildQuakeSystemPrompt(ctx);

    expect(prompt).toContain('```run');
    expect(prompt).toContain('```qmux');
    expect(prompt).toContain('send-keys');
    expect(prompt).toContain('capture-pane');
  });

  it('contains the control-pane safety rule', () => {
    const ctx = baseCtx();
    const prompt = buildQuakeSystemPrompt(ctx);

    expect(prompt.toLowerCase()).toContain('never');
    expect(prompt.toLowerCase()).toContain('control pane');
  });
});
