import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildCodexHookedCommand,
  CODEX_ENABLE_GOALS_FLAG,
  CODEX_ENABLE_HOOKS_FLAG,
  enableCodexHooksFlag,
  installCodexPaneHooks,
} from '../src/utils/codexHooks.js';

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const tempDir = tempDirs.pop();
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
});

describe('codexHooks', () => {
  it('uses the supported hooks feature flag when enabling Codex hooks', () => {
    expect(enableCodexHooksFlag('codex resume --last')).toBe(
      `codex ${CODEX_ENABLE_HOOKS_FLAG} resume --last`
    );
  });

  it('prefixes exported qmux variables before enabling hooks', () => {
    expect(buildCodexHookedCommand('codex resume --last', {
      qmuxPaneId: 'qmux-1',
      tmuxPaneId: '%9',
      eventFile: '/tmp/qmux-event.json',
    })).toBe(
      "export QMUX_PANE_ID='qmux-1'; export QMUX_TMUX_PANE_ID='%9'; export QMUX_CODEX_HOOK_EVENT_FILE='/tmp/qmux-event.json'; codex --enable hooks resume --last"
    );
  });

  it('can enable the Codex goals feature alongside hooks', () => {
    expect(buildCodexHookedCommand('codex resume --last', {
      qmuxPaneId: 'qmux-1',
      tmuxPaneId: '%9',
    }, {
      enableGoals: true,
    })).toBe(
      `export QMUX_PANE_ID='qmux-1'; export QMUX_TMUX_PANE_ID='%9'; codex ${CODEX_ENABLE_HOOKS_FLAG} ${CODEX_ENABLE_GOALS_FLAG} resume --last`
    );
  });

  it('installs a Stop hook that always returns valid JSON output', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qmux-codex-hooks-'));
    tempDirs.push(tempDir);

    const result = installCodexPaneHooks({
      worktreePath: tempDir,
      qmuxPaneId: 'qmux-1',
      tmuxPaneId: '%9',
    });

    const hookScriptPath = path.join(tempDir, '.codex', 'hooks', 'qmux-stop-hook.cjs');
    const hooksConfig = JSON.parse(
      fs.readFileSync(path.join(tempDir, '.codex', 'hooks.json'), 'utf-8')
    );
    expect(hooksConfig.hooks.Stop[0].hooks[0].command).toBe(
      "node '.codex/hooks/qmux-stop-hook.cjs'"
    );

    const stopOutput = execFileSync('node', [hookScriptPath], {
      input: JSON.stringify({
        hook_event_name: 'Stop',
        turn_id: 'turn-1',
        stop_hook_active: true,
      }),
      encoding: 'utf-8',
      env: {
        ...process.env,
        QMUX_PANE_ID: 'qmux-1',
        QMUX_TMUX_PANE_ID: '%9',
        QMUX_CODEX_HOOK_EVENT_FILE: result.eventFile,
      },
    });

    expect(stopOutput).toBe('{}');
    expect(JSON.parse(fs.readFileSync(result.eventFile, 'utf-8'))).toMatchObject({
      source: 'codex-stop-hook',
      qmuxPaneId: 'qmux-1',
      tmuxPaneId: '%9',
      stopHookActive: true,
    });

    fs.rmSync(result.eventFile);

    const ignoredOutput = execFileSync('node', [hookScriptPath], {
      input: JSON.stringify({ hook_event_name: 'Stop' }),
      encoding: 'utf-8',
      env: {
        ...process.env,
        QMUX_PANE_ID: '',
        QMUX_TMUX_PANE_ID: '%10',
        QMUX_CODEX_HOOK_EVENT_FILE: '',
      },
    });

    expect(ignoredOutput).toBe('{}');
    expect(fs.existsSync(result.eventFile)).toBe(false);
  });
});
