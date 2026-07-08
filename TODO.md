# dmux — custom fork TODO

> Based on personal workflow needs. Quick hacks first, proper features later.

## Done ✓

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

- [ ] **Virtual grid placement (4×4)**
  - Manual pane placement on a virtual grid instead of linear splits
  - Grid adapts: 1 pane = full, 2 = side-by-side, 3 = 2+1 split, 4 = 2×2, etc.
  - Pane creation prompts for grid position or auto-places
  - `Ctrl+b` arrows still work for focus, but grid stays stable
  - Move panes between grid cells (`m` → "Move to cell")
  - Grid layout persisted in config, restored on reopen

## Priority 2 — Pane Management

- [x] **Pane reordering** — menu Move Up/Down + `Shift+↑↓` (swaps list order + tmux geometry)
- [x] **Pane renaming** from sidebar (verified: works without worktree via menu → Rename)
- [x] **Resize panes** via dmux shortcuts — `Ctrl+↑↓←→` (best-effort under auto-layout)

## Priority 3 — Agent Integration

- [x] **pi CLI** as first-class agent (registered + default-enabled)
- [ ] **Custom agent commands** — define arbitrary launch commands per agent
- [x] **Per-pane agent override** — menu `🔀 Change Agent` relaunches pane with a new agent
- [x] **Goal mode** per-pane toggle from sidebar (menu action `🎯 Toggle Goal Mode`)
- [x] **`p` + command** — after selecting project, pick command (shell / cc / ccc / pi)

## Priority 4 — Terminal Quality of Life

- [x] **Single-pane mode** — `disableWelcomePane` setting suppresses the auto welcome pane
- [x] **Better shortcut discoverability** — key hints shown in sidebar footer
- [x] **Configurable tmux prefix** — N/A: dmux uses no-prefix `M-` bindings, never hardcodes `C-b`
- [x] **Pane colors** — menu `🎨 Set Pane Color` (manual override persists)

## Priority 5 — Git / Worktree (opt-in)

- [ ] Worktree mode (`DMUX_USE_WORKTREE=1`) properly documented
- [ ] Merge without worktree — detect branch from pane cwd, merge manually
- [ ] Worktree cleanup on close (already exists, verify)

## Nice to Have

- [ ] **`dmux --quick`** — start with no sidebar TUI, just a tmux session + keybindings
- [ ] **Session restore** — `dmux --resume` reopens last session
- [ ] **Multi-monitor** — spawn panes in different tmux windows
- [ ] **Log tailing** — built-in log viewer pane (tail -f with search)
