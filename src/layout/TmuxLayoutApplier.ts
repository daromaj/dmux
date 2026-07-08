import { LogService } from '../services/LogService.js';
import { TmuxService } from '../services/TmuxService.js';
import { generateSidebarGridLayout } from '../utils/tmux.js';
import type { LayoutConfig } from '../utils/layoutManager.js';
import type { LayoutConfiguration } from './LayoutCalculator.js';

/**
 * TmuxLayoutApplier - Applies calculated layouts to tmux
 *
 * Responsibilities:
 * - Set tmux window dimensions
 * - Generate and apply tmux layout strings
 * - Handle layout application failures with fallbacks
 * - Resize control pane (sidebar)
 *
 * Does NOT:
 * - Calculate layouts (use LayoutCalculator)
 * - Manage spacer panes (use SpacerManager)
 * - Determine when layouts need recalculation
 */
export class TmuxLayoutApplier {
  private tmuxService = TmuxService.getInstance();

  constructor(private config: LayoutConfig) {}

  /**
   * Sets tmux window dimensions to match calculated layout
   *
   * Accounts for status bar height to prevent terminal scrolling.
   * Only resizes if dimensions have actually changed to prevent resize loops.
   *
   * @param width - Desired window width in cells
   * @param height - Desired terminal height in cells (will subtract status bar)
   */
  setWindowDimensions(width: number, height: number): void {
    try {
      // Subtract status bar height from the provided terminal height
      const statusBarHeight = this.tmuxService.getStatusBarHeightSync();
      const windowHeight = height - statusBarHeight;

      // Check if dimensions have actually changed
      const currentDims = this.tmuxService.getWindowDimensionsSync();
      if (currentDims.width === width && currentDims.height === windowHeight) {
        // Dimensions already correct, skip resize to prevent loops
        return;
      }

      // Use manual mode to constrain width, but also set height to match terminal
      this.tmuxService.setWindowOptionSync('window-size', 'manual');
      this.tmuxService.resizeWindowSync({ width, height: windowHeight });
    } catch (error) {
      // Log but don't fail - some tmux versions may not support this
      LogService.getInstance().warn(
        `Could not set window dimensions to ${width}x${height}: ${error}`,
        'Layout'
      );
    }
  }

  /**
   * Applies the calculated layout to tmux panes
   *
   * Strategy:
   * 1. Generate custom layout string using sidebar grid algorithm
   * 2. Apply layout via tmux select-layout
   * 3. Fallback to main-vertical if custom layout fails
   * 4. Ultimate fallback: just resize sidebar
   *
   * @param controlPaneId - ID of sidebar/control pane
   * @param contentPaneIds - IDs of content panes (in display order)
   * @param layout - Calculated layout configuration
   * @param terminalHeight - Terminal height in cells
   */
  applyPaneLayout(
    controlPaneId: string,
    contentPaneIds: string[],
    layout: LayoutConfiguration,
    terminalHeight: number
  ): void {
    const numContentPanes = contentPaneIds.length;

    if (numContentPanes === 0) {
      // No content panes, just resize sidebar
      this.resizeControlPane(controlPaneId);
      return;
    }

    try {
      // Always use custom layout string generation - unified approach for all cases
      // Use the calculated window dimensions, not current tmux dimensions (may be stale)
      const layoutString = generateSidebarGridLayout(
        controlPaneId,
        contentPaneIds,
        this.config.SIDEBAR_WIDTH,
        layout.windowWidth,
        terminalHeight,
        layout.cols,
        this.config.MAX_COMFORTABLE_WIDTH,
        this.config.CONTROL_POSITION,
        this.config.CONTROL_HEIGHT
      );

      if (layoutString) {
        // Log pane state right before applying layout
        this.logPaneState();

        // selectLayoutSync returns false on failure (doesn't throw)
        const success = this.tmuxService.selectLayoutSync(layoutString);
        if (!success) {
          // LogService.getInstance().debug('Layout application failed, using fallback', 'Layout');
          // Fallback to main-vertical if custom layout fails
          this.applyMainVerticalFallback();
        } else if (this.config.CONTROL_POSITION === 'bottom') {
          // tmux select-layout assigns pane-index order to cells in listing
          // order, ignoring the pane-ids written in the string, so the control
          // pane (index 0) lands in the FIRST/top cell instead of the bottom
          // strip. Swap it into the bottom strip cell to correct this.
          this.ensureControlAtBottom(controlPaneId);
        }
      } else {
        // Empty layout string - fallback to main-vertical
        // LogService.getInstance().debug('Empty layout string, using main-vertical fallback', 'Layout');
        this.applyMainVerticalFallback();
      }
    } catch (error) {
      // Fallback: just resize sidebar
      this.resizeControlPane(controlPaneId);
    }
  }

  /**
   * Ensures the control pane occupies the bottom strip cell in bottom mode.
   *
   * tmux `select-layout` maps pane-index order onto cells in the layout
   * string's listing order, ignoring the pane-ids written into the string.
   * The control pane is pane-index 0 (created first), so it always lands in
   * the first-listed (topmost) cell. We correct this by finding the pane that
   * currently occupies the bottom strip and swapping the control pane into it.
   *
   * This is stable across repeated enforcement: after the swap the control
   * pane holds the highest pane-index slot, so subsequent select-layout calls
   * keep placing it in the bottom strip — no oscillation.
   */
  private ensureControlAtBottom(controlPaneId: string): void {
    try {
      const positions = this.tmuxService.getPanePositionsSync();
      if (positions.length < 2) return;

      // The bottom strip is the pane with the greatest `top` coordinate.
      const bottomPane = positions.reduce((lowest, p) =>
        p.top > lowest.top ? p : lowest
      );

      if (bottomPane.paneId && bottomPane.paneId !== controlPaneId) {
        this.tmuxService.swapPaneSync(controlPaneId, bottomPane.paneId);
      }
    } catch (error) {
      LogService.getInstance().warn(
        `Could not move control pane to bottom strip: ${error}`,
        'Layout'
      );
    }
  }

  /**
   * Resizes the control pane (sidebar) to configured width
   * Used as ultimate fallback when layout application fails
   */
  private resizeControlPane(controlPaneId: string): void {
    try {
      this.tmuxService.resizePaneSync(
        controlPaneId,
        this.config.CONTROL_POSITION === 'bottom'
          ? { height: this.config.CONTROL_HEIGHT }
          : { width: this.config.SIDEBAR_WIDTH }
      );
    } catch (error) {
      LogService.getInstance().error(
        'Error resizing control pane',
        'Layout',
        undefined,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Applies main-vertical layout as fallback
   * Used when custom layout string generation or application fails
   */
  private applyMainVerticalFallback(): void {
    try {
      if (this.config.CONTROL_POSITION === 'bottom') {
        // Bottom mode: main-horizontal puts the "main" pane on top and the rest
        // below; pin the main-pane height so the control strip stays thin.
        this.tmuxService.setWindowOptionSync('main-pane-height', String(this.config.CONTROL_HEIGHT));
        this.tmuxService.selectLayoutSync('main-horizontal');
      } else {
        this.tmuxService.setWindowOptionSync('main-pane-width', String(this.config.SIDEBAR_WIDTH));
        this.tmuxService.selectLayoutSync('main-vertical');
      }
      // LogService.getInstance().debug('Fell back to edge-anchored layout', 'Layout');
    } catch (error) {
      LogService.getInstance().error(`Edge-anchored fallback failed: ${error}`, 'Layout');
    }
  }

  /**
   * Logs current pane state for debugging
   * Useful for diagnosing layout application failures
   */
  private logPaneState(): void {
    // Commented out to reduce log noise
    // try {
    //   const paneList = this.tmuxService.listPanesSync('#{pane_id}=#{pane_index}');
    //   LogService.getInstance().debug(`Panes right before layout apply: ${paneList}`, 'Layout');
    // } catch {
    //   // Ignore errors
    // }
  }
}
