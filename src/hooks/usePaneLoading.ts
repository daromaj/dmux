import fs from 'fs/promises';
import path from 'path';
import type { DmuxPane, SidebarProject } from '../types.js';
import { splitPane } from '../utils/tmux.js';
import { rebindPaneByTitle } from '../utils/paneRebinding.js';
import { LogService } from '../services/LogService.js';
import { TmuxService } from '../services/TmuxService.js';
import { PaneLifecycleManager } from '../services/PaneLifecycleManager.js';
import { TMUX_COMMAND_TIMEOUT, TMUX_RETRY_DELAY } from '../constants/timing.js';
import { atomicWriteJson } from '../utils/atomicWrite.js';
import { syncPaneColorThemes } from '../utils/paneColors.js';
import {
  buildAgentCommand,
  shouldEnableCodexGoals,
} from '../utils/agentLaunch.js';
import { ensureGeminiFolderTrusted } from '../utils/geminiTrust.js';
import {
  buildCodexHookedCommand,
  installCodexPaneHooks,
} from '../utils/codexHooks.js';
import { installClaudePaneHooks } from '../utils/claudeHooks.js';
import { getPaneTmuxTitle } from '../utils/paneTitle.js';
import {
  getVisiblePanes,
  syncHiddenStateFromCurrentWindow,
} from '../utils/paneVisibility.js';
import { normalizeSidebarProjects } from '../utils/sidebarProjects.js';

// Separate config structure to match new format
export interface DmuxConfig {
  projectName?: string;
  projectRoot?: string;
  panes: DmuxPane[];
  sidebarProjects?: SidebarProject[];
  settings?: any;
  lastUpdated?: string;
  controlPaneId?: string;
  welcomePaneId?: string;
}

interface PaneLoadResult {
  panes: DmuxPane[];
  allPaneIds: string[];
  titleToId: Map<string, string>;
}

/**
 * Whether dmux was launched in "continue" mode (`dmux -c` / `dmux --continue`).
 *
 * Default `dmux` starts fresh: saved panes that are no longer live in tmux are NOT
 * recreated. `dmux -c` reopens the last session — live panes are reattached, and any
 * that were lost (e.g. the tmux server was killed) are recreated with fresh agent
 * sessions.
 */
export function shouldContinueSession(
  argv: string[] = process.argv.slice(2)
): boolean {
  return argv.includes('-c') || argv.includes('--continue');
}

/**
 * Decide which saved panes are stale and must be dropped from config on initial load.
 *
 * - A pane is stale only if it is not live in tmux.
 * - In continue mode (`-c`), only shell panes are dropped (they can't be recreated);
 *   worktree/agent panes are kept so they can be restored.
 * - In fresh mode (plain `dmux`), ALL non-live panes are dropped — this is what stops a
 *   later poll from reloading them and recreating them in an old worktree dir.
 */
export function selectStalePanesToDrop(
  panes: DmuxPane[],
  allPaneIds: string[],
  continueSession: boolean
): DmuxPane[] {
  return panes.filter(
    (pane) =>
      !allPaneIds.includes(pane.paneId) &&
      (!continueSession || pane.type === 'shell')
  );
}

/**
 * Decide which saved panes should be recreated on initial load. Only worktree/agent
 * panes that are missing from tmux qualify, and ONLY when continue mode is active.
 * Without `-c`, nothing is recreated (start-fresh behavior).
 */
export function selectMissingPanesToRecreate(
  panes: DmuxPane[],
  allPaneIds: string[],
  isInitialLoad: boolean,
  continueSession: boolean
): DmuxPane[] {
  if (!isInitialLoad || !continueSession || allPaneIds.length === 0 || panes.length === 0) {
    return [];
  }
  return panes.filter(
    (pane) => !allPaneIds.includes(pane.paneId) && pane.type !== 'shell'
  );
}

async function restoreAgentSessionForPane(
  tmuxService: TmuxService,
  pane: DmuxPane,
  paneId: string
): Promise<void> {
  if (!pane.agent) {
    return;
  }

  if (pane.agent === 'gemini' && pane.worktreePath) {
    ensureGeminiFolderTrusted(pane.worktreePath);
  }

  await new Promise((resolve) => setTimeout(resolve, 200));
  // Restore panes with a FRESH agent session (no --continue/resume). dmux does not
  // silently resume an old agent session behind the user's back; `dmux -c` recreates
  // the pane structure and starts the agent clean.
  let command = buildAgentCommand(pane.agent, pane.permissionMode);

  if (pane.agent === 'codex' && pane.worktreePath) {
    let codexHookEventFile: string | undefined;
    try {
      codexHookEventFile = installCodexPaneHooks({
        worktreePath: pane.worktreePath,
        dmuxPaneId: pane.id,
        tmuxPaneId: paneId,
      }).eventFile;
    } catch {
      // Hook installation is best effort; Codex can still resume normally.
    }

    command = buildCodexHookedCommand(command, {
      dmuxPaneId: pane.id,
      tmuxPaneId: paneId,
      eventFile: codexHookEventFile,
    }, {
      enableGoals: shouldEnableCodexGoals(pane.agent, pane.goalMode),
    });
  }

  if (pane.agent === 'claude' && pane.worktreePath) {
    try {
      installClaudePaneHooks({
        worktreePath: pane.worktreePath,
        dmuxPaneId: pane.id,
        tmuxPaneId: paneId,
      });
    } catch {
      // Hook installation is best effort; Claude can still resume normally.
    }
  }

  await tmuxService.sendShellCommand(paneId, command);
  await tmuxService.sendTmuxKeys(paneId, 'Enter');
}

/**
 * Fetches all tmux pane IDs and titles for the current session
 * Retries up to maxRetries times with delay between attempts
 */
export async function fetchTmuxPaneIds(maxRetries = 2): Promise<{
  allPaneIds: string[];
  titleToId: Map<string, string>;
  currentWindowPaneIds: string[];
}> {
  const tmuxService = TmuxService.getInstance();
  let retryCount = 0;

  while (retryCount <= maxRetries) {
    try {
      const paneInfo = await tmuxService.getAllPaneInfo('session');
      const currentWindowPaneIds = await tmuxService.getAllPaneIds('window');
      const allPaneIds: string[] = [];
      const titleToId = new Map<string, string>();

      for (const pane of paneInfo) {
        if (!pane.paneId || !pane.paneId.startsWith('%') || pane.title === 'dmux-spacer') {
          continue;
        }
        allPaneIds.push(pane.paneId);
        if (pane.title) {
          titleToId.set(pane.title.trim(), pane.paneId);
        }
      }

      if (allPaneIds.length > 0 || retryCount === maxRetries) {
        return { allPaneIds, titleToId, currentWindowPaneIds };
      }
    } catch (error) {
      // Retry on tmux command failure (common during rapid pane creation/destruction)
  //       LogService.getInstance().debug(
  //         `Tmux fetch failed (attempt ${retryCount + 1}/${maxRetries}): ${error instanceof Error ? error.message : String(error)}`,
  //         'usePaneLoading'
  //       );
      if (retryCount < maxRetries) await new Promise(r => setTimeout(r, TMUX_RETRY_DELAY));
    }
    retryCount++;
  }

  return { allPaneIds: [], titleToId: new Map(), currentWindowPaneIds: [] };
}

/**
 * Reads and parses the panes config file
 * Handles both old array format and new config format
 */
export async function loadPanesFromFile(panesFile: string): Promise<DmuxPane[]> {
  const fallbackProjectRoot = path.dirname(path.dirname(panesFile));

  try {
    const content = await fs.readFile(panesFile, 'utf-8');
    const parsed: any = JSON.parse(content);

    if (Array.isArray(parsed)) {
      return syncPaneColorThemes(parsed as DmuxPane[], [], fallbackProjectRoot);
    } else {
      const config = parsed as DmuxConfig;
      const projectRoot = config.projectRoot || fallbackProjectRoot;
      const panes = Array.isArray(config.panes) ? config.panes : [];
      const sidebarProjects = Array.isArray(config.sidebarProjects) ? config.sidebarProjects : [];
      return syncPaneColorThemes(panes, sidebarProjects, projectRoot);
    }
  } catch (error) {
    // Return empty array if config file doesn't exist or is invalid
    // This is expected on first run
  //     LogService.getInstance().debug(
  //       `Config file not found or invalid: ${error instanceof Error ? error.message : String(error)}`,
  //       'usePaneLoading'
  //     );
    return [];
  }
}

export async function loadSidebarProjectsFromFile(
  panesFile: string,
  panes?: DmuxPane[]
): Promise<SidebarProject[]> {
  const fallbackProjectRoot = path.dirname(path.dirname(panesFile));

  try {
    const content = await fs.readFile(panesFile, 'utf-8');
    const parsed: any = JSON.parse(content);
    const config = Array.isArray(parsed)
      ? { panes: parsed as DmuxPane[] }
      : parsed as DmuxConfig;
    const configPanes = Array.isArray(config.panes) ? config.panes : [];
    const effectivePanes = panes || configPanes;
    const projectRoot = config.projectRoot || fallbackProjectRoot;
    const projectName = config.projectName || path.basename(projectRoot);

    return normalizeSidebarProjects(
      config.sidebarProjects,
      effectivePanes,
      projectRoot,
      projectName
    );
  } catch {
    return normalizeSidebarProjects(
      undefined,
      panes || [],
      fallbackProjectRoot,
      path.basename(fallbackProjectRoot)
    );
  }
}

/**
 * Recreates missing worktree panes that exist in config but not in tmux
 * Only called on initial load
 */
export async function recreateMissingPanes(
  missingPanes: DmuxPane[],
  panesFile: string
): Promise<void> {
  if (missingPanes.length === 0) return;

  const tmuxService = TmuxService.getInstance();
  const sessionProjectRoot = path.dirname(path.dirname(panesFile));

  for (const missingPane of missingPanes) {
    try {
      // Create new pane
      const newPaneId = splitPane({ cwd: missingPane.worktreePath || process.cwd() });

      // Set pane title
      await tmuxService.setPaneTitle(newPaneId, getPaneTmuxTitle(missingPane, sessionProjectRoot));

      // Update the pane with new ID
      missingPane.paneId = newPaneId;

      // Send a message to the pane indicating it was restored
      await tmuxService.sendKeys(newPaneId, `"echo '# Pane restored: ${missingPane.slug}'" Enter`);
      const promptPreview = missingPane.prompt?.substring(0, 50) || '';
      await tmuxService.sendKeys(newPaneId, `"echo '# Original prompt: ${promptPreview}...'" Enter`);
      await tmuxService.sendKeys(newPaneId, `"cd ${missingPane.worktreePath || process.cwd()}" Enter`);
      await restoreAgentSessionForPane(tmuxService, missingPane, newPaneId);
    } catch (error) {
      // If we can't create the pane, skip it
    }
  }

  // Apply even-horizontal layout after creating panes
  try {
    await tmuxService.selectLayout('even-horizontal');
    await tmuxService.refreshClient();
  } catch {}
}

/**
 * Recreates worktree panes that were killed by the user (e.g., via Ctrl+b x)
 * Called during periodic polling after initial load
 *
 * IMPORTANT: Checks PaneLifecycleManager to avoid recreating panes that are
 * being intentionally closed (prevents race condition with close/merge actions)
 */
export async function recreateKilledWorktreePanes(
  panes: DmuxPane[],
  allPaneIds: string[],
  panesFile: string
): Promise<DmuxPane[]> {
  const lifecycleManager = PaneLifecycleManager.getInstance();
  const sessionProjectRoot = path.dirname(path.dirname(panesFile));

  // Filter out panes that are being intentionally closed
  const worktreePanesToRecreate = panes.filter(pane => {
    // Pane must be missing from tmux and have a worktree path
    if (allPaneIds.includes(pane.paneId) || !pane.worktreePath) {
      return false;
    }

    // CRITICAL: Check if this pane is being intentionally closed
    // This is a safety belt - the main protection is that close action
    // removes pane from config BEFORE killing tmux pane
    if (lifecycleManager.isClosing(pane.id) || lifecycleManager.isClosing(pane.paneId)) {
      LogService.getInstance().debug(
        `Skipping recreation of pane ${pane.id} (${pane.slug}) - intentionally being closed`,
        'shellDetection'
      );
      return false;
    }

    return true;
  });

  if (worktreePanesToRecreate.length === 0) return panes;

  const tmuxService = TmuxService.getInstance();

  //   LogService.getInstance().debug(
  //     `Recreating ${worktreePanesToRecreate.length} killed worktree panes`,
  //     'shellDetection'
  //   );

  const updatedPanes = [...panes];

  for (const pane of worktreePanesToRecreate) {
    try {
      // Create new pane in the worktree directory
      const newPaneId = splitPane({ cwd: pane.worktreePath });

      // Set pane title
      await tmuxService.setPaneTitle(newPaneId, getPaneTmuxTitle(pane, sessionProjectRoot));

      // Update the pane with new ID
      const paneIndex = updatedPanes.findIndex(p => p.id === pane.id);
      if (paneIndex !== -1) {
        updatedPanes[paneIndex] = { ...pane, paneId: newPaneId };
      }

      // Send a message to the pane indicating it was restored
      await tmuxService.sendKeys(newPaneId, `"echo '# Pane restored: ${pane.slug}'" Enter`);
      if (pane.prompt) {
        const promptPreview = pane.prompt.substring(0, 50) || '';
        await tmuxService.sendKeys(newPaneId, `"echo '# Original prompt: ${promptPreview}...'" Enter`);
      }
      await tmuxService.sendKeys(newPaneId, `"cd ${pane.worktreePath}" Enter`);
      await restoreAgentSessionForPane(tmuxService, pane, newPaneId);

  //       LogService.getInstance().debug(
  //         `Recreated worktree pane ${pane.id} (${pane.slug}) with new ID ${newPaneId}`,
  //         'shellDetection'
  //       );
    } catch (error) {
  //       LogService.getInstance().debug(
  //         `Failed to recreate worktree pane ${pane.id} (${pane.slug})`,
  //         'shellDetection'
  //       );
    }
  }

  // Recalculate layout after recreating panes
  try {
    const configContent = await fs.readFile(panesFile, 'utf-8');
    const config = JSON.parse(configContent);
    if (config.controlPaneId) {
      const { recalculateAndApplyLayout } = await import('../utils/layoutManager.js');
      const { getTerminalDimensions } = await import('../utils/tmux.js');
      const dimensions = getTerminalDimensions();

      const contentPaneIds = getVisiblePanes(updatedPanes).map(p => p.paneId);
      recalculateAndApplyLayout(
        config.controlPaneId,
        contentPaneIds,
        dimensions.width,
        dimensions.height
      );

  //       LogService.getInstance().debug(
  //         `Recalculated layout after recreating worktree panes`,
  //         'shellDetection'
  //       );
    }
  } catch (error) {
  //     LogService.getInstance().debug(
  //       'Failed to recalculate layout after recreating worktree panes',
  //       'shellDetection'
  //     );
  }

  return updatedPanes;
}

/**
 * Loads panes from config file, rebinds IDs, and recreates missing panes
 * Returns the loaded and processed panes along with tmux state
 *
 * CRITICAL FIX: On initial load, stale shell panes are removed immediately.
 * Shell panes have no worktreePath so they cannot be recreated - keeping them
 * with stale paneIds causes dmux to hang when trying to interact with them.
 */
export async function loadAndProcessPanes(
  panesFile: string,
  isInitialLoad: boolean
): Promise<PaneLoadResult> {
  const loadedPanes = await loadPanesFromFile(panesFile);
  let { allPaneIds, titleToId, currentWindowPaneIds } = await fetchTmuxPaneIds();

  // Attempt to rebind panes whose IDs changed by matching on their stable tmux title.
  let reboundPanes = syncHiddenStateFromCurrentWindow(
    loadedPanes.map(p => rebindPaneByTitle(p, titleToId, allPaneIds)),
    currentWindowPaneIds
  );

  // Continue mode (`dmux -c`) gates whether saved panes get restored at all.
  const continueSession = shouldContinueSession();

  // On initial load, drop stale panes and PERSIST the cleaned config so a later poll
  // cycle can't reload them and resurrect them.
  //
  // - Always: stale shell panes (no worktreePath, cannot be recreated) — keeping them
  //   with dead IDs causes hangs and "Invalid layout" errors.
  // - Fresh start (no -c): ALSO drop stale worktree/agent panes. `dmux` starts from
  //   scratch, so a saved worktree pane that isn't live must not be recreated. Removing
  //   it from config on disk is what stops the polling recreation path from bringing it
  //   back (e.g. after a click triggers a sync). `dmux -c` keeps them so they restore.
  if (isInitialLoad && allPaneIds.length > 0) {
    const stalePanes = selectStalePanesToDrop(reboundPanes, allPaneIds, continueSession);
    const staleIds = new Set(stalePanes.map(p => p.id));

    if (stalePanes.length > 0) {
      LogService.getInstance().info(
        `Removing ${stalePanes.length} stale pane(s) on startup${continueSession ? ' (shells only, -c)' : ' (fresh start)'}: ${stalePanes.map(p => p.slug).join(', ')}`,
        'usePaneLoading'
      );
      reboundPanes = reboundPanes.filter(p => !staleIds.has(p.id));

      // Save the cleaned config immediately to prevent these panes from reappearing
      try {
        const fs = await import('fs/promises');
        const configContent = await fs.readFile(panesFile, 'utf-8');
        const config = JSON.parse(configContent);
        config.panes = reboundPanes;
        const projectRoot = config.projectRoot || path.dirname(path.dirname(panesFile));
        const projectName = config.projectName || path.basename(projectRoot);
        config.sidebarProjects = normalizeSidebarProjects(
          config.sidebarProjects,
          reboundPanes,
          projectRoot,
          projectName
        );
        config.lastUpdated = new Date().toISOString();
        await atomicWriteJson(panesFile, config);
        LogService.getInstance().debug('Saved cleaned config after removing stale panes', 'usePaneLoading');
      } catch (saveError) {
        LogService.getInstance().debug(
          `Failed to save cleaned config: ${saveError}`,
          'usePaneLoading'
        );
      }
    }
  }

  // Only recreate missing worktree/agent panes when the user asked to continue.
  const missingPanes = selectMissingPanesToRecreate(
    reboundPanes,
    allPaneIds,
    isInitialLoad,
    continueSession
  );

  // Recreate missing panes (only on initial load, only in continue mode)
  await recreateMissingPanes(missingPanes, panesFile);

  // Re-fetch pane IDs after recreation
  if (missingPanes.length > 0) {
    const freshData = await fetchTmuxPaneIds();
    allPaneIds = freshData.allPaneIds;
    titleToId = freshData.titleToId;
    currentWindowPaneIds = freshData.currentWindowPaneIds;

    // Re-rebind after recreation
    reboundPanes = syncHiddenStateFromCurrentWindow(
      reboundPanes.map(p => rebindPaneByTitle(p, titleToId, allPaneIds)),
      currentWindowPaneIds
    );
  }

  return { panes: reboundPanes, allPaneIds, titleToId };
}
