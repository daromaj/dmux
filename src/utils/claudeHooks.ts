import * as fs from 'fs';
import path from 'path';
import { atomicWriteFileSync, atomicWriteJsonSync } from './atomicWrite.js';
import { shellQuote } from './promptStore.js';

export interface ClaudeHookInstallResult {
  eventFile: string;
}

function escapeForSingleQuotedJs(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function mergeQmuxStopHook(settingsPath: string, hookCommand: string): void {
  let settingsConfig: any = {};
  if (fs.existsSync(settingsPath)) {
    try {
      settingsConfig = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    } catch {
      settingsConfig = {};
    }
  }

  if (!settingsConfig || typeof settingsConfig !== 'object' || Array.isArray(settingsConfig)) {
    settingsConfig = {};
  }

  if (!settingsConfig.hooks || typeof settingsConfig.hooks !== 'object' || Array.isArray(settingsConfig.hooks)) {
    settingsConfig.hooks = {};
  }

  const stopHooks = Array.isArray(settingsConfig.hooks.Stop) ? settingsConfig.hooks.Stop : [];
  const nextStopHooks = stopHooks.filter((group: any) => {
    const handlers = Array.isArray(group?.hooks) ? group.hooks : [];
    return !handlers.some((handler: any) => (
      typeof handler?.command === 'string'
      && handler.command.includes('qmux-stop-hook.cjs')
    ));
  });
  nextStopHooks.push({
    hooks: [
      {
        type: 'command',
        command: hookCommand,
        timeout: 5,
      },
    ],
  });

  settingsConfig.hooks.Stop = nextStopHooks;
  atomicWriteJsonSync(settingsPath, settingsConfig);
}

export function installClaudePaneHooks(opts: {
  worktreePath: string;
  qmuxPaneId: string;
  tmuxPaneId: string;
}): ClaudeHookInstallResult {
  const claudeDir = path.join(opts.worktreePath, '.claude');
  const hookDir = path.join(claudeDir, 'hooks');
  const stateDir = path.join(claudeDir, 'qmux');
  fs.mkdirSync(hookDir, { recursive: true });
  fs.mkdirSync(stateDir, { recursive: true });

  const eventFile = path.join(stateDir, `${opts.qmuxPaneId}.json`);
  const hookScriptPath = path.join(hookDir, 'qmux-stop-hook.cjs');
  const hookScript = `#!/usr/bin/env node
const fs = require('fs');

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  input += chunk;
});
process.stdin.on('end', () => {
  let payload = {};
  try {
    payload = input.trim() ? JSON.parse(input) : {};
  } catch (error) {
    payload = { parse_error: String(error), raw: input };
  }

  const event = {
    source: 'claude-stop-hook',
    qmuxPaneId: process.env.QMUX_PANE_ID || process.env.DMUX_PANE_ID || '',
    tmuxPaneId: process.env.QMUX_TMUX_PANE_ID || process.env.DMUX_TMUX_PANE_ID || '',
    expectedQmuxPaneId: '${escapeForSingleQuotedJs(opts.qmuxPaneId)}',
    expectedTmuxPaneId: '${escapeForSingleQuotedJs(opts.tmuxPaneId)}',
    hookEventName: payload.hook_event_name || payload.hookEventName || '',
    stopHookActive: payload.stop_hook_active === true || payload.stopHookActive === true,
    turnId: payload.session_id || payload.turn_id || payload.turnId || '',
    lastAssistantMessage: payload.last_assistant_message || null,
    transcriptPath: payload.transcript_path || null,
    cwd: payload.cwd || process.cwd(),
    timestamp: Date.now()
  };

  if (event.hookEventName && event.hookEventName !== 'Stop') {
    process.exit(0);
  }

  if (event.qmuxPaneId !== event.expectedQmuxPaneId) {
    process.exit(0);
  }

  try {
    fs.writeFileSync('${escapeForSingleQuotedJs(eventFile)}', JSON.stringify(event, null, 2));
  } catch (error) {
    process.exit(0);
  }

  process.stdout.write(JSON.stringify({ continue: true, suppressOutput: true }));
});
`;
  atomicWriteFileSync(hookScriptPath, hookScript);
  fs.chmodSync(hookScriptPath, 0o755);

  const settingsPath = path.join(claudeDir, 'settings.local.json');
  mergeQmuxStopHook(settingsPath, `node ${shellQuote(hookScriptPath)}`);

  return { eventFile };
}
