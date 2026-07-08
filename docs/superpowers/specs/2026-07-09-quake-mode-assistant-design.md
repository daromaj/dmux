# Quake-Mode Assistant — Design

Date: 2026-07-09
Status: approved for planning

## Summary

A drop-down chat overlay (toggled with `Ctrl+\`` , fallback chord `Ctrl+b` then `` ` ``)
that talks to dmux's already-configured LLM and can **operate the workspace** as a basic
agentic harness. The user asks in natural language ("distribute this work across three
panes", "watch pane 2 and tell me when the build finishes", "clean up merged worktrees",
"set up panes for X") and the assistant drives dmux by sending keystrokes to panes,
reading pane output, and changing layout/look-and-feel — looping until the task is done.

This is intentionally a **very basic agentic harness**: a chat, a system prompt that
teaches it how to operate dmux, and a ReAct-style execute→observe→continue loop. No
tool-calling SDK, no plan/critic machinery.

## Decisions (owner: Darek)

- **Scope:** full agentic co-pilot — open-ended loop that can call any action repeatedly
  until the task is done.
- **Action mechanism:** free-form. The model emits shell/tmux commands as text; dmux runs
  them and feeds output back.
- **Safety gate:** **none** (full auto). Every command the model emits runs without
  confirmation. `Esc` aborts the running loop. A forensic transcript is written to
  `.dmux/quake-history.jsonl` so there is a record of what ran. This risk posture is a
  deliberate choice.
- **Overlay:** in-process Ink drop-down (not a tmux popup).
- **History:** in-memory for the dmux process lifetime (survives overlay close/reopen);
  append-only transcript file for forensics. No rotation in v1.

## Why these over the alternatives

- **In-process Ink overlay over tmux popup:** dmux popups are separate Node processes,
  fire-and-forget, returning a single JSON result on exit (`PopupManager` / `popup.ts`).
  They cannot hold a live, stateful chat that drives the running app. An in-process Ink
  component rendered conditionally from `DmuxApp.tsx` can.
- **Free-form over native function-calling:** portable to any OpenAI-compatible endpoint
  including `custom`/DeepSeek; dmux's existing LLM path (`PaneAnalyzer`) already uses raw
  `fetch` with no tool-calling.

## Mechanism: two lanes, both free-form text

The model interleaves prose (shown to the user) with fenced command blocks:

- ` ```run ` / ` ```sh ` / ` ```bash ` — executed in a shell via `execAsync`, `cwd` = the
  active project/source root, environment pointed at this tmux session. This one lane
  covers everything raw: `tmux send-keys` to talk to a pane, `tmux capture-pane` to read
  it, and arbitrary `tmux`/`git`/shell.
- ` ```dmux ` — control verbs routed **into the running Ink process** so settings changes
  actually stick. Verbs (v1): `grid <auto|1|2|3|4>`, `control <bottom|left>`,
  `color <paneSlugOrId> <color>`, `layout refresh`.

### Why the `dmux:` lane is required (not optional)

Nothing watches the settings files. Live layout/grid/color/control-position changes only
take effect when in-process code calls `refreshDmuxSettings()` + `queueLayoutRefresh()`
(see `DmuxApp.tsx`, `useInputHandling.ts`). `ConfigWatcher` watches only the *panes* file
(`dmux.config.json`), not settings. And dmux's layout enforcer re-tiles on refresh/SIGWINCH,
so raw `tmux select-layout`/`resize-pane` from the shell lane gets stomped a moment later.
Durable look-and-feel control therefore must go through the running process.

## Components (isolated, independently testable)

| Unit | Responsibility | Depends on |
|---|---|---|
| `src/utils/aiClient.ts` | Reusable OpenAI-compatible chat call: multi-turn `messages[]`, streaming with non-stream fallback. | `getAiConfig`, `fetch` |
| `src/utils/quakeCommands.ts` | Pure parser: assistant text → ordered blocks (`prose` / `shell` / `dmux-control`). | — |
| `src/utils/quakeControlVerbs.ts` | Maps `dmux:` verbs → in-process effects via an injected `SettingsManager` + refresh callbacks. | settings, callbacks |
| `src/utils/quakeSystemPrompt.ts` | Builds the system prompt (the dmux operating manual + live workspace context). | pane state, settings |
| `src/services/QuakeAssistantService.ts` | The loop engine: conversation state, calls `aiClient`, parses, executes (shell + control), feeds results back, emits events, `AbortController` (Esc), step cap, transcript log. Ink-agnostic. | above, `execAsync` |
| `src/components/QuakeOverlay.tsx` | In-process Ink drop-down: input box, streamed scrollback, command echoes + truncated outputs, spinner, Esc. Subscribes to service events. | service |
| wiring | `DmuxApp.tsx` renders the overlay + owns a service instance; `useInputHandling.ts` adds the toggle binding and swallows other input while open. | — |

## System prompt (the operating manual)

The system prompt is the heart of the feature. It contains:

1. **What dmux is** — a project-scoped tmux session managing parallel AI-agent work; one
   pane per work unit (often backed by a git worktree); a control pane that renders this
   TUI (must never be targeted).
2. **How to operate panes** — how to send a prompt/keystrokes to a pane
   (`tmux send-keys -t <paneId> ...`, `Enter` to submit), how to read a pane's current
   output (`tmux capture-pane -t <paneId> -p -J -S -<lines>`), how to wait/poll for a pane
   to settle.
3. **How to control look-and-feel** — the `dmux:` control verbs and when to use them
   instead of raw tmux.
4. **The command protocol** — emit ` ```run ` blocks for shell/tmux, ` ```dmux ` blocks for
   control verbs; everything outside fences is shown to the user; when the task is done,
   reply with prose and no command blocks.
5. **Live workspace context (injected each turn)** — session name; the list of **content
   panes only** (id, slug, agent, worktree path, current status); current settings (grid
   columns, control-pane position). This lets it target panes without discovery round-trips.
6. **Constraints** — never target the control pane or the overlay; prefer non-interactive
   commands (there is a 120s per-command timeout); keep going until the goal is met, then stop.

## Data flow

`sendUserMessage(text)` → build `[system, ...history, user]` → `aiClient` streams prose to
the overlay → on completion, `quakeCommands` parses ordered blocks → for each block in order:
shell → `execAsync(cmd, { cwd, env, timeout: 120_000 })` capturing stdout/stderr/exit;
control → `quakeControlVerbs` handler → each yields a result string, echoed to the scrollback
(output truncated with a "… N more lines" note) → append the results as a single feedback
turn → re-call the model → repeat until it emits no command blocks, or `Esc`, or the
25-step cap. Input is disabled while the loop runs (except `Esc`).

## Toggle key

`Ctrl+\`` is unreliable in Ink — it often arrives as `\x1c` (ASCII FS) and some terminals
swallow it. **First implementation step: an empirical probe** logging raw
`{ input, key }` from Ink's `useInput` in the target terminal.

- Primary binding: whatever `Ctrl+\`` actually emits.
- Fallback: chord `Ctrl+b` then `` ` `` (a short-timeout two-key sequence). Caveat: if the
  tmux session still has `C-b` as its prefix, tmux may intercept it before it reaches Ink;
  the probe confirms what arrives, and the chord's first key may need to be a key that
  reaches the app. Document the final bindings in `AGENTS.md`.

The toggle check goes early in the `useInputHandling` `useInput` callback — before the
`isLoading` / `runningCommand` guards — mirroring the existing `Ctrl+C` placement.

## Error handling / holes being closed

- **No API key configured** → overlay shows a setup hint (`DMUX_AI_API_KEY` /
  `OPENROUTER_API_KEY`); no crash. (API key is env-only today; key management is out of scope.)
- **Model/network/SSE error** → shown in the overlay; conversation survives; streaming
  falls back to a non-streaming request on stream error.
- **Command timeout (120s)** → killed; "timed out" fed back to the model.
- **Control pane safety** → only content-pane ids are injected into the prompt; the prompt
  forbids targeting the control pane/overlay (targeting it would wedge the TUI).
- **Runaway loop** → 25-step cap; `Esc` aborts mid-flight via `AbortController`.
- **Model quality** → tool-following tracks the configured model (default
  `google/gemini-2.5-flash`); point `DMUX_AI_MODEL` at a stronger model for best results.
  Noted, not solved.

## Testing

- **Unit:** `quakeCommands` parser (fenced blocks, mixed prose, malformed fences);
  `quakeControlVerbs` against a mock `SettingsManager` (asserts settings mutations + refresh
  callback fired); `QuakeAssistantService` loop against a scripted stub `aiClient` (asserts
  execute → feed-back → terminate, step cap, Esc abort); `aiClient` against a mocked `fetch`
  (streaming, non-stream fallback, error).
- **Component:** `ink-testing-library` on `QuakeOverlay` (open/close, streamed text render,
  input submit, Esc).
- **Manual (real tmux):** toggle open/close; ask it to send a prompt to a pane and read the
  result; ask it to change grid columns and confirm the layout actually re-tiles and sticks.

## Out of scope (v1)

- API-key management UI (env-only stays).
- `/loop` and `/new` slash commands (separate TODO items; may later live inside this chat).
- Confirmation gates / command allow-lists (deliberately omitted).
- Persisting conversation across dmux restarts (in-memory only; transcript is forensic).
- History rotation/pruning.
