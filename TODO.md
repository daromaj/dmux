# dmux — custom fork TODO

> Based on personal workflow needs. Quick hacks first, proper features later.

## Inbox (unsorted)

- [ ] **Single pane maximized** — when only a single content pane exists it should fill the whole
      working area (no wasted empty grid space next to it).
- [ ] **New project creates two control entries** — starting a new project shows two entries in the
      control pane (one for terminal, one for project?). Unintuitive — collapse to a single clear entry.

## Done ✓

- [x] **New-pane action order: terminal → project → agent** — `[t] terminal` is now the default/first
      action (initial selection lands on it), `[p] project` is a new card that opens the quick-open
      project chooser, and `[n]ew agent` moves last. Threaded a new `'project'` action kind through
      `buildProjectActionLayout` (single-project row order), the visual/horizontal navigation-row
      builders, `PanesGrid` + `PanesStrip` rendering, and the Enter/hotkey dispatch in
      `useInputHandling`. Post-close selection and `selectProjectAction` now prefer the terminal action.

- [x] **Double Ctrl+C closes the whole session** — a second Ctrl+C in the control pane now tears down
      the entire dmux tmux session (every pane), instead of only exiting the control-pane TUI and
      leaving the other panes running. `q` stays the soft quit (exits the TUI, keeps the session so
      `dmux -c` can resume). New `TmuxService.killSessionSync()` + `killSessionExit()` in DmuxApp,
      wired to the second Ctrl+C; the confirm prompt now says it closes all panes.
      **Race fix:** `killSessionExit()` now kills the session BEFORE `exit()` — previously a post-`exit()`
      `setTimeout` did the kill, but Ink's `waitUntilExit().then(process.exit(0))` in `index.ts`
      preempted it, so only the control pane closed and left the shell prompt fighting the leftover pane.
      Killing first sends SIGHUP to every pane (including this one); `exit()` is now a not-in-tmux fallback.

- [x] **Project chooser fix** — the `p` quick-open list (and every other choice popup) now
      windows to fit the popup height instead of rendering all options. With ~30+ git projects the
      list overflowed the fixed-height tmux popup, so the highlighted row scrolled off-screen and
      arrows looked dead. Added `computeScrollWindow` (keeps selection centered, `↑/↓ more`
      indicators) in `choicePopup.tsx`, sized by a height-derived `maxVisible` from `PopupManager`.
      Also fixed the "order is wrong" complaint: sort projects by `.git` mtime (max of dir + .git),
      which tracks real git activity — plain dir mtime never bumps on nested-file edits.

- [x] **Bottom control pane — now the DEFAULT and actually rendering** — `controlPanePosition`
      (`'left' | 'bottom'`) now defaults to **`'bottom'`** (was `'left'`), plus `controlPaneHeight`
      (rows, default 12, clamped 6..24). In bottom mode the control pane is a full-width strip anchored
      at the bottom with content panes tiling above it. Threaded a position axis through the custom
      layout-string machinery (`generateSidebarGridLayout` bottom branch, `LayoutConfig.CONTROL_POSITION/
      CONTROL_HEIGHT`, `LayoutCalculator` reserves height, `SpacerManager`, `TmuxLayoutApplier`) via a
      shared `getControlPanePlacement()` helper. UI reflow: horizontal wrapping pane list (`PanesStrip`)
      with onboarding help line + grid-shaped ←/→/↑↓ nav.
      **Two display bugs fixed:** (1) the root container used `{}` (left-right) for vertically-stacked
      content+control, which tmux rejects with "size mismatch" — switched to `[]` (top-bottom);
      (2) tmux `select-layout` maps pane-index order onto cells in *listing* order, so the control pane
      (index 0) always landed in the top cell — added `TmuxService.swapPaneSync` + `ensureControlAtBottom()`
      to swap the control pane into the bottom strip after every bottom-mode apply (`TmuxLayoutApplier`,
      plus the welcome-pane paths in `welcomePane.ts` and `index.ts`). Verified in real tmux across 1–4
      content panes and repeated enforces (control stays pinned bottom, no oscillation).
      Design spec: `docs/superpowers/specs/2026-07-08-bottom-control-pane-design.md`.
      Note: web-server embedded layout path stays left-only.

- [x] **`dmux` = scratch, `dmux -c` = continue** — plain `dmux` always starts from a clean single
      pane. If a previous project session is still alive in tmux, plain `dmux` **kills it** and creates
      a fresh one (no more reattaching to old panes, no cd-into-worktree, no auto `claude --continue`).
      `dmux -c` / `--continue` reopens the last session: live panes reattach as-is; panes lost to a
      killed tmux server are recreated with **fresh** agent sessions (never resumed). The continue flag
      is forwarded to the control-pane process so a killed-server `-c` still restores. Implemented in
      `index.ts` (session teardown + flag forward + welcome-pane count) and `usePaneLoading.ts`
      (`shouldContinueSession` / `selectMissingPanesToRecreate`, fresh-launch restore).

- [x] Configurable AI provider (env vars: `DMUX_AI_PROVIDER`, `DMUX_AI_MODEL`, `DMUX_AI_BASE_URL`, `DMUX_AI_API_KEY`)
- [x] DeepSeek provider preset (`deepseek-v4-pro` model, `api.deepseek.com` endpoint)
- [x] Settings UI for AI config (`aiProvider`, `aiModel`, `aiBaseUrl`)
- [x] `DMUX_USE_WORKTREE=1` opt-in — no worktrees by default
- [x] Safe defaults — no auto-agent-selection, `permissionMode` defaults to ask
- [x] Live dev via `npm link` in `~/git/dmux`
- [x] `p` shortcut — quick-open project from ~/git (MRU-sorted), opens terminal pane
- [x] `[` shortcut — toggle sidebar collapse/expand
- [x] `ccc` alias — `cc -c` (non-interactive Claude)
- [x] **Goal mode per-pane toggle** — menu action (`🎯 Toggle Goal Mode`), shown on agent panes; applies on next launch
- [x] **`p` + command** — after selecting project, pick command (shell / cc / ccc / pi)
- [x] **Footer key hints** — compact shortcut line in sidebar footer for discoverability
- [x] **Single-pane mode** — `disableWelcomePane` setting; no auto welcome pane on startup
- [x] **pi CLI first-class** — registered + now default-enabled in the agent picker
- [x] **Pane reordering** — menu `↑ Move Up` / `↓ Move Down` + `Shift+↑↓`; swaps list order and tmux geometry
- [x] **Resize panes** — `Ctrl+↑↓←→` resizes the selected pane (best-effort; auto-layout re-tiles on next refresh)
- [x] **Per-pane agent override** — menu `🔀 Change Agent` relaunches the pane with a different agent (fresh session)
- [x] **Pane colors** — menu `🎨 Set Pane Color`; manual color sticks (not overwritten by project-theme sync)
- [x] Verified: pane rename works without worktree; worktree cleanup on close works; config schema exists; tmux prefix is a non-issue (dmux uses no-prefix `M-` bindings, never hardcodes `C-b`)

## Priority 1 — Layout Control

- [x] **Virtual grid placement** — `g` hotkey / settings `gridColumns` (Auto/1/2/3/4)
  - [x] Fixed column grid instead of auto-scored splits (`GRID_COLUMNS` in LayoutCalculator)
  - [x] Grid still adapts to pane count; Auto = previous adaptive behavior
  - [x] Move panes between cells = pane reorder (Move Up/Down + `Shift+↑↓`); order = row-major cell fill
  - [x] Grid shape persisted in settings, restored on reopen; every layout enforce reads it → stays stable
  - [x] `Ctrl+b` arrows still focus panes (unchanged)
  - Note: this is a fixed-columns grid (up to 4 cols × N rows), not free-form per-cell placement
    with empty cells — cell assignment is via pane order. Full drag-to-arbitrary-cell is a follow-up.

- [ ] **Collapse / hide-unhide control pane** — a toggle that fully hides the control pane and gives
      its space back to the content panes, then restores it. Extends the existing `[` sidebar
      collapse (which only shrinks the left sidebar width) into a real show/hide, and must also work
      in **bottom** mode (reclaim the bottom strip's rows). Decide: reuse `[`, add a distinct key,
      and whether the hidden state persists across restarts.

## Priority 2 — Pane Management

- [x] **Pane reordering** — menu Move Up/Down + `Shift+↑↓` (swaps list order + tmux geometry)
- [x] **Pane renaming** from sidebar (verified: works without worktree via menu → Rename)
- [x] **Resize panes** via dmux shortcuts — `Ctrl+↑↓←→` (best-effort under auto-layout)

## Priority 3 — Agent Integration

- [x] **pi CLI** as first-class agent (registered + default-enabled)
- [x] **Favourite startup commands** — `favoriteCommands` setting (default `cc`/`cc -c`/`pi`/`pi -c`); the
      `p` project-open picker offers them after Shell, runs the chosen one in the fresh terminal. Edit the list
      in `.dmux/settings.json` (layered global/project). Was described as "custom agent commands"; the real need
      was a per-project favourites list, not a full agent-registry rewrite.
- [x] **Per-pane agent override** — menu `🔀 Change Agent` relaunches pane with a new agent
- [x] **Goal mode** per-pane toggle from sidebar (menu action `🎯 Toggle Goal Mode`)
- [x] **`p` + command** — after selecting project, pick command (shell / cc / ccc / pi)

## Priority 4 — Terminal Quality of Life

- [x] **Single-pane mode** — `disableWelcomePane` setting suppresses the auto welcome pane
- [x] **Better shortcut discoverability** — key hints shown in sidebar footer
- [x] **Configurable tmux prefix** — N/A: dmux uses no-prefix `M-` bindings, never hardcodes `C-b`
- [x] **Pane colors** — menu `🎨 Set Pane Color` (manual override persists)

## Priority 5 — Git / Worktree

Decision: **dmux does not manage git.** Agents own their branches/worktrees/merges; dmux is just a
pane manager. So the merge/branch-oversight items are dropped rather than built.

- [x] Worktree mode (`DMUX_USE_WORKTREE=1`) documented — README "Worktrees (opt-in)" section
- [~] ~~Merge without worktree~~ — **won't do.** dmux shouldn't orchestrate merges at all; the agent
      running in the pane handles its own git. The upstream merge flow is simply unused in this fork.
- [x] Worktree cleanup on close — verified working (`closeAction.ts`; skips deletion when siblings
      still share the worktree). Only relevant when `DMUX_USE_WORKTREE=1`.

## Priority 6 — LLM Workspace Assistant

- [ ] **Quake-mode assistant** (`Ctrl+\``) — a drop-down chat overlay toggled with the quake key,
      talking to the model already configured in the app (`aiProvider` / `aiModel` / `aiBaseUrl` /
      `aiApiKey`). The assistant's system prompt ships full instructions for driving the workspace:
      how to talk to panes (send prompts / read output), how to control pane look & feel (colors,
      layout, grid columns, control-pane position), and how to send raw keystrokes to a pane. Net
      effect: a conversational co-pilot that can rearrange and operate the dmux workspace for you.
      - Open questions: overlay as a tmux popup vs. an Ink modal; how the assistant issues actions
        (structured tool-calls mapped onto the existing action registry vs. free-form tmux
        send-keys); guardrails/confirmation before destructive control (closing panes, killing
        sessions); where conversation history lives.
- [ ] **`/loop` command** — bind a repeatable action to run against the LLM agent on demand/interval
      (re-invoke the same prompt/step N times or until a condition). Overlaps with the assistant
      above; decide whether `/loop` is a slash command inside the quake chat or a standalone control.
- [ ] **`/new` command** — start a fresh dmux session from the assistant/command surface (parity with
      plain `dmux` scratch-start). Sketch a slash-command palette (`/new`, `/loop`, …) that the quake
      assistant and/or the main TUI both expose.

## Nice to Have

- [ ] **`dmux --quick`** — start with no sidebar TUI, just a tmux session + keybindings
- [ ] **Session restore** — `dmux --resume` reopens last session
- [ ] **Multi-monitor** — spawn panes in different tmux windows
- [ ] **Log tailing** — built-in log viewer pane (tail -f with search)
