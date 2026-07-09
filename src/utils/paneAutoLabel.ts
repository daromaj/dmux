/**
 * Auto-labeling for shell panes.
 *
 * Shell panes are tracked by a stable `shell-N` slug, but that reads poorly in
 * the control-pane list. This module derives a short, one-word display label
 * from cheap runtime signals using a priority cascade:
 *
 *   1. the active non-shell tool running in the pane (nvim / node / psql / …)
 *   2. else the git branch of the pane's working directory
 *   3. else the working directory basename
 *
 * The result is written to `pane.autoLabel`, which `getPaneDisplayName` prefers
 * over the slug but never over a manual `displayName`.
 */

// Foreground commands that mean "an idle shell", i.e. not a meaningful tool.
// A leading '-' marks a login shell (e.g. `-zsh`).
const SHELL_COMMANDS = new Set([
  'zsh',
  'bash',
  'sh',
  'fish',
  'dash',
  'ash',
  'csh',
  'tcsh',
  'ksh',
  'login',
  'tmux',
  'screen',
]);

const MAX_LABEL_LENGTH = 24;

export interface ShellLabelSignals {
  /** tmux `pane_current_command` — the foreground process name. */
  currentCommand?: string;
  /** tmux `pane_current_path` — the pane's working directory. */
  currentPath?: string;
  /** git branch for `currentPath`, when it is inside a repo. */
  branch?: string;
}

export function isShellCommand(command: string | undefined): boolean {
  if (!command) {
    return true;
  }
  const normalized = command.replace(/^-/, '').trim().toLowerCase();
  if (!normalized) {
    return true;
  }
  return SHELL_COMMANDS.has(normalized);
}

/** Last non-empty segment of a `/`-delimited path or branch name. */
function lastSegment(value: string): string {
  const segments = value.split('/').filter((segment) => segment.length > 0);
  return segments.length > 0 ? segments[segments.length - 1] : '';
}

function normalizeLabel(value: string): string {
  const cleaned = value
    .replace(/[\x00-\x1f\x7f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned.length <= MAX_LABEL_LENGTH) {
    return cleaned;
  }
  return cleaned.slice(0, MAX_LABEL_LENGTH - 1).trimEnd() + '…';
}

/**
 * Derive a one-word label from pane signals, or `undefined` when nothing
 * meaningful is available (fall back to the slug).
 */
export function computeShellPaneLabel(
  signals: ShellLabelSignals
): string | undefined {
  const command = signals.currentCommand?.trim();
  if (command && !isShellCommand(command)) {
    const label = normalizeLabel(command);
    if (label) {
      return label;
    }
  }

  const branch = signals.branch?.trim();
  if (branch) {
    const label = normalizeLabel(lastSegment(branch) || branch);
    if (label) {
      return label;
    }
  }

  const currentPath = signals.currentPath?.trim();
  if (currentPath) {
    const base = lastSegment(currentPath);
    if (base) {
      const label = normalizeLabel(base);
      if (label) {
        return label;
      }
    }
  }

  return undefined;
}
