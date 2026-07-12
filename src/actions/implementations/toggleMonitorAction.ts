/**
 * TOGGLE_MONITOR Action - Toggle Monitor (watchdog) mode for a pane
 */

import type { QmuxPane } from '../../types.js';
import type { ActionResult, ActionContext } from '../types.js';
import { getPaneDisplayName } from '../../utils/paneTitle.js';

/**
 * Toggle Monitor mode for a pane.
 *
 * Monitor mode is the periodic watchdog: every few minutes it recovers a
 * crashed agent (relaunch), nudges a stalled one to continue, and stops once
 * the task finishes. Distinct from `autopilot` (reactive dialog auto-accept).
 */
export async function toggleMonitor(
  pane: QmuxPane,
  context: ActionContext
): Promise<ActionResult> {
  try {
    const paneName = getPaneDisplayName(pane);
    const newMonitorState = !pane.monitor;

    const updatedPanes = context.panes.map(p =>
      p.id === pane.id ? { ...p, monitor: newMonitorState } : p
    );

    await context.savePanes(updatedPanes);

    if (context.onPaneUpdate) {
      context.onPaneUpdate({ ...pane, monitor: newMonitorState });
    }

    return {
      type: 'success',
      message: `Monitor ${newMonitorState ? 'enabled' : 'disabled'} for "${paneName}"${newMonitorState ? ' (watchdog will recover/nudge this pane)' : ''}`,
      dismissable: true,
    };
  } catch (error) {
    return {
      type: 'error',
      message: `Failed to toggle monitor: ${error instanceof Error ? error.message : 'Unknown error'}`,
      dismissable: true,
    };
  }
}
