/**
 * Control-pane placement: where the qmux control pane (sidebar) is anchored and
 * how thick it is.
 *
 * - `left` (default): a fixed-WIDTH sidebar on the left (thickness = columns, 40).
 * - `bottom`: a fixed-HEIGHT strip across the bottom (thickness = rows, default 3:
 *   one line of shortcuts + one row of pane cards + one rotating tip line).
 *
 * The pure sanitize/clamp helpers are used by `settingsManager`; the imported
 * bindings below are only referenced inside `getControlPanePlacement`, so the
 * settingsManager ↔ this-module ES import cycle is evaluation-safe.
 * `getControlPanePlacement` reads the layered settings and is the single source
 * of truth every layout path consults.
 */
import { SettingsManager } from './settingsManager.js';
import { StateManager } from '../shared/StateManager.js';

export type ControlPanePosition = 'left' | 'bottom';

export const SIDEBAR_WIDTH_DEFAULT = 40;
export const DEFAULT_CONTROL_PANE_HEIGHT = 3;
export const MIN_CONTROL_PANE_HEIGHT = 2;
export const MAX_CONTROL_PANE_HEIGHT = 8;

/** Coerce arbitrary input into a valid control-pane position (default 'left'). */
export function sanitizeControlPanePosition(value: unknown): ControlPanePosition {
  return value === 'bottom' ? 'bottom' : 'left';
}

/** Clamp a control-pane height (rows) into [MIN, MAX], defaulting on garbage. */
export function clampControlPaneHeight(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_CONTROL_PANE_HEIGHT;
  }
  const rounded = Math.round(value);
  return Math.max(MIN_CONTROL_PANE_HEIGHT, Math.min(MAX_CONTROL_PANE_HEIGHT, rounded));
}

export interface ControlPanePlacement {
  position: ControlPanePosition;
  /** The reserved dimension for the active position: width (left) or height (bottom). */
  thickness: number;
}

/**
 * Resolve the effective control-pane placement from layered settings.
 *
 * Imports are done lazily to keep this module dependency-light and to avoid any
 * import-cycle surprises with the settings/layout stack.
 */
export function getControlPanePlacement(projectRoot?: string): ControlPanePlacement {
  try {
    const root =
      projectRoot || StateManager.getInstance().getState().projectRoot || process.cwd();
    const settings = new SettingsManager(root).getSettings();
    const position = sanitizeControlPanePosition(settings.controlPanePosition);
    const thickness =
      position === 'bottom'
        ? clampControlPaneHeight(settings.controlPaneHeight)
        : SIDEBAR_WIDTH_DEFAULT;
    return { position, thickness };
  } catch {
    return { position: 'left', thickness: SIDEBAR_WIDTH_DEFAULT };
  }
}
