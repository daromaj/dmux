import type { QmuxThemeName } from '../types.js';

export const QMUX_THEME_NAMES = [
  'red',
  'blue',
  'yellow',
  'orange',
  'green',
  'purple',
  'cyan',
  'magenta',
] as const satisfies readonly QmuxThemeName[];

export const DEFAULT_QMUX_THEME: QmuxThemeName = 'orange';

export function isQmuxThemeName(value: unknown): value is QmuxThemeName {
  return typeof value === 'string' && (QMUX_THEME_NAMES as readonly string[]).includes(value);
}

export function normalizeQmuxTheme(value: unknown): QmuxThemeName {
  return isQmuxThemeName(value) ? value : DEFAULT_QMUX_THEME;
}
