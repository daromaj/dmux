import type { QmuxPane } from '../types.js';
import { execAsync } from './execAsync.js';
import { computeShellPaneLabel } from './paneAutoLabel.js';

interface PaneRuntimeSignals {
  currentCommand?: string;
  currentPath?: string;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Batch-read `pane_current_command` + `pane_current_path` for every tmux pane.
 * Keyed by the (globally unique) tmux pane id.
 */
async function readPaneRuntimeSignals(): Promise<Map<string, PaneRuntimeSignals>> {
  const signals = new Map<string, PaneRuntimeSignals>();
  const output = await execAsync(
    `tmux list-panes -a -F '#{pane_id}|#{pane_current_command}|#{pane_current_path}'`,
    { silent: true, timeout: 4000 }
  );
  if (!output) {
    return signals;
  }

  for (const line of output.split('\n')) {
    if (!line) continue;
    const firstSep = line.indexOf('|');
    if (firstSep === -1) continue;
    const paneId = line.slice(0, firstSep);
    const rest = line.slice(firstSep + 1);
    const secondSep = rest.indexOf('|');
    const currentCommand = secondSep === -1 ? rest : rest.slice(0, secondSep);
    const currentPath = secondSep === -1 ? '' : rest.slice(secondSep + 1);
    signals.set(paneId, {
      currentCommand: currentCommand || undefined,
      currentPath: currentPath || undefined,
    });
  }

  return signals;
}

async function readBranch(cwd: string): Promise<string | undefined> {
  const branch = await execAsync(
    `git -C ${shellQuote(cwd)} branch --show-current`,
    { silent: true, timeout: 3000 }
  );
  return branch ? branch.trim() || undefined : undefined;
}

/**
 * Compute an auto-label for each shell pane from live tmux/git signals.
 *
 * Returns a map of qmux pane id → label (or `undefined` when the slug should be
 * used). Non-shell panes are omitted. All IO is best-effort; failures yield
 * `undefined` for that pane rather than throwing.
 */
export async function collectShellPaneLabels(
  panes: QmuxPane[]
): Promise<Map<string, string | undefined>> {
  const result = new Map<string, string | undefined>();
  const shellPanes = panes.filter(
    (pane) => pane.type === 'shell' && !!pane.paneId
  );
  if (shellPanes.length === 0) {
    return result;
  }

  let signalsById: Map<string, PaneRuntimeSignals>;
  try {
    signalsById = await readPaneRuntimeSignals();
  } catch {
    return result;
  }

  // Cache branch lookups per working directory within a single pass.
  const branchByPath = new Map<string, string | undefined>();
  const resolveBranch = async (cwd: string): Promise<string | undefined> => {
    if (branchByPath.has(cwd)) {
      return branchByPath.get(cwd);
    }
    let branch: string | undefined;
    try {
      branch = await readBranch(cwd);
    } catch {
      branch = undefined;
    }
    branchByPath.set(cwd, branch);
    return branch;
  };

  for (const pane of shellPanes) {
    const signals = signalsById.get(pane.paneId);
    if (!signals) {
      result.set(pane.id, undefined);
      continue;
    }

    // Only pay for a git call when the cascade actually needs a branch, i.e.
    // the pane is sitting at an idle shell rather than running a tool.
    let branch: string | undefined;
    if (
      signals.currentPath &&
      computeShellPaneLabel({ currentCommand: signals.currentCommand }) ===
        undefined
    ) {
      branch = await resolveBranch(signals.currentPath);
    }

    result.set(
      pane.id,
      computeShellPaneLabel({
        currentCommand: signals.currentCommand,
        currentPath: signals.currentPath,
        branch,
      })
    );
  }

  return result;
}
