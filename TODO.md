# dmux — custom fork TODO

> Based on personal workflow needs. Quick hacks first, proper features later.

## Done ✓

- [x] Configurable AI provider (env vars: `DMUX_AI_PROVIDER`, `DMUX_AI_MODEL`, `DMUX_AI_BASE_URL`, `DMUX_AI_API_KEY`)
- [x] DeepSeek provider preset (`deepseek-v4-pro` model, `api.deepseek.com` endpoint)
- [x] Settings UI for AI config (`aiProvider`, `aiModel`, `aiBaseUrl`)
- [x] `DMUX_USE_WORKTREE=1` opt-in — no worktrees by default
- [x] Safe defaults — no auto-agent-selection, `permissionMode` defaults to ask
- [x] Live dev via `npm link` in `~/git/dmux`

## Priority 1 — Layout Control

- [ ] **Virtual grid placement (4×4)**
  - Manual pane placement on a virtual grid instead of linear splits
  - Grid adapts: 1 pane = full, 2 = side-by-side, 3 = 2+1 split, 4 = 2×2, etc.
  - Pane creation prompts for grid position or auto-places
  - `Ctrl+b` arrows still work for focus, but grid stays stable
  - Move panes between grid cells (`m` → "Move to cell")
  - Grid layout persisted in config, restored on reopen

## Priority 2 — Pane Management

- [ ] **Pane reordering** (swap positions in dmux list → affects layout)
- [ ] **Pane renaming** from sidebar (already exists in menu, ensure it works without worktree)
- [ ] **Resize panes** via dmux shortcuts (not raw tmux `C-b Alt+arrows`)

## Priority 3 — Agent Integration

- [ ] **pi CLI** as first-class agent (already supported upstream? verify)
- [ ] **Custom agent commands** — define arbitrary launch commands per agent
- [ ] **Per-pane agent override** — change agent for existing pane
- [ ] **Goal mode** per-pane toggle from sidebar

## Priority 4 — Terminal Quality of Life

- [ ] **Single-pane mode** — start dmux with just one terminal, no auto-welcome-pane
- [ ] **Better shortcut discoverability** — show key hints in sidebar footer
- [ ] **Configurable tmux prefix** (some users remap `C-b` to `C-a`)
- [ ] **Pane colors** — assign colors to panes for visual distinction

## Priority 5 — Git / Worktree (opt-in)

- [ ] Worktree mode (`DMUX_USE_WORKTREE=1`) properly documented
- [ ] Merge without worktree — detect branch from pane cwd, merge manually
- [ ] Worktree cleanup on close (already exists, verify)

## Nice to Have

- [ ] **`dmux --quick`** — start with no sidebar TUI, just a tmux session + keybindings
- [ ] **Session restore** — `dmux --resume` reopens last session
- [ ] **Multi-monitor** — spawn panes in different tmux windows
- [ ] **Log tailing** — built-in log viewer pane (tail -f with search)
