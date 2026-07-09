import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildQmuxCommand,
  buildFilesOnlyCommand,
} from '../src/utils/qmuxCommand.js';
import { sanitizePathForInstalledQmux } from '../src/utils/pathEnvironment.js';

let tempDir: string | null = null;

afterEach(() => {
  if (tempDir) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
});

function makeExecutable(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, '#!/bin/sh\nexit 0\n');
  fs.chmodSync(filePath, 0o755);
}

describe('qmux command resolution', () => {
  it('uses an installed qmux executable instead of local worktree package shims', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qmux-command-'));
    const projectRoot = path.join(tempDir, 'repo');
    const installedBin = path.join(tempDir, 'installed-bin');
    const worktreeBin = path.join(projectRoot, '.qmux', 'worktrees', 'feature', 'node_modules', '.bin');
    const rootBin = path.join(projectRoot, 'node_modules', '.bin');

    makeExecutable(path.join(worktreeBin, 'qmux'));
    makeExecutable(path.join(rootBin, 'qmux'));
    makeExecutable(path.join(installedBin, 'qmux'));

    const originalPath = process.env.PATH;
    process.env.PATH = [worktreeBin, rootBin, installedBin].join(path.delimiter);

    try {
      expect(buildQmuxCommand([], projectRoot)).toBe(
        `env PATH='${installedBin}' '${path.join(installedBin, 'qmux')}'`
      );
      expect(buildFilesOnlyCommand(projectRoot)).toBe(
        `env PATH='${installedBin}' '${path.join(installedBin, 'qmux')}' --files-only`
      );
      expect(sanitizePathForInstalledQmux(process.env.PATH, projectRoot)).toBe(installedBin);
    } finally {
      process.env.PATH = originalPath;
    }
  });
});
