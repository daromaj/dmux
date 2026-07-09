import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createHash } from 'crypto';
import { execSync } from 'child_process';

/**
 * Best-effort, idempotent, run-once-early migration of on-disk / tmux state
 * left over from the pre-rebrand `dmux` binary to the new `qmux` naming.
 *
 * Every step is wrapped in try/catch: a failure here must never prevent qmux
 * from starting. Each step only acts when the legacy path/session exists AND
 * the new path/session does not already exist, which makes repeated calls
 * (across `qmux` invocations) safe no-ops after the first successful run.
 */
export interface MigrateDmuxLegacyStateOptions {
  /** Override for os.homedir(), exposed for tests. */
  homeDir?: string;
}

export function migrateDmuxLegacyState(
  projectRoot: string,
  options: MigrateDmuxLegacyStateOptions = {}
): void {
  const homeDir = options.homeDir ?? safeHomedir();
  migrateHomeGlobalSettingsFile(homeDir);
  migrateHomeDmuxDir(homeDir);
  migrateProjectDmuxDir(projectRoot);
  migrateProjectHooksDir(projectRoot);
  migrateTmuxSession(projectRoot);
}

function safeHomedir(): string | undefined {
  try {
    return os.homedir();
  } catch {
    return undefined;
  }
}

/** Rename ~/.dmux.global.json -> ~/.qmux.global.json (only if dest is missing). */
function migrateHomeGlobalSettingsFile(home: string | undefined): void {
  try {
    if (!home) return;
    const legacyPath = path.join(home, '.dmux.global.json');
    const newPath = path.join(home, '.qmux.global.json');
    renameIfLegacyOnly(legacyPath, newPath);
  } catch {
    // best-effort
  }
}

/** Rename ~/.dmux/ -> ~/.qmux/ (only if dest is missing). */
function migrateHomeDmuxDir(home: string | undefined): void {
  try {
    if (!home) return;
    const legacyDir = path.join(home, '.dmux');
    const newDir = path.join(home, '.qmux');
    renameIfLegacyOnly(legacyDir, newDir);
  } catch {
    // best-effort
  }
}

/**
 * Rename <projectRoot>/.dmux/ -> <projectRoot>/.qmux/ (only if dest is
 * missing), then rename the config file inside from dmux.config.json to
 * qmux.config.json.
 */
function migrateProjectDmuxDir(projectRoot: string): void {
  try {
    const legacyDir = path.join(projectRoot, '.dmux');
    const newDir = path.join(projectRoot, '.qmux');
    renameIfLegacyOnly(legacyDir, newDir);

    // Whether or not the directory itself was just renamed, fix up a
    // lingering legacy config filename inside whichever dir now exists.
    const dirToCheck = fs.existsSync(newDir) ? newDir : (fs.existsSync(legacyDir) ? legacyDir : null);
    if (dirToCheck) {
      const legacyConfig = path.join(dirToCheck, 'dmux.config.json');
      const newConfig = path.join(dirToCheck, 'qmux.config.json');
      renameIfLegacyOnly(legacyConfig, newConfig);
    }
  } catch {
    // best-effort
  }
}

/**
 * Rename <projectRoot>/.dmux-hooks/ -> <projectRoot>/.qmux-hooks/ (only if
 * dest is missing), then rewrite DMUX_ -> QMUX_ and .dmux -> .qmux inside
 * every hook script so the migrated hooks keep working.
 */
function migrateProjectHooksDir(projectRoot: string): void {
  try {
    const legacyDir = path.join(projectRoot, '.dmux-hooks');
    const newDir = path.join(projectRoot, '.qmux-hooks');
    const didRename = renameIfLegacyOnly(legacyDir, newDir);
    // Only rewrite scripts inside a directory we just migrated; avoid
    // touching a dir that was already fully qmux-native.
    if (didRename) {
      rewriteHookScriptsInDir(newDir);
    }
  } catch {
    // best-effort
  }
}

function rewriteHookScriptsInDir(dir: string): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    try {
      if (entry.isDirectory()) {
        rewriteHookScriptsInDir(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      const original = fs.readFileSync(fullPath, 'utf8');
      if (!/DMUX_|\.dmux/.test(original)) continue;
      const rewritten = original
        .split('DMUX_').join('QMUX_')
        .split('.dmux').join('.qmux');
      if (rewritten !== original) {
        fs.writeFileSync(fullPath, rewritten, 'utf8');
      }
    } catch {
      // best-effort: skip this file, keep going
    }
  }
}

/**
 * If a `qmux-<id>` tmux session doesn't exist yet but the equivalent legacy
 * `dmux-<id>` session does, rename it in place so the running session is
 * picked up under the new name.
 */
function migrateTmuxSession(projectRoot: string): void {
  try {
    const projectName = path.basename(projectRoot);
    const projectHash = createHash('md5').update(projectRoot).digest('hex').substring(0, 8);
    const projectIdentifier = `${projectName}-${projectHash}`;
    const sanitizedProjectIdentifier = projectIdentifier.replace(/[^a-zA-Z0-9_-]+/g, '-');
    const newSessionName = `qmux-${sanitizedProjectIdentifier}`;
    const legacySessionName = `dmux-${sanitizedProjectIdentifier}`;

    if (tmuxSessionExists(newSessionName)) return;
    if (!tmuxSessionExists(legacySessionName)) return;

    execSync(`tmux rename-session -t '${legacySessionName}' '${newSessionName}'`, { stdio: 'pipe' });
  } catch {
    // best-effort: tmux may not be running, session may not exist, etc.
  }
}

function tmuxSessionExists(sessionName: string): boolean {
  try {
    execSync(`tmux has-session -t '${sessionName}'`, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Rename legacyPath -> newPath only when newPath is missing and legacyPath
 * exists. Returns true if a rename happened.
 */
function renameIfLegacyOnly(legacyPath: string, newPath: string): boolean {
  try {
    if (fs.existsSync(newPath)) return false;
    if (!fs.existsSync(legacyPath)) return false;
    fs.renameSync(legacyPath, newPath);
    return true;
  } catch {
    return false;
  }
}
