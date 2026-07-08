/**
 * TOGGLE_GOAL_MODE Action - Toggle goal mode for a pane
 */

import type { DmuxPane } from '../../types.js';
import type { ActionResult, ActionContext } from '../types.js';
import { getPaneDisplayName } from '../../utils/paneTitle.js';

/**
 * Toggle goal mode for a pane.
 *
 * Goal mode affects how a supported agent is launched (session goal command),
 * so a mid-session toggle takes effect the next time the agent is launched.
 */
export async function toggleGoalMode(
  pane: DmuxPane,
  context: ActionContext
): Promise<ActionResult> {
  try {
    const paneName = getPaneDisplayName(pane);
    const newGoalModeState = !pane.goalMode;

    const updatedPanes = context.panes.map(p =>
      p.id === pane.id ? { ...p, goalMode: newGoalModeState } : p
    );

    await context.savePanes(updatedPanes);

    if (context.onPaneUpdate) {
      context.onPaneUpdate({ ...pane, goalMode: newGoalModeState });
    }

    return {
      type: 'success',
      message: `Goal mode ${newGoalModeState ? 'enabled' : 'disabled'} for "${paneName}" (applies on next agent launch)`,
      dismissable: true,
    };
  } catch (error) {
    return {
      type: 'error',
      message: `Failed to toggle goal mode: ${error instanceof Error ? error.message : 'Unknown error'}`,
      dismissable: true,
    };
  }
}
