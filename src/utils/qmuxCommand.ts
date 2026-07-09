import type { RemotePaneActionShortcut } from './remotePaneActions.js';
import {
  resolveInstalledQmuxExecutable,
  sanitizePathForInstalledQmux,
} from './pathEnvironment.js';

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function resolveQmuxExecutable(projectRoot?: string): string {
  return resolveInstalledQmuxExecutable({ projectRoot });
}

export function buildQmuxCommand(args: string[] = [], projectRoot?: string): string {
  const pathValue = sanitizePathForInstalledQmux(process.env.PATH || '', projectRoot);
  return [
    'env',
    `PATH=${shellQuote(pathValue)}`,
    shellQuote(resolveQmuxExecutable(projectRoot)),
    ...args,
  ].join(' ');
}

export function buildFilesOnlyCommand(projectRoot?: string): string {
  return buildQmuxCommand(['--files-only'], projectRoot);
}

export function buildRemotePaneActionCommand(
  shortcut: RemotePaneActionShortcut,
  projectRoot?: string
): string {
  return buildQmuxCommand(['--remote-pane-action', shortcut], projectRoot);
}
