import type { QmuxPane, SidebarProject } from '../types.js';
import { getQmuxThemeAccent } from '../theme/colors.js';
import { getPaneColorTheme } from './paneColors.js';

export const PANE_TITLE_BUSY_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const;
export const PANE_TITLE_IDLE_MARKER = '⠿';
export const TMUX_PANE_TITLE_PREFIX_FORMAT = '#{?@qmux_title_prefix,#{@qmux_title_prefix} ,}';
export const TMUX_PANE_TITLE_LABEL_FORMAT = '#{?@qmux_title_label,#{@qmux_title_label},#{s|__qmux__.*$||:pane_title}}';

function isBusyPane(pane: QmuxPane): boolean {
  return pane.agentStatus === 'working';
}

export function getPaneTitlePrefixValue(
  pane: QmuxPane,
  sidebarProjects: SidebarProject[],
  fallbackProjectRoot: string,
  spinnerFrameIndex: number = 0
): string {
  const themeName = getPaneColorTheme(pane, sidebarProjects, fallbackProjectRoot);
  const marker = isBusyPane(pane)
    ? PANE_TITLE_BUSY_FRAMES[spinnerFrameIndex % PANE_TITLE_BUSY_FRAMES.length]
    : PANE_TITLE_IDLE_MARKER;
  return `#[fg=${getQmuxThemeAccent(themeName)}]${marker}#[default]`;
}

export function paneNeedsAnimatedTitlePrefix(pane: QmuxPane): boolean {
  return isBusyPane(pane);
}
