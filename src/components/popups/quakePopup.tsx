import React from 'react';
import fs from 'fs';
import { execSync } from 'child_process';
import { render, useApp } from 'ink';
import QuakeOverlay from '../QuakeOverlay.js';
import { QuakeAssistantService } from '../../services/QuakeAssistantService.js';
import { callChatCompletion } from '../../utils/aiClient.js';
import { runQuakeShell } from '../../utils/quakeShell.js';
import { SettingsManager } from '../../utils/settingsManager.js';
import { isQmuxThemeName } from '../../theme/themePalette.js';
import type {
  QuakeControlHandlers,
  QuakeWorkspaceContext,
} from '../../utils/quakeTypes.js';

/**
 * Standalone quake-mode popup: a top-drawer chat that talks to the configured
 * LLM and operates the workspace. Runs in its own process (tmux display-popup)
 * so it can appear as a drawer without touching the control pane. It drives the
 * underlying panes directly via `tmux send-keys` / `capture-pane`.
 *
 * Data (projectRoot, session, control pane id, panes file, resolved AI config)
 * is passed in through a JSON file written by the main process, since a tmux
 * popup does not reliably inherit the qmux process environment.
 */

interface QuakePopupData {
  projectRoot: string;
  sessionName?: string;
  controlPaneId?: string;
  panesFile: string;
  ai?: {
    apiKey?: string;
    baseUrl?: string;
    model?: string;
    provider?: string;
  };
}

const resultFile = process.argv[2];
const dataFile = process.argv[3];

function readData(): QuakePopupData {
  return JSON.parse(fs.readFileSync(dataFile, 'utf-8'));
}

const data = readData();

// A tmux popup does not inherit the parent env, so seed the AI config into this
// process's env — getAiConfig()/callChatCompletion read from here.
if (data.ai?.apiKey) process.env.QMUX_AI_API_KEY = data.ai.apiKey;
if (data.ai?.baseUrl) process.env.QMUX_AI_BASE_URL = data.ai.baseUrl;
if (data.ai?.model) process.env.QMUX_AI_MODEL = data.ai.model;
if (data.ai?.provider) process.env.QMUX_AI_PROVIDER = data.ai.provider;

function resolveSessionName(): string {
  if (data.sessionName) return data.sessionName;
  try {
    return execSync("tmux display-message -p '#{session_name}'", {
      encoding: 'utf-8',
    }).trim();
  } catch {
    return 'qmux';
  }
}

const sessionName = resolveSessionName();

function readPanes(): any[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(data.panesFile, 'utf-8'));
    return Array.isArray(parsed?.panes) ? parsed.panes : [];
  } catch {
    return [];
  }
}

const getWorkspaceContext = (): QuakeWorkspaceContext => {
  const settings = new SettingsManager(data.projectRoot).getSettings();
  const panes = readPanes().filter((p) => p.paneId !== data.controlPaneId);
  return {
    sessionName,
    projectRoot: data.projectRoot,
    gridColumns: settings.gridColumns ?? 0,
    controlPanePosition: (settings.controlPanePosition as 'bottom' | 'left') ?? 'bottom',
    panes: panes.map((p) => ({
      id: p.id,
      slug: p.slug,
      paneId: p.paneId,
      agent: p.agent,
      worktreePath: p.worktreePath,
      status: p.agentStatus,
    })),
  };
};

// Control verbs run in this separate process, so they persist settings to disk
// (best-effort) rather than hot-applying to the live qmux UI.
const controlHandlers: QuakeControlHandlers = {
  setGridColumns: (columns) => {
    const n = columns === 'auto' ? 0 : columns;
    new SettingsManager(data.projectRoot).updateSetting('gridColumns', n as any, 'global');
    return `Saved gridColumns=${n === 0 ? 'auto' : n} (applies on next qmux layout change).`;
  },
  setControlPosition: (position) => {
    new SettingsManager(data.projectRoot).updateSetting(
      'controlPanePosition',
      position as any,
      'global',
    );
    return `Saved control position=${position} (applies on next qmux layout change).`;
  },
  setPaneColor: (paneRef, color) => {
    const normalized = color.trim().toLowerCase();
    if (!isQmuxThemeName(normalized)) {
      return `Invalid color "${color}". Not a known theme.`;
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(data.panesFile, 'utf-8'));
      const panes = Array.isArray(parsed?.panes) ? parsed.panes : [];
      const target = panes.find(
        (p: any) => p.slug === paneRef || p.paneId === paneRef || p.id === paneRef,
      );
      if (!target) return `No pane matched "${paneRef}".`;
      target.colorTheme = normalized;
      target.colorThemeSource = 'manual';
      fs.writeFileSync(data.panesFile, JSON.stringify(parsed, null, 2));
      return `Pane ${target.slug} colored ${normalized}.`;
    } catch (err: any) {
      return `Failed to set color: ${err?.message || String(err)}`;
    }
  },
  refreshLayout: () => 'Layout refresh happens automatically in the main qmux UI.',
};

const service = new QuakeAssistantService({
  getWorkspaceContext,
  controlHandlers,
  runShell: (command, { signal, timeoutMs }) =>
    runQuakeShell(command, {
      cwd: data.projectRoot,
      env: process.env,
      signal,
      timeoutMs,
    }),
  complete: (opts) => callChatCompletion(opts),
  transcriptPath: `${data.projectRoot}/.qmux/quake-history.jsonl`,
});

const QuakePopupApp: React.FC = () => {
  const { exit } = useApp();
  const handleClose = () => {
    try {
      fs.writeFileSync(resultFile, JSON.stringify({ success: true, cancelled: true }));
    } catch {
      // best-effort
    }
    exit();
    setTimeout(() => process.exit(0), 30);
  };
  return <QuakeOverlay service={service} onClose={handleClose} bordered={false} />;
};

render(<QuakePopupApp />);

// Signal readiness so the launcher's readyPromise resolves.
const readyFile = process.env.QMUX_POPUP_READY_FILE;
if (readyFile) {
  try {
    fs.writeFileSync(readyFile, 'ready');
  } catch {
    // best-effort
  }
}
