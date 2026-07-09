import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { migrateDmuxLegacyState } from '../src/utils/legacyMigration.js';

describe('migrateDmuxLegacyState (filesystem parts)', () => {
  let tmpRoot: string;
  let homeDir: string;
  let projectRoot: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qmux-legacy-migration-'));
    homeDir = path.join(tmpRoot, 'home');
    projectRoot = path.join(tmpRoot, 'project');
    fs.mkdirSync(homeDir, { recursive: true });
    fs.mkdirSync(projectRoot, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('renames ~/.dmux.global.json to ~/.qmux.global.json', () => {
    const legacyPath = path.join(homeDir, '.dmux.global.json');
    fs.writeFileSync(legacyPath, JSON.stringify({ aiProvider: 'openrouter' }));

    migrateDmuxLegacyState(projectRoot, { homeDir });

    const newPath = path.join(homeDir, '.qmux.global.json');
    expect(fs.existsSync(newPath)).toBe(true);
    expect(fs.existsSync(legacyPath)).toBe(false);
    expect(JSON.parse(fs.readFileSync(newPath, 'utf8'))).toEqual({ aiProvider: 'openrouter' });
  });

  it('does not overwrite ~/.qmux.global.json when it already exists', () => {
    const legacyPath = path.join(homeDir, '.dmux.global.json');
    const newPath = path.join(homeDir, '.qmux.global.json');
    fs.writeFileSync(legacyPath, JSON.stringify({ aiProvider: 'legacy' }));
    fs.writeFileSync(newPath, JSON.stringify({ aiProvider: 'current' }));

    migrateDmuxLegacyState(projectRoot, { homeDir });

    expect(JSON.parse(fs.readFileSync(newPath, 'utf8'))).toEqual({ aiProvider: 'current' });
    // Legacy file is left alone when the destination already exists.
    expect(fs.existsSync(legacyPath)).toBe(true);
  });

  it('renames ~/.dmux/ to ~/.qmux/ preserving contents', () => {
    const legacyDir = path.join(homeDir, '.dmux');
    fs.mkdirSync(path.join(legacyDir, 'native-helper'), { recursive: true });
    fs.writeFileSync(path.join(legacyDir, 'native-helper', 'marker.txt'), 'hello');

    migrateDmuxLegacyState(projectRoot, { homeDir });

    const newDir = path.join(homeDir, '.qmux');
    expect(fs.existsSync(legacyDir)).toBe(false);
    expect(fs.readFileSync(path.join(newDir, 'native-helper', 'marker.txt'), 'utf8')).toBe('hello');
  });

  it('skips the home .dmux rename when ~/.qmux already exists', () => {
    const legacyDir = path.join(homeDir, '.dmux');
    const newDir = path.join(homeDir, '.qmux');
    fs.mkdirSync(legacyDir, { recursive: true });
    fs.mkdirSync(newDir, { recursive: true });
    fs.writeFileSync(path.join(legacyDir, 'marker.txt'), 'legacy');

    migrateDmuxLegacyState(projectRoot, { homeDir });

    expect(fs.existsSync(legacyDir)).toBe(true);
    expect(fs.existsSync(path.join(newDir, 'marker.txt'))).toBe(false);
  });

  it('renames <projectRoot>/.dmux/ to .qmux/ and dmux.config.json to qmux.config.json', () => {
    const legacyDir = path.join(projectRoot, '.dmux');
    fs.mkdirSync(legacyDir, { recursive: true });
    fs.writeFileSync(
      path.join(legacyDir, 'dmux.config.json'),
      JSON.stringify({ panes: [] })
    );

    migrateDmuxLegacyState(projectRoot, { homeDir });

    const newDir = path.join(projectRoot, '.qmux');
    const newConfig = path.join(newDir, 'qmux.config.json');
    expect(fs.existsSync(legacyDir)).toBe(false);
    expect(fs.existsSync(newConfig)).toBe(true);
    expect(JSON.parse(fs.readFileSync(newConfig, 'utf8'))).toEqual({ panes: [] });
  });

  it('renames <projectRoot>/.dmux-hooks/ to .qmux-hooks/ and rewrites env vars + paths inside hook scripts', () => {
    const legacyHooksDir = path.join(projectRoot, '.dmux-hooks');
    fs.mkdirSync(legacyHooksDir, { recursive: true });
    const hookScript = [
      '#!/usr/bin/env bash',
      'cd "$DMUX_WORKTREE_PATH"',
      'echo "$DMUX_ROOT/.dmux/hooks"',
    ].join('\n');
    fs.writeFileSync(path.join(legacyHooksDir, 'worktree_created'), hookScript);

    migrateDmuxLegacyState(projectRoot, { homeDir });

    const newHooksDir = path.join(projectRoot, '.qmux-hooks');
    expect(fs.existsSync(legacyHooksDir)).toBe(false);
    const rewritten = fs.readFileSync(path.join(newHooksDir, 'worktree_created'), 'utf8');
    expect(rewritten).toContain('$QMUX_WORKTREE_PATH');
    expect(rewritten).toContain('$QMUX_ROOT/.qmux/hooks');
    expect(rewritten).not.toContain('DMUX_');
    expect(rewritten).not.toContain('.dmux/');
  });

  it('is idempotent: a second call after a full migration is a no-op that does not throw', () => {
    const legacyPath = path.join(homeDir, '.dmux.global.json');
    fs.writeFileSync(legacyPath, JSON.stringify({ aiProvider: 'openrouter' }));
    const legacyDir = path.join(projectRoot, '.dmux');
    fs.mkdirSync(legacyDir, { recursive: true });
    fs.writeFileSync(path.join(legacyDir, 'dmux.config.json'), JSON.stringify({ panes: [] }));

    migrateDmuxLegacyState(projectRoot, { homeDir });
    expect(() => migrateDmuxLegacyState(projectRoot, { homeDir })).not.toThrow();

    // State from the first run is untouched by the second, no-op run.
    expect(fs.existsSync(path.join(homeDir, '.qmux.global.json'))).toBe(true);
    expect(fs.existsSync(path.join(projectRoot, '.qmux', 'qmux.config.json'))).toBe(true);
  });

  it('never throws even if the project root does not exist', () => {
    const missingRoot = path.join(tmpRoot, 'does-not-exist');
    expect(() => migrateDmuxLegacyState(missingRoot, { homeDir })).not.toThrow();
  });
});
