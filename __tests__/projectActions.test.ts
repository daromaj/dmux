import { describe, expect, it } from 'vitest';
import type { QmuxPane, SidebarProject } from '../src/types.js';
import {
  buildProjectActionLayout,
  buildVisualNavigationRows,
  buildHorizontalNavigationRows,
  getStripActionItems,
  resolveSelectionAfterPaneClose,
} from '../src/utils/projectActions.js';

function pane(id: string, slug: string, projectRoot: string): QmuxPane {
  return {
    id,
    slug,
    prompt: `prompt-${slug}`,
    paneId: `%${id.replace('qmux-', '')}`,
    projectRoot,
  };
}

describe('projectActions', () => {
  it('adds remove-project only for empty non-root sidebar projects', () => {
    const panes: QmuxPane[] = [
      pane('qmux-1', 'main-pane', '/repo-main'),
      pane('qmux-2', 'aux-pane', '/repo-aux'),
    ];
    const sidebarProjects: SidebarProject[] = [
      { projectRoot: '/repo-main', projectName: 'repo-main' },
      { projectRoot: '/repo-empty', projectName: 'repo-empty' },
      { projectRoot: '/repo-aux', projectName: 'repo-aux' },
    ];

    const layout = buildProjectActionLayout(
      panes,
      sidebarProjects,
      '/repo-main',
      'repo-main'
    );

    expect(layout.multiProjectMode).toBe(true);
    expect(
      layout.actionItems
        .filter((action) => action.kind === 'remove-project')
        .map((action) => action.projectRoot)
    ).toEqual(['/repo-empty']);
  });

  it('does not promote to multi-project mode for a phantom empty fallback project', () => {
    // Repro of "new project creates two control entries": opening a terminal in
    // a *different* project than the session root must not spawn a phantom
    // header + action row for the (empty, unpinned) fallback project.
    const panes: QmuxPane[] = [pane('qmux-1', 'other-pane', '/repo-other')];
    const layout = buildProjectActionLayout(panes, [], '/repo-main', 'repo-main');

    expect(layout.multiProjectMode).toBe(false);
    expect(layout.groups.map((g) => g.projectRoot)).toEqual(['/repo-other']);
    // Single shared action row: terminal, project, new-agent.
    expect(layout.actionItems.map((a) => a.kind)).toEqual([
      'terminal',
      'project',
      'new-agent',
    ]);
  });

  it('keeps the empty fallback group when it is explicitly pinned', () => {
    // A deliberately pinned home project should still show, even with no panes.
    const panes: QmuxPane[] = [pane('qmux-1', 'other-pane', '/repo-other')];
    const layout = buildProjectActionLayout(
      panes,
      [{ projectRoot: '/repo-main', projectName: 'repo-main' }],
      '/repo-main',
      'repo-main'
    );

    expect(layout.multiProjectMode).toBe(true);
    expect(layout.groups.map((g) => g.projectRoot).sort()).toEqual([
      '/repo-main',
      '/repo-other',
    ]);
  });

  it('adds action rows to navigation for empty projects', () => {
    const layout = buildProjectActionLayout(
      [],
      [
        { projectRoot: '/repo-main', projectName: 'repo-main' },
        { projectRoot: '/repo-empty', projectName: 'repo-empty' },
      ],
      '/repo-main',
      'repo-main'
    );

    expect(buildVisualNavigationRows(layout)).toEqual([
      [0, 1],
      [2, 3, 4],
    ]);
  });

  it('chunks panes into rows of N for the horizontal (bottom) layout', () => {
    const panes: QmuxPane[] = [
      pane('qmux-1', 'p1', '/repo'),
      pane('qmux-2', 'p2', '/repo'),
      pane('qmux-3', 'p3', '/repo'),
      pane('qmux-4', 'p4', '/repo'),
      pane('qmux-5', 'p5', '/repo'),
    ];
    const layout = buildProjectActionLayout(panes, [], '/repo', 'repo');

    // 5 panes chunked by 2 → [[0,1],[2,3],[4]], then the terminal/project/agent row.
    expect(buildHorizontalNavigationRows(layout, 2)).toEqual([
      [0, 1],
      [2, 3],
      [4],
      [5, 6, 7],
    ]);

    // Single column degrades to one pane per row.
    expect(buildHorizontalNavigationRows(layout, 1)).toEqual([
      [0],
      [1],
      [2],
      [3],
      [4],
      [5, 6, 7],
    ]);
  });

  it('collapses per-project action hints to one pair in the horizontal strip', () => {
    const panes: QmuxPane[] = [
      pane('qmux-1', 'main-pane', '/repo-main'),
      pane('qmux-2', 'aux-pane', '/repo-aux'),
    ];
    const sidebarProjects: SidebarProject[] = [
      { projectRoot: '/repo-main', projectName: 'repo-main' },
      { projectRoot: '/repo-aux', projectName: 'repo-aux' },
    ];
    const layout = buildProjectActionLayout(
      panes,
      sidebarProjects,
      '/repo-main',
      'repo-main'
    );

    expect(layout.multiProjectMode).toBe(true);
    // Two groups each emit a terminal + new-agent pair (4 raw action items)…
    expect(
      layout.actionItems.filter(
        (a) => a.kind === 'terminal' || a.kind === 'new-agent'
      )
    ).toHaveLength(4);
    // …but the strip shows each kind once, in first-seen order.
    expect(getStripActionItems(layout).map((a) => a.kind)).toEqual([
      'terminal',
      'new-agent',
    ]);
    // The horizontal nav action row matches the deduped render exactly.
    const stripIndices = getStripActionItems(layout).map((a) => a.index);
    const navRows = buildHorizontalNavigationRows(layout, 4);
    expect(navRows[navRows.length - 1]).toEqual(stripIndices);
  });

  it('emits only the action row when there are no panes (horizontal layout)', () => {
    const layout = buildProjectActionLayout([], [], '/repo', 'repo');
    // terminal (0), project (1), new-agent (2)
    expect(buildHorizontalNavigationRows(layout, 3)).toEqual([[0, 1, 2]]);
  });

  it('orders single-project action cards as terminal, project, new-agent', () => {
    const layout = buildProjectActionLayout([], [], '/repo', 'repo');
    expect(layout.actionItems.map((a) => a.kind)).toEqual([
      'terminal',
      'project',
      'new-agent',
    ]);
    // terminal is the first (default) action at index === panes.length
    expect(layout.actionItems[0]).toMatchObject({ index: 0, kind: 'terminal', hotkey: 't' });
    expect(layout.actionItems[1]).toMatchObject({ index: 1, kind: 'project', hotkey: 'p' });
  });

  it('selects the next pane down in the same project after closing a pane', () => {
    const panes: QmuxPane[] = [
      pane('qmux-1', 'main-pane', '/repo-main'),
      pane('qmux-2', 'aux-one', '/repo-aux'),
      pane('qmux-3', 'aux-two', '/repo-aux'),
      pane('qmux-4', 'main-two', '/repo-main'),
    ];
    const sidebarProjects: SidebarProject[] = [
      { projectRoot: '/repo-main', projectName: 'repo-main' },
      { projectRoot: '/repo-aux', projectName: 'repo-aux' },
    ];

    const selection = resolveSelectionAfterPaneClose(
      panes,
      '%2',
      sidebarProjects,
      '/repo-main',
      'repo-main'
    );

    expect(selection?.selectedIndex).toBe(1);
    expect(selection?.pane?.slug).toBe('aux-two');
  });

  it('selects the project terminal action when closing the last pane in that project', () => {
    const panes: QmuxPane[] = [
      pane('qmux-1', 'main-pane', '/repo-main'),
      pane('qmux-2', 'aux-one', '/repo-aux'),
    ];
    const sidebarProjects: SidebarProject[] = [
      { projectRoot: '/repo-main', projectName: 'repo-main' },
      { projectRoot: '/repo-aux', projectName: 'repo-aux' },
    ];

    const selection = resolveSelectionAfterPaneClose(
      panes,
      '%2',
      sidebarProjects,
      '/repo-main',
      'repo-main'
    );

    expect(selection?.pane).toBeUndefined();
    expect(selection?.action?.kind).toBe('terminal');
    expect(selection?.action?.projectRoot).toBe('/repo-aux');
    expect(selection?.selectedIndex).toBe(3);
  });
});
