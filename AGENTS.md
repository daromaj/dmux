# AGENTS.md - qmux Maintainer Guide

This file is the maintainer-focused source of truth for working on qmux itself.

## Docs map

- `README.md`: end-user overview and install/usage.
- `CONTRIBUTING.md`: local development loop and PR workflow.
- `AGENTS.md` (this file): maintainer behavior, architecture landmarks, and current dev-mode workflow.

`CLAUDE.md` is a symlink to this file for tool compatibility.

## Project overview

qmux is a TypeScript + Ink TUI for managing parallel AI-agent work in tmux panes backed by git worktrees.

Core behavior:

- One project-scoped qmux session (stable name based on project root hash)
- One worktree per work pane
- Agent launch + prompt bootstrap in each pane
- Merge/close actions with worktree cleanup hooks
- Optional multi-project grouping in one session

## Important architecture landmarks

- `src/index.ts`: startup, tmux session attach/create, control pane management, dev-mode startup behavior
- `src/QmuxApp.tsx`: main TUI state, status/footer, input hookups, source switching
- `src/services/QmuxFocusService.ts`: macOS helper lifecycle, fully-focused pane tracking, helper-backed native notifications
- `src/services/QmuxAttentionService.ts`: attention-notification coordinator for idle/waiting panes
- `src/hooks/useInputHandling.ts`: keyboard and menu action handling
- `src/services/PopupManager.ts`: popup launch + data plumbing
- `src/actions/types.ts`: action registry and menu visibility rules
- `src/actions/implementations/closeAction.ts`: close behavior + source fallback on source-pane removal
- `src/components/panes/*`: pane list rendering (includes source indicator)

## Native helper

qmux ships a macOS helper daemon implemented in `native/macos/qmux-helper.swift`.

What it does:

- Release packages ship a prebuilt `qmux-helper.app` bundle under `native/macos/prebuilt/`
- On macOS, qmux syncs that packaged app bundle into `~/.qmux/native-helper/qmux-helper.app`
- If the packaged bundle is unavailable (for example in a source checkout without a prepack step), qmux can still build the helper app bundle on demand from `native/macos/qmux-helper.swift`
- Auto-starts behind a Unix socket at `~/.qmux/native-helper/run/qmux-helper.sock`
- Tracks the actual frontmost macOS app/window via CoreGraphics + Accessibility
- Correlates the active terminal window/tab back to a specific qmux instance using a short token injected into the terminal title
- Delivers macOS notifications for panes that need attention
- The square helper icon source lives at `native/macos/qmux-helper-icon.png`; it is derived from `docs/public/favicon.svg` so the docs/favicon mark and native helper branding stay aligned
- Bundles custom notification sounds from `native/macos/sounds/` and randomly chooses from the configured enabled set for each background alert
- Startup also removes the legacy `~/.qmux/macos-notifier` helper if it still exists from older qmux releases
- This is progressive enhancement only: on non-macOS platforms the helper path must stay inert and qmux should continue working without native focus/notification integration

Focus model:

- `QmuxFocusService` writes a per-instance token into the terminal title.
- The helper looks at the frontmost visible app window and its title.
- A pane is considered "fully focused" only when:
  - the frontmost app bundle matches the terminal app running this qmux instance, and
  - the focused window title contains this qmux instance's token, and
  - tmux reports that pane as the selected pane.

Notification model:

- Worker heuristics + `PaneAnalyzer` first decide whether a pane is still working or has settled into `idle` / `waiting`.
- `StatusDetector` emits attention events only after LLM-backed analysis succeeds.
- `QmuxAttentionService` only sends a native notification when that pane is not the fully focused pane for this qmux instance.

If focus behavior changes, update this section and keep `CLAUDE.md` as a symlink to `AGENTS.md`.

## Quake-mode assistant

A drop-down Ink chat overlay that talks to the app's configured LLM and operates the workspace as a
basic agentic harness (send keystrokes to panes, read pane output, change layout/grid/color).

- Toggle: `Ctrl+\`` primary; fallback chord `Ctrl+b` then `` ` ``. The binding matches multiple
  encodings defensively (`key.ctrl && '\``, raw `\x1c`, and the chord) — Ctrl+backtick is terminal-
  dependent, so confirm which one fires in your terminal via a raw-key log if it doesn't respond.
- The model streams prose plus fenced command blocks: ` ```run ` (shell/tmux, executed via a shell)
  and ` ```qmux ` (control verbs `grid`/`control`/`color`/`layout refresh`, routed in-process because
  raw tmux geometry is stomped by the layout enforcer and settings have no file watcher).
- Full-auto: commands run with no confirmation gate. `Esc` aborts the loop. A forensic transcript is
  appended to `<projectRoot>/.qmux/quake-history.jsonl`.
- User slash commands (typed in the chat, parsed client-side in `src/utils/quakeSlashCommands.ts`,
  dispatched via `QuakeAssistantService.handleUserInput` before any LLM call — the model never sees them):
  - `/new` — clear the conversation (`reset()` zeroes `seq`, aborts any in-flight turn, emits a `reset`
    event the overlay listens for to wipe the view).
  - `/loop <prompt>` / `/loop <N> <prompt>` / `/loop until <cond> <prompt>` (or `until "<multi word>"`) —
    re-run a prompt as full turns until Esc / N times / the reply contains the condition
    (case-insensitive); `QuakeAssistantService.runLoop`. Hard cap 100 for the unbounded form.
- Session persistence: the overlay is a throwaway `tmux display-popup` process, so the conversation is
  kept in a parent-process module singleton (`src/services/quakeSessionStore.ts`, keyed by project root):
  `PopupManager.launchQuakePopup` seeds it into the popup's data file and writes the returned session
  (from the popup result file) back. Reopening restores the same conversation; `/new` or an app restart
  (fresh parent process) clears it.
- Landmarks: `src/services/QuakeAssistantService.ts` (the loop + slash dispatch + `runLoop`),
  `src/components/QuakeOverlay.tsx` (overlay UI + footer palette), `src/hooks/useQuakeAssistant.ts`
  (wiring + toggle + control-pane grow/restore), `src/utils/quakeSlashCommands.ts` (slash parser),
  `src/services/quakeSessionStore.ts` (cross-open persistence), `src/utils/quakeSystemPrompt.ts` (the
  operating manual), `src/utils/aiClient.ts` (reusable OpenAI-compatible streaming client). Wired into
  `QmuxApp.tsx`. Design spec: `docs/superpowers/specs/2026-07-09-quake-mode-assistant-design.md`.

## Adding a new agent to the registry

The agent registry is centralized in `src/utils/agentLaunch.ts`.

1. Add the new ID to `AGENT_IDS` (this updates the `AgentName` type).
2. Add a full entry in `AGENT_REGISTRY` for that ID with:
   - metadata (`name`, `shortLabel`, `description`, `slugSuffix`)
   - install detection (`installTestCommand`, `commonPaths`)
   - launch behavior (`promptCommand`, `promptTransport`, plus `promptOption` or `sendKeys*` fields when needed)
   - permission mapping (`permissionFlags`) and `defaultEnabled`
   - optional resume behavior (`resumeCommandTemplate`) and startup command split (`noPromptCommand`)
3. Keep `shortLabel` unique and exactly 2 characters (enforced at runtime).

Most UI/settings surfaces consume `getAgentDefinitions()`, so they pick up registry additions automatically (for example, enabled-agents settings and chooser popups).

Related places to verify after adding an agent:

- `src/utils/agentDetection.ts` for install detection behavior
- `__tests__/agentLaunch.test.ts` for registry/permission/command expectations
- `docs/src/content/agents.js` (static docs page; update supported-agent docs when behavior changes)

Recommended validation:

```bash
pnpm run typecheck
pnpm run test
```

## Maintainer local workflow (qmux-on-qmux)

`pnpm dev` is the standard entry point when editing qmux.

What it does:

1. Bootstraps local docs/hooks (`dev:bootstrap`)
2. Compiles TypeScript once
3. Launches qmux in dev mode from `dist/index.js` (built runtime parity)
4. Auto-promotes to watch mode when launched in tmux

Result: changes in this worktree should recompile/restart automatically without repeated manual relaunches.

## Dev-mode source workflow

In DEV mode, a single source path is active at a time.

- Use pane menu action: `[DEV] Use as Source`
- Hotkey equivalent: `S`

Toggle semantics:

- Toggling on a non-source worktree pane switches source to that worktree.
- Toggling on the currently active source pane switches source back to project root.
- If the active source pane/worktree is closed or removed, source automatically falls back to project root.

UI cues:

- Footer shows `DEV MODE source: <branch>`
- Active source pane is marked with `[source]` in the pane list
- Dev-only actions are prefixed with `[DEV]` and only shown in DEV mode

## Dev diagnostics

Use:

```bash
pnpm run dev:doctor
```

Checks include:

- session exists
- control pane validity
- watch command detection
- active source path
- generated docs file presence
- local hooks presence

## Hooks and generated docs

`pnpm dev` and `pnpm dev:watch` both ensure generated hooks docs exist before runtime.

Key artifacts:

- `src/utils/generated-agents-doc.ts`
- local hooks under `.qmux-hooks/` (notably `worktree_created`, `pre_merge`)

## Pull request workflow

Recommended:

1. Run qmux from a maintainer worktree with `pnpm dev`.
2. Create worktree panes for features/fixes.
3. Iterate and merge via qmux.
4. Run checks before PR:

```bash
pnpm run typecheck
pnpm run test
```

## Repository

This is a standalone project. `origin` (`daromaj/dmux`) is the only remote.

- **Do NOT add any other remotes.**
- **Create PRs only against `origin`** (`daromaj/dmux`) with `gh pr create`.
- All work stays in this repo.

## Notes for maintainers

- Keep `pnpm dev` as the default path for qmux development.
- Treat `dev:watch` as internal machinery behind the default `dev` entrypoint.
- Keep dev-only controls hidden outside DEV mode.
- Update this file when dev workflow behavior changes.
