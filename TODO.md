# qmux — custom fork TODO

> Based on personal workflow needs. Quick hacks first, proper features later.

## Pending

- [ ] **New project creates two control entries** — starting a new project shows two entries in the
      control pane (one for terminal, one for project?). Unintuitive — collapse to a single clear entry.

- [ ] **Collapse / hide-unhide control pane** — a toggle that fully hides the control pane and gives
      its space back to the content panes, then restores it. Extends the existing `[` sidebar
      collapse (which only shrinks the left sidebar width) into a real show/hide, and must also work
      in **bottom** mode (reclaim the bottom strip's rows). Decide: reuse `[`, add a distinct key,
      and whether the hidden state persists across restarts.

- [~] **Quake-mode assistant** (`Ctrl+\``) — IMPLEMENTED (pending live tmux smoke test). A top-drawer
      chat that talks to the app's configured LLM
      (`aiProvider`/`aiModel`/`aiBaseUrl`, key from `QMUX_AI_API_KEY`/`OPENROUTER_API_KEY`). Basic
      agentic harness: the model streams prose and emits ` ```run ` shell/tmux blocks (executed) and
      ` ```qmux ` control verbs (grid/control-position/color).
      Full-auto, no confirm gate; Esc aborts; forensic transcript to `.qmux/quake-history.jsonl`.
      System prompt is the operating manual (what qmux is + how to send-keys/read panes + live
      pane/settings context). Decisions resolved: free-form send-keys (not tool-calls); no guardrails;
      history in-memory + jsonl.
      - **Architecture:** runs as its own `tmux display-popup` drawer anchored to the top at ~50%
        height (a separate process), leaving the small control pane untouched — it does NOT hijack or
        zoom the control pane. The popup reconstructs `QuakeAssistantService`; AI config is passed in
        via a data file since a tmux popup doesn't inherit the qmux env. Control verbs persist to disk
        (best-effort) rather than hot-applying to the live UI.
      - Files: `src/utils/{aiClient,quakeCommands,quakeControlVerbs,quakeSystemPrompt,quakeShell,quakeTypes}.ts`,
        `src/services/QuakeAssistantService.ts`, `src/components/QuakeOverlay.tsx`,
        `src/components/popups/quakePopup.tsx`, `src/services/PopupManager.ts` (`launchQuakePopup`),
        `src/hooks/useQuakeAssistant.ts`, wired in `QmuxApp.tsx`. Spec:
        `docs/superpowers/specs/2026-07-09-quake-mode-assistant-design.md`.
      - **Needs live verification:** the `Ctrl+\`` key encoding (defensive matching for `key.ctrl+\``,
        raw `\x1c`, and the `Ctrl+b` `` ` `` chord — confirm which fires in your terminal) and that the
        top drawer appears at ~50% height with visible input in real tmux.
- [ ] **`/loop` command** — bind a repeatable action to run against the LLM agent on demand/interval
      (re-invoke the same prompt/step N times or until a condition). Overlaps with the assistant
      above; decide whether `/loop` is a slash command inside the quake chat or a standalone control.
- [ ] **`/new` command** — start a fresh qmux session from the assistant/command surface (parity with
      plain `qmux` scratch-start). Sketch a slash-command palette (`/new`, `/loop`, …) that the quake
      assistant and/or the main TUI both expose.

- [ ] **`qmux --quick`** — start with no sidebar TUI, just a tmux session + keybindings
- [ ] **Session restore** — `qmux --resume` reopens last session
- [ ] **Multi-monitor** — spawn panes in different tmux windows
- [ ] **Log tailing** — built-in log viewer pane (tail -f with search)

## Done ✓

- [x] **Rebrand dmux → qmux + de-fork + drop auto-update** — renamed the whole project from `dmux`
      to `qmux` ("quake-mode tmux"). Removed every reference to the upstream/official repos and all
      auto-update machinery (deleted `AutoUpdater`, `useAutoUpdater`, `updateChecker`, `UpdateDialog`);
      standalone project now, one credit line kept, LICENSE untouched. Full rename: code symbols
      (`Dmux*`→`Qmux*`), on-disk state (`.dmux/`→`.qmux/`, `~/.dmux.global.json`→`~/.qmux.global.json`,
      `DMUX_*`→`QMUX_*` env vars, `dmux-`→`qmux-` tmux session prefix, `.dmux-hooks/`→`.qmux-hooks/`),
      and the binary (`dmux`→`qmux`).
      - **Backward-compat migration** (`src/utils/legacyMigration.ts`, runs first at startup): moves
        legacy state to the new names, then leaves a **symlink** at each old `.dmux*` path pointing at
        the real `.qmux*` one — old references keep resolving and writes flow through to one shared
        file, so an older `dmux` and the new `qmux` interoperate during the transition. Idempotent,
        best-effort, never blocks startup; also links when state was already migrated (only `.qmux`
        present). Env fallback `QMUX_* ?? DMUX_*` (`src/utils/qmuxEnv.ts`). `dmux` bin aliased to
        `./qmux` so the old command still works. Verified: typecheck 0, build 0, migration tests 10/10.

- [x] **`qmux -c` restores shell panes too** — continue mode was only recreating agent panes; plain
      shell panes lost to a killed tmux server are now recreated as well, in their original cwd
      (`usePaneLoading.ts`: `selectMissingPanesToRecreate` no longer excludes `type === 'shell'`).

- [x] **AI key / provider resilience** — the API key and `aiProvider`/`aiModel`/`aiBaseUrl` now resolve
      from the qmux settings file, not just env, with recovery from the shell rc when a tmux-spawned
      qmux inherits a stale environment (`aiConfig.ts`).

- [x] **Bottom strip: tip restored + duplicate shortcuts removed + tight 3-row height** — the bottom
      control pane wasted space and the rotating `Tip:` line never showed. Three problems: (1) the shortcut
      hints rendered twice in `PanesStrip` — a static hint row (`n new agent / t terminal / p open project
      ...`) plus the selectable action cards saying the same thing; (2) `FooterHelp` is the only component
      that renders `Tip:`, and it's hard-excluded in bottom mode (`QmuxApp.tsx`, `!isBottomControlPane`), so
      the tip was structurally unreachable there; (3) the pane was 4 rows but the content is only 3 lines,
      leaving an empty row. Fix: deleted the static hint row and made the selectable action cards the single
      row-1 shortcuts line (with `m menu / [ collapse / ? all keys` appended inline); threaded
      `currentFooterTip` into `PanesStrip`, rendered as row 3 hugging the pane list (no gap); dropped
      `DEFAULT_CONTROL_PANE_HEIGHT` 4 → 3 so the pane fits its content exactly. Net 3-line layout:
      shortcuts / panes / tip, no empty rows. Trade-off: if pane cards ever wrap to a 2nd row (many panes
      on a narrow terminal) the tip clips — acceptable for the ≤4-panes workflow; bump `controlPaneHeight`
      in settings if needed. Verified via isolated `ink-testing-library` render + typecheck + placement tests.

- [x] **Bottom control pane too tall + collapse only hit the footer** — the bottom strip ballooned to
      ~9 rows (past even `MAX_CONTROL_PANE_HEIGHT` = 8) and `[` collapse appeared to affect only part of
      it. Root cause: no path pinned the strip to `thickness`. `main-horizontal` + `main-pane-height`
      can't clamp the control pane reliably (manual-mode `client_height` vs `window_height` mismatch), so
      it absorbed whatever rows were left over, and the Ink strip content sat at the top of the oversized
      pane with dead space below. Fix: after every bottom-mode layout+swap, explicitly
      `resize-pane -y <thickness>` on the control pane. Applied at all four bottom paths — `welcomePane.ts`
      (create), `index.ts` (welcome-exists), `TmuxLayoutApplier.ensureControlAtBottom` (general/grid) and
      `applyMainVerticalFallback`, plus `tmux.ts` enforce welcome-branch (which also now sizes content on
      top + swaps control to the bottom instead of pinning the top pane). Verified in real tmux: welcome-
      only = 4 rows bottom, stays 4 on content change, `[` collapse → 1 row (whole pane), `[` expand → 4.

- [x] **Screen flicker / welcome logo re-rendering (oscillation loop)** — after the pin fix the whole
      screen kept refreshing: the bottom pane grew then got clamped, over and over, re-rendering the
      decorative logo. Root cause: the enforce welcome-branch set `main-pane-height = windowHeight -
      thickness`, but the 1-row pane border made `main-horizontal` yield `thickness - 1`, so the explicit
      `resize-pane -y thickness` pin fought it by exactly one row on **every** enforce. Each resize emitted
      SIGWINCH → `useLayoutManagement` re-enforced → resize again → never converged. Fix: (1) account for
      the border (`- thickness - 1`) so `main-horizontal` lands on `thickness` and the pin is a steady-
      state no-op; (2) idempotency guard — if the control pane is already the bottom-most pane at exactly
      `thickness`, skip the whole main-horizontal/swap/pin sequence. Verified: layout converges in ~2
      startup samples then holds rock-steady (control `4@38`, welcome content hash unchanged for 12+
      consecutive 0.4s samples). Same border correction applied to the two create paths.

- [x] **Single pane maximized** — a lone content pane now fills the whole working area instead of being
      capped at `MAX_COMFORTABLE_WIDTH` (~100 cols). Root cause: `LayoutCalculator.buildLayoutForCols`
      sized `windowWidth = min(reserved + cols*MAX_COMFORTABLE_WIDTH, terminalWidth)`, so with one pane
      the window shrank to ~100 cols and left the rest of the terminal empty. Special-cased
      `numContentPanes === 1` to use the full terminal width.

- [x] **New-pane action order: terminal → project → agent** — `[t] terminal` is now the default/first
      action (initial selection lands on it), `[p] project` is a new card that opens the quick-open
      project chooser, and `[n]ew agent` moves last. Threaded a new `'project'` action kind through
      `buildProjectActionLayout` (single-project row order), the visual/horizontal navigation-row
      builders, `PanesGrid` + `PanesStrip` rendering, and the Enter/hotkey dispatch in
      `useInputHandling`. Post-close selection and `selectProjectAction` now prefer the terminal action.

- [x] **Double Ctrl+C closes the whole session** — a second Ctrl+C in the control pane now tears down
      the entire qmux tmux session (every pane), instead of only exiting the control-pane TUI and
      leaving the other panes running. `q` stays the soft quit (exits the TUI, keeps the session so
      `qmux -c` can resume). New `TmuxService.killSessionSync()` + `killSessionExit()` in QmuxApp,
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
      (rows, default 4, clamped 2..8). In bottom mode the control pane is a full-width strip anchored
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

- [x] **`qmux` = scratch, `qmux -c` = continue** — plain `qmux` always starts from a clean single
      pane. If a previous project session is still alive in tmux, plain `qmux` **kills it** and creates
      a fresh one (no more reattaching to old panes, no cd-into-worktree, no auto `claude --continue`).
      `qmux -c` / `--continue` reopens the last session: live panes reattach as-is; panes lost to a
      killed tmux server are recreated with **fresh** agent sessions (never resumed). The continue flag
      is forwarded to the control-pane process so a killed-server `-c` still restores. Implemented in
      `index.ts` (session teardown + flag forward + welcome-pane count) and `usePaneLoading.ts`
      (`shouldContinueSession` / `selectMissingPanesToRecreate`, fresh-launch restore).

- [x] Configurable AI provider (env vars: `QMUX_AI_PROVIDER`, `QMUX_AI_MODEL`, `QMUX_AI_BASE_URL`, `QMUX_AI_API_KEY`)
- [x] DeepSeek provider preset (`deepseek-v4-pro` model, `api.deepseek.com` endpoint)
- [x] Settings UI for AI config (`aiProvider`, `aiModel`, `aiBaseUrl`)
- [x] `QMUX_USE_WORKTREE=1` opt-in — no worktrees by default
- [x] Safe defaults — no auto-agent-selection, `permissionMode` defaults to ask
- [x] Live dev via `npm link` in `~/git/qmux`
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
- [x] Verified: pane rename works without worktree; worktree cleanup on close works; config schema exists; tmux prefix is a non-issue (qmux uses no-prefix `M-` bindings, never hardcodes `C-b`)

## Priority 1 — Layout Control

- [x] **Virtual grid placement** — `g` hotkey / settings `gridColumns` (Auto/1/2/3/4)
  - [x] Fixed column grid instead of auto-scored splits (`GRID_COLUMNS` in LayoutCalculator)
  - [x] Grid still adapts to pane count; Auto = previous adaptive behavior
  - [x] Move panes between cells = pane reorder (Move Up/Down + `Shift+↑↓`); order = row-major cell fill
  - [x] Grid shape persisted in settings, restored on reopen; every layout enforce reads it → stays stable
  - [x] `Ctrl+b` arrows still focus panes (unchanged)
  - Note: this is a fixed-columns grid (up to 4 cols × N rows), not free-form per-cell placement
    with empty cells — cell assignment is via pane order. Full drag-to-arbitrary-cell is a follow-up.

## Priority 2 — Pane Management

- [x] **Pane reordering** — menu Move Up/Down + `Shift+↑↓` (swaps list order + tmux geometry)
- [x] **Pane renaming** from sidebar (verified: works without worktree via menu → Rename)
- [x] **Resize panes** via qmux shortcuts — `Ctrl+↑↓←→` (best-effort under auto-layout)

## Priority 3 — Agent Integration

- [x] **pi CLI** as first-class agent (registered + default-enabled)
- [x] **Favourite startup commands** — `favoriteCommands` setting (default `cc`/`cc -c`/`pi`/`pi -c`); the
      `p` project-open picker offers them after Shell, runs the chosen one in the fresh terminal. Edit the list
      in `.qmux/settings.json` (layered global/project). Was described as "custom agent commands"; the real need
      was a per-project favourites list, not a full agent-registry rewrite.
- [x] **Per-pane agent override** — menu `🔀 Change Agent` relaunches pane with a new agent
- [x] **Goal mode** per-pane toggle from sidebar (menu action `🎯 Toggle Goal Mode`)
- [x] **`p` + command** — after selecting project, pick command (shell / cc / ccc / pi)

## Priority 4 — Terminal Quality of Life

- [x] **Single-pane mode** — `disableWelcomePane` setting suppresses the auto welcome pane
- [x] **Better shortcut discoverability** — key hints shown in sidebar footer
- [x] **Configurable tmux prefix** — N/A: qmux uses no-prefix `M-` bindings, never hardcodes `C-b`
- [x] **Pane colors** — menu `🎨 Set Pane Color` (manual override persists)

## Priority 5 — Git / Worktree

Decision: **qmux does not manage git.** Agents own their branches/worktrees/merges; qmux is just a
pane manager. So the merge/branch-oversight items are dropped rather than built.

- [x] Worktree mode (`QMUX_USE_WORKTREE=1`) documented — README "Worktrees (opt-in)" section
- [~] ~~Merge without worktree~~ — **won't do.** qmux shouldn't orchestrate merges at all; the agent
      running in the pane handles its own git. The upstream merge flow is simply unused in this fork.
- [x] Worktree cleanup on close — verified working (`closeAction.ts`; skips deletion when siblings
      still share the worktree). Only relevant when `QMUX_USE_WORKTREE=1`.
