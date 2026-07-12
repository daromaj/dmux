import { describe, it, expect } from 'vitest';
import { generatePresetLayout } from '../src/utils/tmux.js';

// Geometry used across the left-mode cases.
const SIDEBAR = 40;
const WIN_W = 200;
const WIN_H = 50;
// Left mode content-area box (see generateSidebarGridLayout math):
const LEFT_CONTENT_W = WIN_W - SIDEBAR - 1; // 159
const LEFT_CONTENT_X = SIDEBAR + 1; // 41
const LEFT_CONTENT_H = WIN_H; // 50

// Extract the pane ids embedded in every leaf (WxH,X,Y,ID). Containers end in
// `{` or `[`, so they are not matched.
function leafIds(layout: string): string[] {
  return [...layout.matchAll(/\d+x\d+,\d+,\d+,(\d+)/g)].map(m => m[1]).sort();
}

function hasValidChecksum(layout: string): boolean {
  return /^[0-9a-f]{4},/.test(layout);
}

describe('generatePresetLayout', () => {
  describe('2-pane presets (left mode)', () => {
    const control = '%1';
    const content = ['%2', '%3'];

    it('side-by-side builds a {} content split with both content ids', () => {
      const layout = generatePresetLayout(
        'side-by-side', control, content, SIDEBAR, WIN_W, WIN_H, 'left', 0
      );
      expect(layout).not.toBeNull();
      expect(hasValidChecksum(layout!)).toBe(true);
      // Content-area container uses left-right split {}.
      expect(layout).toContain(`${LEFT_CONTENT_W}x${LEFT_CONTENT_H},${LEFT_CONTENT_X},0{`);
      // Root wraps sidebar + content with {}.
      expect(layout).toContain(`${WIN_W}x${WIN_H},0,0{`);
      // Sidebar + both content panes all present.
      expect(leafIds(layout!)).toEqual(['1', '2', '3']);
    });

    it('stacked builds a [] content split with both content ids', () => {
      const layout = generatePresetLayout(
        'stacked', control, content, SIDEBAR, WIN_W, WIN_H, 'left', 0
      );
      expect(layout).not.toBeNull();
      expect(hasValidChecksum(layout!)).toBe(true);
      // Content-area container uses top-bottom split [].
      expect(layout).toContain(`${LEFT_CONTENT_W}x${LEFT_CONTENT_H},${LEFT_CONTENT_X},0[`);
      expect(leafIds(layout!)).toEqual(['1', '2', '3']);
    });
  });

  describe('3-pane presets (left mode)', () => {
    const control = '%1';
    const content = ['%2', '%3', '%4'];

    const horizontal = ['main-left', 'main-right'] as const;
    for (const preset of horizontal) {
      it(`${preset} builds a {} content split with all three content ids`, () => {
        const layout = generatePresetLayout(
          preset, control, content, SIDEBAR, WIN_W, WIN_H, 'left', 0
        );
        expect(layout).not.toBeNull();
        expect(hasValidChecksum(layout!)).toBe(true);
        expect(layout).toContain(`${LEFT_CONTENT_W}x${LEFT_CONTENT_H},${LEFT_CONTENT_X},0{`);
        // The stacked side column is a nested [] split.
        expect(layout).toContain('[');
        expect(leafIds(layout!)).toEqual(['1', '2', '3', '4']);
      });
    }

    const vertical = ['main-top', 'main-bottom'] as const;
    for (const preset of vertical) {
      it(`${preset} builds a [] content split with all three content ids`, () => {
        const layout = generatePresetLayout(
          preset, control, content, SIDEBAR, WIN_W, WIN_H, 'left', 0
        );
        expect(layout).not.toBeNull();
        expect(hasValidChecksum(layout!)).toBe(true);
        expect(layout).toContain(`${LEFT_CONTENT_W}x${LEFT_CONTENT_H},${LEFT_CONTENT_X},0[`);
        // The side-by-side row is a nested {} split.
        expect(layout).toContain('{');
        expect(leafIds(layout!)).toEqual(['1', '2', '3', '4']);
      });
    }
  });

  describe('bottom mode wrapping', () => {
    const control = '%1';
    const content = ['%2', '%3'];
    const CONTROL_H = 8;
    const BOTTOM_CONTENT_W = WIN_W; // 200
    const BOTTOM_CONTENT_H = WIN_H - CONTROL_H - 1; // 41

    it('wraps the content area above a full-width control strip', () => {
      const layout = generatePresetLayout(
        'side-by-side', control, content, SIDEBAR, WIN_W, WIN_H, 'bottom', CONTROL_H
      );
      expect(layout).not.toBeNull();
      expect(hasValidChecksum(layout!)).toBe(true);
      // Root is a top-bottom split (content over control strip).
      expect(layout).toContain(`${WIN_W}x${WIN_H},0,0[`);
      // Content-area box spans full width, reduced height.
      expect(layout).toContain(`${BOTTOM_CONTENT_W}x${BOTTOM_CONTENT_H},0,0{`);
      // Control strip leaf anchored at the bottom.
      expect(layout).toContain(`${WIN_W}x${CONTROL_H},0,${BOTTOM_CONTENT_H + 1},1`);
      expect(leafIds(layout!)).toEqual(['1', '2', '3']);
    });
  });

  describe('mismatched counts and unknown presets return null', () => {
    it('2-pane preset with 3 content panes -> null', () => {
      expect(
        generatePresetLayout('side-by-side', '%1', ['%2', '%3', '%4'], SIDEBAR, WIN_W, WIN_H)
      ).toBeNull();
      expect(
        generatePresetLayout('stacked', '%1', ['%2', '%3', '%4'], SIDEBAR, WIN_W, WIN_H)
      ).toBeNull();
    });

    it('3-pane preset with 2 content panes -> null', () => {
      for (const preset of ['main-left', 'main-right', 'main-top', 'main-bottom']) {
        expect(
          generatePresetLayout(preset, '%1', ['%2', '%3'], SIDEBAR, WIN_W, WIN_H)
        ).toBeNull();
      }
    });

    it('unknown / auto / empty preset -> null', () => {
      expect(generatePresetLayout('auto', '%1', ['%2', '%3'], SIDEBAR, WIN_W, WIN_H)).toBeNull();
      expect(generatePresetLayout('', '%1', ['%2', '%3'], SIDEBAR, WIN_W, WIN_H)).toBeNull();
      expect(generatePresetLayout('bogus', '%1', ['%2', '%3'], SIDEBAR, WIN_W, WIN_H)).toBeNull();
    });
  });
});
