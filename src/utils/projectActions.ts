import path from 'path';
import type { DmuxPane, SidebarProject } from '../types.js';
import {
  groupPanesByProject,
  type PaneProjectGroup,
} from './paneGrouping.js';

export type ProjectActionKind = 'new-agent' | 'terminal' | 'project' | 'remove-project';

export interface ProjectActionItem {
  index: number;
  projectRoot: string;
  projectName: string;
  kind: ProjectActionKind;
  hotkey: 'n' | 't' | 'p' | 'R' | null;
}

export interface ProjectActionLayout {
  groups: PaneProjectGroup[];
  actionItems: ProjectActionItem[];
  totalItems: number;
  multiProjectMode: boolean;
}

export interface PostCloseSelection {
  selectedIndex: number;
  pane?: DmuxPane;
  action?: ProjectActionItem;
}

function sameRoot(a: string, b: string): boolean {
  return path.resolve(a) === path.resolve(b);
}

/**
 * Build action-card metadata for pane navigation and rendering.
 *
 * - Single-project mode (<2 groups): one shared pair of action cards
 * - Multi-project mode (>=2 groups): one pair of cards under each project group
 */
export function buildProjectActionLayout(
  panes: DmuxPane[],
  sidebarProjects: SidebarProject[],
  fallbackProjectRoot: string,
  fallbackProjectName: string
): ProjectActionLayout {
  const groups = groupPanesByProject(
    panes,
    fallbackProjectRoot,
    fallbackProjectName,
    sidebarProjects
  );
  const multiProjectMode = groups.length >= 2;
  const actionItems: ProjectActionItem[] = [];

  if (!multiProjectMode) {
    // Order matters: terminal is the default/first action, then project
    // (opens the quick-open chooser), then new-agent. The initial selection
    // (index === panes.length) therefore lands on terminal.
    const baseIndex = panes.length;
    actionItems.push({
      index: baseIndex,
      projectRoot: fallbackProjectRoot,
      projectName: fallbackProjectName,
      kind: 'terminal',
      hotkey: 't',
    });
    actionItems.push({
      index: baseIndex + 1,
      projectRoot: fallbackProjectRoot,
      projectName: fallbackProjectName,
      kind: 'project',
      hotkey: 'p',
    });
    actionItems.push({
      index: baseIndex + 2,
      projectRoot: fallbackProjectRoot,
      projectName: fallbackProjectName,
      kind: 'new-agent',
      hotkey: 'n',
    });
  } else {
    let index = panes.length;
    for (const group of groups) {
      const isMainProject = sameRoot(group.projectRoot, fallbackProjectRoot);
      actionItems.push({
        index,
        projectRoot: group.projectRoot,
        projectName: group.projectName,
        kind: 'terminal',
        hotkey: 't',
      });
      index += 1;
      actionItems.push({
        index,
        projectRoot: group.projectRoot,
        projectName: group.projectName,
        kind: 'new-agent',
        hotkey: 'n',
      });
      index += 1;
      if (!isMainProject && group.panes.length === 0) {
        actionItems.push({
          index,
          projectRoot: group.projectRoot,
          projectName: group.projectName,
          kind: 'remove-project',
          hotkey: 'R',
        });
        index += 1;
      }
    }
  }

  return {
    groups,
    actionItems,
    totalItems: panes.length + actionItems.length,
    multiProjectMode,
  };
}

export function getProjectActionByIndex(
  actionItems: ProjectActionItem[],
  index: number
): ProjectActionItem | undefined {
  return actionItems.find((item) => item.index === index);
}

export function resolveSelectionAfterPaneClose(
  panes: DmuxPane[],
  closingPaneId: string,
  sidebarProjects: SidebarProject[],
  fallbackProjectRoot: string,
  fallbackProjectName: string
): PostCloseSelection | null {
  const currentLayout = buildProjectActionLayout(
    panes,
    sidebarProjects,
    fallbackProjectRoot,
    fallbackProjectName
  );

  let closingGroup: PaneProjectGroup | undefined;
  let closingGroupPaneIndex = -1;
  let closingPane: DmuxPane | undefined;

  for (const group of currentLayout.groups) {
    const groupIndex = group.panes.findIndex(
      (entry) =>
        entry.pane.id === closingPaneId ||
        entry.pane.paneId === closingPaneId
    );
    if (groupIndex !== -1) {
      closingGroup = group;
      closingGroupPaneIndex = groupIndex;
      closingPane = group.panes[groupIndex].pane;
      break;
    }
  }

  if (!closingGroup || !closingPane) {
    return null;
  }

  const closingProjectRoot = closingGroup.projectRoot;
  const updatedPanes = panes.filter((pane) => pane.id !== closingPane.id);
  const nextLayout = buildProjectActionLayout(
    updatedPanes,
    sidebarProjects,
    fallbackProjectRoot,
    fallbackProjectName
  );
  const nextGroup = nextLayout.groups.find((group) =>
    sameRoot(group.projectRoot, closingProjectRoot)
  );
  const nextPane = nextGroup?.panes[closingGroupPaneIndex];

  if (nextPane) {
    return {
      selectedIndex: nextPane.index,
      pane: nextPane.pane,
    };
  }

  // Terminal is the default action, so prefer landing selection there after a
  // close (same project first, then any terminal action).
  const terminalAction = nextLayout.actionItems.find(
    (action) =>
      action.kind === 'terminal' &&
      sameRoot(action.projectRoot, closingProjectRoot)
  );

  if (terminalAction) {
    return {
      selectedIndex: terminalAction.index,
      action: terminalAction,
    };
  }

  const fallbackAction = nextLayout.actionItems.find(
    (action) => action.kind === 'terminal'
  );

  if (fallbackAction) {
    return {
      selectedIndex: fallbackAction.index,
      action: fallbackAction,
    };
  }

  return null;
}

/**
 * Build visual navigation rows in rendered order.
 *
 * Each inner array represents one visible row of selectable cards/buttons.
 * This is the canonical source for arrow-key navigation.
 */
export function buildVisualNavigationRows(
  layout: ProjectActionLayout
): number[][] {
  const rows: number[][] = [];
  const actionByProject = new Map<
    string,
    {
      newAgent?: ProjectActionItem;
      terminal?: ProjectActionItem;
      project?: ProjectActionItem;
      removeProject?: ProjectActionItem;
    }
  >();

  for (const action of layout.actionItems) {
    const entry = actionByProject.get(action.projectRoot) || {};
    if (action.kind === 'new-agent') {
      entry.newAgent = action;
    } else if (action.kind === 'terminal') {
      entry.terminal = action;
    } else if (action.kind === 'project') {
      entry.project = action;
    } else {
      entry.removeProject = action;
    }
    actionByProject.set(action.projectRoot, entry);
  }

  if (!layout.multiProjectMode) {
    for (const group of layout.groups) {
      for (const entry of group.panes) {
        rows.push([entry.index]);
      }
    }

    // One row holding every shared action card, in registered order
    // (terminal, project, new-agent).
    const actionRow = layout.actionItems.map((action) => action.index);
    if (actionRow.length > 0) {
      rows.push(actionRow);
    }

    return rows;
  }

  for (const group of layout.groups) {
    for (const entry of group.panes) {
      rows.push([entry.index]);
    }

    const groupActions = actionByProject.get(group.projectRoot);
    const actionRow = [
      groupActions?.terminal?.index,
      groupActions?.newAgent?.index,
      groupActions?.removeProject?.index,
    ].filter((value): value is number => value !== undefined);

    if (actionRow.length > 0) {
      rows.push(actionRow);
    }
  }

  return rows;
}

/**
 * Build navigation rows for the horizontal (bottom control pane) layout.
 *
 * All pane indices are flattened in visual order and chunked into rows of
 * `columns`, so ←/→ moves within a wrap-row and ↑/↓ moves between wrap-rows.
 * The new-agent/terminal actions are appended as a final row. Project grouping
 * headers are dropped in this compact layout.
 */
export function buildHorizontalNavigationRows(
  layout: ProjectActionLayout,
  columns: number
): number[][] {
  const cols = Math.max(1, Math.floor(columns) || 1);
  const paneIndices: number[] = [];
  for (const group of layout.groups) {
    for (const entry of group.panes) {
      paneIndices.push(entry.index);
    }
  }

  const rows: number[][] = [];
  for (let i = 0; i < paneIndices.length; i += cols) {
    rows.push(paneIndices.slice(i, i + cols));
  }

  const actionRow = layout.actionItems
    .filter(
      (action) =>
        action.kind === 'new-agent' ||
        action.kind === 'terminal' ||
        action.kind === 'project'
    )
    .map((action) => action.index);
  if (actionRow.length > 0) {
    rows.push(actionRow);
  }

  return rows;
}

/**
 * Build an array of row indices where each project group starts.
 * Used by left/right navigation to jump between project groups.
 */
export function buildGroupStartRows(
  layout: ProjectActionLayout
): number[] {
  if (!layout.multiProjectMode) return [];

  const starts: number[] = [];
  let row = 0;
  for (const group of layout.groups) {
    starts.push(row);
    row += group.panes.length + 1;
  }
  return starts;
}
