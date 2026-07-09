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
 *
 * Transition compatibility: after moving state to the new `.qmux` names, we
 * leave a symlink behind at each old `.dmux` path pointing at the new one.
 * That keeps anything still referencing the old names working (an older
 * `dmux` binary, external scripts, muscle memory) and — because writes flow
 * through the symlink to the same real file — both names share one state
 * during the transition. The symlink is only created when the new path
 * exists and no node already occupies the legacy path.
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
    ensureBackCompatSymlink(legacyPath, newPath);
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
    ensureBackCompatSymlink(legacyDir, newDir);
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
      ensureBackCompatSymlink(legacyConfig, newConfig);
    }
    // Point the old directory name at the new one so `<root>/.dmux/...`
    // references still resolve into the real `.qmux` directory.
    ensureBackCompatSymlink(legacyDir, newDir);
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
    ensureBackCompatSymlink(legacyDir, newDir);
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

/**
 * Leave a backward-compat symlink at `legacyPath` pointing at `newPath`, so
 * old `.dmux*` references keep resolving to the real `.qmux*` state during the
 * transition. No-op unless `newPath` exists and nothing already occupies
 * `legacyPath` (a real file/dir OR an existing symlink, valid or dangling).
 * The link target is stored relatively (legacy and new always share a parent),
 * so it survives the parent directory being moved.
 */
function ensureBackCompatSymlink(legacyPath: string, newPath: string): void {
  try {
    if (!fs.existsSync(newPath)) return;
    if (pathNodeExists(legacyPath)) return;
    const target = path.basename(newPath);
    const type = fs.statSync(newPath).isDirectory() ? 'dir' : 'file';
    fs.symlinkSync(target, legacyPath, type);
  } catch {
    // best-effort: symlinks may be unsupported or racing another process
  }
}

/**
 * True if a filesystem node exists at `p`, including a symlink whose target is
 * missing. Unlike fs.existsSync (which follows symlinks), this reports the link
 * node itself so we never try to create a symlink over an existing one.
 */
function pathNodeExists(p: string): boolean {
  try {
    fs.lstatSync(p);
    return true;
  } catch {
    return false;
  }
}
