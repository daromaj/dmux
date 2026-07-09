import React from 'react';
import { describe, expect, it } from 'vitest';
import { render } from 'ink-testing-library';
import stripAnsi from 'strip-ansi';
import PaneCard from '../src/components/panes/PaneCard.js';
import { createWorktreePane } from './fixtures/mockPanes.js';

describe('PaneCard', () => {
  it('renders the registry short label for worktree agents', () => {
    const pane = createWorktreePane({
      slug: 'registry-tag',
      agent: 'codex',
    });

    const { lastFrame } = render(
      <PaneCard pane={pane} isDevSource={false} selected={false} />
    );

    expect(stripAnsi(lastFrame() ?? '')).toContain('[cx]');
    expect(stripAnsi(lastFrame() ?? '')).not.toContain('[oc]');
  });

  it('renders shell panes using the shell type abbreviation', () => {
    const pane = createWorktreePane({
      type: 'shell',
      shellType: 'zsh',
      agent: undefined,
    });

    const { lastFrame } = render(
      <PaneCard pane={pane} isDevSource={false} selected={false} />
    );

    expect(stripAnsi(lastFrame() ?? '')).toContain('[zs]');
  });

  it('renders file browser panes using the fb tag', () => {
    const pane = createWorktreePane({
      type: 'shell',
      shellType: 'fb',
      agent: undefined,
      browserPath: '/test/project/.qmux/worktrees/test-pane',
      worktreePath: undefined,
    });

    const { lastFrame } = render(
      <PaneCard pane={pane} isDevSource={false} selected={false} />
    );

    expect(stripAnsi(lastFrame() ?? '')).toContain('[fb]');
    expect(stripAnsi(lastFrame() ?? '')).toContain('');
  });

  it('wraps the selected pane name with » … « markers', () => {
    const pane = createWorktreePane({
      slug: 'selected-pane',
      displayName: 'Selected Pane',
    });

    const { lastFrame: selectedFrame } = render(
      <PaneCard pane={pane} isDevSource={false} selected={true} />
    );
    const selected = stripAnsi(selectedFrame() ?? '');
    expect(selected).toContain('»');
    expect(selected).toContain('«');

    const { lastFrame: unselectedFrame } = render(
      <PaneCard pane={pane} isDevSource={false} selected={false} />
    );
    const unselected = stripAnsi(unselectedFrame() ?? '');
    expect(unselected).not.toContain('»');
    expect(unselected).not.toContain('«');
  });

  it('renders an attention marker when a pane needs attention', () => {
    const pane = createWorktreePane({
      slug: 'attention-pane',
      displayName: 'Attention Pane',
      needsAttention: true,
    });

    const { lastFrame } = render(
      <PaneCard pane={pane} isDevSource={false} selected={false} />
    );

    expect(stripAnsi(lastFrame() ?? '')).toContain('! Attention Pane');
  });
});
