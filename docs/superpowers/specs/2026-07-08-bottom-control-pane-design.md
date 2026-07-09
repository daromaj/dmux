# Design: bottom-positioned control pane

Date: 2026-07-08
Branch: `feat/custom-ai-provider`
Status: approved (design) — pending spec review

## Problem

The qmux control pane (the "sidebar") is a fixed 40-column strip anchored to the
**left**. For a user still learning qmux, a left sidebar is cramped for onboarding
help text, and a wide-but-short **bottom** strip reads more like a command/help bar.

Goal: allow the control pane to live at the **bottom** as a full-width, fixed-height
strip, opt-in via a setting. Left stays the default. Secondary goal: the bottom strip
surfaces prominent onboarding help (real shortcuts to add panes).

## Scope

- **In:** a `controlPanePosition: 'left' | 'bottom'` setting (default `left`); a
  `controlPaneHeight` setting (rows, default 12); the layout engine placing the control
  pane full-width at the bottom with the content grid stacked above; a horizontal pane
  list + prominent onboarding help in bottom mode.
- **Out:** free-form/draggable control-pane placement; top/right positions; per-project
  auto-switching; animated transitions.

## Approach

**Chosen:** extend the existing custom-layout-string machinery with a *position axis*.

qmux already builds a custom tmux layout string (`generateSidebarGridLayout` in
`src/utils/tmux.ts`) of the form `checksum,WxH,0,0{ leaf, container{grid} }` and applies
it via `TmuxLayoutApplier`. Left mode is a special case of "control pane on one edge,
content grid fills the rest". Adding a `bottom` branch reuses all of that: checksum,
spacer handling, grid column logic, enforcement loop.

Rejected alternatives:

- **Native tmux `main-horizontal` + `main-pane-height`:** puts the *main* content pane
  on top and tiles the rest below; it cannot give a clean single full-width bottom strip
  and it bypasses the virtual-grid column logic (`gridColumns`). Would regress that feature.
- **Separate tmux window for the control pane:** breaks the single-window mental model,
  the focus/attention token logic, and pane-jump navigation. Too invasive.

## Layout geometry

Let `W`,`H` = window width/height. Let `c` = control-pane thickness.

**Left (unchanged):** control leaf `c×H` at `(0,0)`; content container `(W−c−1)×H` at
`(c+1, 0)`; grid computed with `contentWidth = W−c−1`, `contentStartX = c+1`, full height.
Here `c = controlPaneSize` (columns, default 40).

**Bottom (new):** content container `W×(H−c−1)` at `(0,0)`; control leaf `W×c` at
`(0, H−c)`; grid computed with `contentWidth = W`, `contentStartX = 0`,
`contentHeight = H−c−1`. Here `c = controlPaneHeight` (rows, default 12). The `−1`
accounts for the tmux border between the content region and the control strip, mirroring
the existing left-mode border accounting.

The grid-cell logic (rows × `gridColumns`, spacer handling, even-width division) is
identical once it is fed the position-appropriate `contentWidth` / `contentStartX` /
content height. The virtual-grid feature keeps working unchanged.

## Components & files

1. **Settings** — `src/types.ts`, `src/utils/settingsManager.ts`
   - `controlPanePosition: 'left' | 'bottom'` (default `'left'`), sanitized to those two
     literals (fall back to `'left'` on garbage), layered global/project like `gridColumns`.
   - `controlPaneHeight: number` (default `12`), sanitized to an integer clamped to
     `[6, 24]`. Used only in bottom mode.
   - `controlPaneSize` (existing sidebar width, default 40) stays as-is, used only in left mode.
   - Add both to `DEFAULT_SETTINGS`, `cloneSettingsArrays`/sanitization, and
     `SETTING_DEFINITIONS` so the settings UI exposes them.

2. **LayoutConfig** — `src/utils/layoutManager.ts`
   - `resolveLayoutConfig` reads the two new settings and threads them into the resolved
     config (same pattern as `GRID_COLUMNS`): add `controlPosition` and `controlThickness`.
   - `recalculateAndApplyLayout` passes them down to the applier.

3. **Layout string** — `src/utils/tmux.ts`
   - `generateSidebarGridLayout` gains a `position: 'left' | 'bottom'` parameter (default
     `'left'` to keep call-site compatibility). A `bottom` branch computes geometry per the
     table above; the existing body becomes the `left` branch. Grid-building code is shared
     by parameterizing `contentWidth`, `contentStartX`, and the content region height.

4. **Calculator** — `src/layout/LayoutCalculator.ts` (and any width-based helpers)
   - When bottom: content area = `W × (H − c)`; when left: `(W − c) × H` (current).
   - Column selection (`gridColumns`) unchanged.

5. **Enforcement** — `src/index.ts` (`enforceControlPaneSize`), `src/layout/TmuxLayoutApplier.ts`,
   `src/layout/SpacerManager.ts`
   - Bottom mode resizes the control pane by **height** (`c` rows, bottom-anchored) instead
     of width; the native/`select-layout` fallback uses a bottom-anchored arrangement.
   - The single-pane / welcome path (currently `main-vertical` + `main-pane-width`) gets a
     bottom equivalent (`main-horizontal` + `main-pane-height`) so a control-pane-only or
     one-content-pane window also honors the position.
   - **Every** enforce path must branch on position — a missed path snaps the layout back to
     left. (Same failure class hit during the virtual-grid work; the paths are known.)

6. **UI reflow (Phase 2)** — `src/QmuxApp.tsx`, `src/components/panes/*`, `FooterHelp`
   - Bottom mode renders the pane list **horizontally** (wide, short strip) instead of a tall
     column, and promotes the onboarding help line to prominent real-shortcut text
     ("press `n` to add an agent pane, `t` for a terminal, `p` to open a project…").
   - Keyboard nav in bottom mode: **←/→ move the pane selection** (matches visual order);
     ↑/↓ reserved. Left mode keeps ↑/↓.

## Phasing

Geometry first, verified on its own, then UI reflow.

- **Phase 1 — geometry:** settings + LayoutConfig + layout string + calculator + enforcement,
  so the control pane physically sits full-width at the bottom with content tiled above.
  The control-pane UI still renders its current column layout inside the short strip
  (functional but not yet pretty). Independently shippable.
- **Phase 2 — UI reflow:** horizontal pane list, prominent onboarding help, ←/→ nav in
  bottom mode. Independently shippable on top of Phase 1.

## Testing

- **Unit (pure functions, like existing `layout.test.ts`):**
  - `generateSidebarGridLayout(position: 'bottom', …)` produces the expected control-leaf
    coordinates (`W×c` at `(0, H−c)`), content container (`W×(H−c−1)` at `(0,0)`), and a
    correct checksum.
  - Grid cells in bottom mode span full width (`contentStartX = 0`, `contentWidth = W`).
  - Calculator bottom content-area math: `W × (H − c)`.
  - Settings sanitization: `controlPanePosition` bad value → `'left'`; `controlPaneHeight`
    clamp to `[6, 24]`; layered override.
- **Manual (needs a live TUI):** run `qmux` with `controlPanePosition: 'bottom'`; confirm the
  strip is bottom-anchored, content tiles above, `g` still cycles columns, pane-jump works,
  enforcement doesn't snap it back to left after refresh/reorder/close.

## Risks & mitigations

- **Missed enforcement path** → layout snaps back to left. Mitigation: enumerate every
  enforce/apply/spacer path and branch on position; the set is known from the virtual-grid work.
- **Very short terminals** (`H` near `c`) → unusable content region. Mitigation: min content
  height guard; if `H − c` drops below a floor, shrink `c` toward the `[6,…]` minimum.
- **Call-site compatibility** for `generateSidebarGridLayout` → default the new param to
  `'left'` so existing callers are untouched until wired.
- **Live-verification gap** — the geometry is unit-testable, but Ink+tmux+attach behavior is
  only confirmable in an interactive run. Phase 1 ships behind an opt-in setting, so default
  users are unaffected while it's validated.
