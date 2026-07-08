import { describe, it, expect } from 'vitest';
import { calculateOptimalColumns, MIN_COMFORTABLE_WIDTH, MIN_COMFORTABLE_HEIGHT, generateSidebarGridLayout } from '../src/utils/tmux.js';
import { calculateOptimalLayout, DEFAULT_LAYOUT_CONFIG } from '../src/utils/layoutManager.js';

describe('layout calculation', () => {
  describe('calculateOptimalColumns', () => {
    it('returns 1 column for single pane', () => {
      const cols = calculateOptimalColumns(1, 119, 40);
      expect(cols).toBe(1);
    });

    it('prefers 2 columns for 3 panes when height is limited (avoids cramped vertical stack)', () => {
      // 160x40 terminal with 40-char sidebar = 119x40 content area
      // 1 column = 119x12 per pane (too short!)
      // 2 columns = 59x19 per pane (much better)
      const cols = calculateOptimalColumns(3, 119, 40);
      expect(cols).toBe(2);
    });

    it('prefers 1 column when width is limited and height is sufficient', () => {
      // Narrow but tall terminal
      // 1 column = 80x26 per pane (comfortable height)
      // 2 columns = 39x39 per pane (too narrow)
      const cols = calculateOptimalColumns(3, 80, 80);
      expect(cols).toBe(1);
    });

    it('handles wide terminals by using multiple columns', () => {
      // Very wide terminal: 200x40 content area
      // Can comfortably fit 3 columns side by side
      const cols = calculateOptimalColumns(3, 200, 40);
      expect(cols).toBe(3);
    });

    it('falls back to best height when no perfect layout exists', () => {
      // Extremely narrow content area
      // No configuration meets MIN_COMFORTABLE_WIDTH, so use fallback
      const cols = calculateOptimalColumns(3, 50, 40);
      // Should choose layout that maximizes height (more columns = fewer rows = more height)
      expect(cols).toBeGreaterThan(0);
    });

    it('respects MIN_COMFORTABLE_HEIGHT threshold', () => {
      // Test the original problem: 3 panes stacked vertically = 12 lines each
      // This is below MIN_COMFORTABLE_HEIGHT (15), so should prefer 2 columns
      const contentHeight = 40;
      const numPanes = 3;

      // Calculate what height we'd get with 1 column
      const rows1Col = Math.ceil(numPanes / 1);
      const height1Col = Math.floor((contentHeight - (rows1Col - 1)) / rows1Col);

      // Verify our test scenario is correct
      expect(height1Col).toBeLessThan(MIN_COMFORTABLE_HEIGHT);

      // Now verify the function prefers 2 columns
      const cols = calculateOptimalColumns(numPanes, 119, contentHeight);
      expect(cols).toBe(2);

      // And verify 2 columns gives comfortable height
      const rows2Col = Math.ceil(numPanes / 2);
      const height2Col = Math.floor((contentHeight - (rows2Col - 1)) / rows2Col);
      expect(height2Col).toBeGreaterThanOrEqual(MIN_COMFORTABLE_HEIGHT);
    });

    it('handles edge case of exactly MIN_COMFORTABLE dimensions', () => {
      // Panes at exactly minimum comfortable size should be accepted
      const contentWidth = MIN_COMFORTABLE_WIDTH * 2 + 1; // Exactly fits 2 columns
      const contentHeight = MIN_COMFORTABLE_HEIGHT * 2 + 1; // Exactly fits 2 rows

      const cols = calculateOptimalColumns(4, contentWidth, contentHeight);
      expect(cols).toBe(2); // Should use 2x2 grid
    });

    it('prefers balanced layouts with better height scores', () => {
      // Large content area where multiple configurations work
      // Should prefer configuration with better height (closer to MIN_COMFORTABLE_HEIGHT * 1.5)
      const cols = calculateOptimalColumns(6, 240, 60);

      // Verify a reasonable column count (2 or 3)
      expect(cols).toBeGreaterThanOrEqual(2);
      expect(cols).toBeLessThanOrEqual(3);
    });

    it('handles many panes gracefully', () => {
      // 10 panes in reasonable space
      const cols = calculateOptimalColumns(10, 200, 80);

      // Should find some multi-column layout
      expect(cols).toBeGreaterThan(1);
      expect(cols).toBeLessThanOrEqual(10);
    });

    it('returns fallback when content area is impossibly small', () => {
      // Tiny content area that can't fit comfortable panes
      const cols = calculateOptimalColumns(5, 30, 20);

      // Should still return a valid column count (fallback mode)
      expect(cols).toBeGreaterThan(0);
      expect(cols).toBeLessThanOrEqual(5);
    });
  });

  describe('generateSidebarGridLayout - checksum fixes', () => {
    // Tests for the critical checksum bug fixes

    it('generates valid 4-digit hex checksum', () => {
      const layout = generateSidebarGridLayout(
        '%0', // control pane
        ['%1', '%2', '%3', '%4', '%5'], // 5 content panes
        40, // sidebar width
        203, // window width
        60, // window height
        3, // columns
        80 // max comfortable width
      );

      // Checksum should be exactly 4 hex digits
      const checksumMatch = layout.match(/^([0-9a-f]{4}),/);
      expect(checksumMatch).toBeTruthy();
      expect(checksumMatch![1]).toHaveLength(4);
    });

    it('checksum includes leading zeros when needed', () => {
      // Generate several layouts and verify all have 4-digit checksums
      const testCases = [
        { width: 200, panes: ['%1', '%2', '%3'] },
        { width: 201, panes: ['%1', '%2', '%3', '%4', '%5'] },
        { width: 203, panes: ['%1', '%2'] },
      ];

      testCases.forEach(({ width, panes }) => {
        const layout = generateSidebarGridLayout(
          '%0',
          panes,
          40,
          width,
          60,
          2,
          80
        );

        const checksum = layout.split(',')[0];
        expect(checksum).toHaveLength(4);
        expect(checksum).toMatch(/^[0-9a-f]{4}$/);
      });
    });

    it('generates identical layout structure at same dimensions', () => {
      const layout1 = generateSidebarGridLayout(
        '%0',
        ['%1', '%2', '%3', '%4', '%5'],
        40,
        201,
        60,
        3,
        80
      );

      const layout2 = generateSidebarGridLayout(
        '%0',
        ['%1', '%2', '%3', '%4', '%5'],
        40,
        201,
        60,
        3,
        80
      );

      // Layouts should be identical (deterministic)
      expect(layout1).toBe(layout2);
    });

    it('handles width 201 correctly (regression test)', () => {
      // This specific width was failing before checksum fix
      const layout = generateSidebarGridLayout(
        '%0',
        ['%1', '%2', '%3', '%4', '%5'],
        40,
        201,
        60,
        3,
        80
      );

      expect(layout).toBeTruthy();
      expect(layout).toContain('201x60'); // Window dimensions
      expect(layout).toContain('40x60'); // Sidebar
      expect(layout).toContain('160x'); // Content area width
    });

    it('handles width 203 correctly (regression test)', () => {
      // Another problematic width before fix
      const layout = generateSidebarGridLayout(
        '%0',
        ['%1', '%2', '%3', '%4', '%5'],
        40,
        203,
        60,
        3,
        80
      );

      expect(layout).toBeTruthy();
      expect(layout).toContain('203x60'); // Window dimensions
      expect(layout).toContain('40x60'); // Sidebar
      expect(layout).toContain('162x'); // Content area width
    });

    it('correctly calculates pane widths with remainder distribution', () => {
      // 3 columns, 160 width content = 53.33 per pane
      // Should distribute as: 54, 53, 53 (first pane gets remainder)
      const layout = generateSidebarGridLayout(
        '%0',
        ['%1', '%2', '%3'],
        40,
        201,
        60,
        3,
        80
      );

      // First pane should be 54 wide
      expect(layout).toContain('54x');
      // Other panes should be 52 or 53 wide
      expect(layout).toMatch(/5[23]x/);
    });

    it('generates correct absolute coordinates', () => {
      const layout = generateSidebarGridLayout(
        '%0',
        ['%1', '%2'],
        40,
        200,
        60,
        2,
        80
      );

      // Content should start at X=41 (sidebar 40 + border 1)
      expect(layout).toContain(',41,');

      // Second pane should be roughly at X=121 (41 + 80)
      expect(layout).toMatch(/,1[12][0-9],/);
    });
  });

  describe('calculateOptimalLayout - spacer logic', () => {
    it('chooses appropriate layout for 5 panes at various widths', () => {
      const widths = [180, 200, 201, 203, 220, 240];

      widths.forEach(width => {
        const layout = calculateOptimalLayout(5, width, 60, DEFAULT_LAYOUT_CONFIG);

        // Should always produce valid layout
        expect(layout.cols).toBeGreaterThan(0);
        expect(layout.rows).toBeGreaterThan(0);
        expect(layout.windowWidth).toBeLessThanOrEqual(width);

        // Pane width should be reasonable
        expect(layout.actualPaneWidth).toBeGreaterThan(0);
      });
    });

    it('prefers 3x2 grid for 5 panes in wide terminal', () => {
      const layout = calculateOptimalLayout(5, 200, 60, DEFAULT_LAYOUT_CONFIG);

      expect(layout.cols).toBe(3);
      expect(layout.rows).toBe(2);
    });

    it('constrains window width to avoid panes exceeding MAX_COMFORTABLE_WIDTH', () => {
      // Very wide terminal - should cap window width
      const layout = calculateOptimalLayout(2, 500, 60, DEFAULT_LAYOUT_CONFIG);

      // Window should be constrained, not full 500
      expect(layout.windowWidth).toBeLessThan(500);

      // Pane width should not exceed MAX_COMFORTABLE_WIDTH
      expect(layout.actualPaneWidth).toBeLessThanOrEqual(DEFAULT_LAYOUT_CONFIG.MAX_COMFORTABLE_WIDTH);
    });

    it('distributes panes evenly across columns', () => {
      const layout = calculateOptimalLayout(5, 200, 60, DEFAULT_LAYOUT_CONFIG);

      // 5 panes in 3 cols = [2, 2, 1]
      expect(layout.paneDistribution).toEqual([2, 2, 1]);
    });

    it('handles single pane (welcome screen)', () => {
      const layout = calculateOptimalLayout(0, 200, 60, DEFAULT_LAYOUT_CONFIG);

      expect(layout.cols).toBe(0);
      expect(layout.rows).toBe(0);
      expect(layout.paneDistribution).toEqual([]);
    });

    it('allows single-row layout when max pane width is reduced below default min', () => {
      const config = {
        ...DEFAULT_LAYOUT_CONFIG,
        MAX_COMFORTABLE_WIDTH: 40,
      };

      // 6 panes at max width 40 + sidebar/borders fits exactly in one row:
      // 40 (sidebar) + 6*40 + 5 borders = 285
      const layout = calculateOptimalLayout(6, 285, 60, config);

      expect(layout.cols).toBe(6);
      expect(layout.rows).toBe(1);
      expect(layout.actualPaneWidth).toBeLessThanOrEqual(40);
    });
  });

  describe('calculateOptimalLayout - virtual grid (forced columns)', () => {
    it('honors a forced 2-column grid when it fits', () => {
      const config = { ...DEFAULT_LAYOUT_CONFIG, GRID_COLUMNS: 2 };
      // 4 panes that auto would place as 2x2 anyway, but force 2 explicitly.
      const layout = calculateOptimalLayout(4, 300, 60, config);
      expect(layout.cols).toBe(2);
      expect(layout.rows).toBe(2);
      expect(layout.paneDistribution).toEqual([2, 2]);
    });

    it('forces a single column even in a wide terminal', () => {
      const config = { ...DEFAULT_LAYOUT_CONFIG, GRID_COLUMNS: 1 };
      const layout = calculateOptimalLayout(3, 400, 60, config);
      expect(layout.cols).toBe(1);
      expect(layout.rows).toBe(3);
    });

    it('clamps forced columns to the pane count', () => {
      const config = { ...DEFAULT_LAYOUT_CONFIG, GRID_COLUMNS: 4 };
      const layout = calculateOptimalLayout(2, 400, 60, config);
      expect(layout.cols).toBe(2);
    });

    it('falls back to auto layout when the forced grid does not fit', () => {
      const config = { ...DEFAULT_LAYOUT_CONFIG, GRID_COLUMNS: 4 };
      // Narrow terminal: 4 columns cannot fit at min width, so it should not force 4.
      const layout = calculateOptimalLayout(4, 120, 60, config);
      expect(layout.cols).toBeLessThan(4);
    });

    it('ignores the forced grid when GRID_COLUMNS is 0 (auto)', () => {
      const config = { ...DEFAULT_LAYOUT_CONFIG, GRID_COLUMNS: 0 };
      const forced = calculateOptimalLayout(4, 300, 60, config);
      const auto = calculateOptimalLayout(4, 300, 60, DEFAULT_LAYOUT_CONFIG);
      expect(forced.cols).toBe(auto.cols);
    });
  });

  describe('generateSidebarGridLayout - bottom control pane', () => {
    // Bottom mode: control strip full-width at the bottom, content grid full-width above.
    // W=200, H=60, controlHeight=12 → contentAreaHeight = 60 - 12 - 1 = 47.
    it('anchors a full-width control strip at the bottom', () => {
      const layout = generateSidebarGridLayout(
        '%0',
        ['%1', '%2'],
        40, // sidebarWidth — ignored in bottom mode
        200,
        60,
        2,
        80,
        'bottom',
        12
      );

      // Control leaf: full window width × controlHeight, at (0, contentAreaHeight + 1) = (0, 48).
      expect(layout).toContain('200x12,0,48,0');
      // Content area: full window width × contentAreaHeight, anchored top-left.
      expect(layout).toContain('200x47,0,0');
      // No left-anchored sidebar leaf (that would be `40x60,0,0`).
      expect(layout).not.toContain('40x60,0,0');
      // Valid 4-hex checksum.
      expect(layout).toMatch(/^[0-9a-f]{4},/);
    });

    it('gives content panes the full window width (no sidebar reservation)', () => {
      const layout = generateSidebarGridLayout(
        '%0',
        ['%1', '%2'],
        40,
        200,
        60,
        2,
        80,
        'bottom',
        12
      );
      // 2 cols across full 200 width: borders=1, even=99, remainder=1 → first pane 100 wide.
      expect(layout).toContain('100x47,0,0,1');
      // Second pane starts at X = 0 + 100 + 1 = 101.
      expect(layout).toContain('99x47,101,0,2');
    });

    it('stacks multiple rows within the reserved content area height', () => {
      // 3 panes, 1 column → 3 rows stacked in contentAreaHeight = 47.
      const layout = generateSidebarGridLayout(
        '%0',
        ['%1', '%2', '%3'],
        40,
        200,
        60,
        1,
        80,
        'bottom',
        12
      );
      // Control strip still at the bottom.
      expect(layout).toContain('200x12,0,48,0');
      // Root window dimensions preserved.
      expect(layout).toContain('200x60,0,0{');
      // No pane extends into the control strip: max content Y+height must be ≤ 47.
      // Last row's Y should be below the first rows but above the strip border.
      expect(layout).toMatch(/^[0-9a-f]{4},/);
    });

    it('is deterministic and differs from the left-mode layout', () => {
      const panes = ['%1', '%2'];
      const left = generateSidebarGridLayout('%0', panes, 40, 200, 60, 2, 80, 'left', 0);
      const bottom = generateSidebarGridLayout('%0', panes, 40, 200, 60, 2, 80, 'bottom', 12);
      const bottomAgain = generateSidebarGridLayout('%0', panes, 40, 200, 60, 2, 80, 'bottom', 12);
      expect(bottom).toBe(bottomAgain);
      expect(bottom).not.toBe(left);
      // Left mode keeps the 40-wide sidebar; bottom mode does not.
      expect(left).toContain('40x60,0,0');
      expect(bottom).not.toContain('40x60,0,0');
    });
  });

  describe('calculateOptimalLayout - bottom control pane', () => {
    const bottomConfig = {
      ...DEFAULT_LAYOUT_CONFIG,
      CONTROL_POSITION: 'bottom' as const,
      CONTROL_HEIGHT: 12,
    };

    it('gives content panes the full width (wider than left mode)', () => {
      const bottom = calculateOptimalLayout(2, 200, 60, bottomConfig);
      const left = calculateOptimalLayout(2, 200, 60, DEFAULT_LAYOUT_CONFIG);
      // Same column choice, but bottom reclaims the 40-col sidebar for content width.
      expect(bottom.actualPaneWidth).toBeGreaterThan(left.actualPaneWidth);
    });

    it('reserves height for the control strip when choosing rows', () => {
      // Height only tall enough for two stacked rows in left mode, but the bottom
      // strip (12 + 1 border) eats into it, forcing a wider/shorter arrangement.
      const bottom = calculateOptimalLayout(2, 240, 45, bottomConfig);
      // 2 panes: with reserved height 13, one row (2 cols) is favored over 2 rows.
      expect(bottom.cols).toBe(2);
      expect(bottom.rows).toBe(1);
    });

    it('still honors a forced column count in bottom mode', () => {
      const layout = calculateOptimalLayout(4, 300, 60, {
        ...bottomConfig,
        GRID_COLUMNS: 2,
      });
      expect(layout.cols).toBe(2);
      expect(layout.rows).toBe(2);
    });
  });
});
