<p align="center">
  <img src="./dmux.png" alt="dmux logo" width="400" />
</p>

<h3 align="center">Parallel AI agents in tmux panes</h3>

<p align="center">
  A personal, heavily-customized fork of dmux tuned to one specific workflow.
</p>

---

> ### ⚠️ This is a personal fork
>
> This is **my** fork of [dmux](https://github.com/formkit/dmux), bent hard toward how I
> personally work. It is not the upstream project, is not a drop-in for it, and I make no
> promise to keep it compatible or to accept issues/PRs.
>
> **Full credit to the dmux team** — the original is genuinely great work, and everything here is
> built on top of their foundation. If you want the polished, supported, general-purpose tool,
> use the original: **[formkit/dmux](https://github.com/formkit/dmux)** · **[dmux.ai](https://dmux.ai)**.
>
> **The big difference:** this fork does **not** manage git for you. No forced worktrees, no branch
> creation, no merge orchestration. Panes just open in the project directory and launch an agent —
> the agent handles its own branches, commits, and merges. Worktrees are strictly opt-in
> (`DMUX_USE_WORKTREE=1`) and off by default.

---

<img src="./dmux.webp" alt="dmux demo" width="100%" />

## Install

This fork isn't published to npm under `dmux` — run it from source (see [CONTRIBUTING.md](./CONTRIBUTING.md)):

```bash
git clone https://github.com/daromaj/dmux
cd dmux
pnpm install
pnpm run build
npm link   # exposes `dmux` on your PATH
```

## Quick Start

```bash
cd /path/to/your/project
dmux
```

Press `n` for an agent pane or `t` for a plain terminal. The pane opens **in the project directory** and launches the agent — no worktree, no branch juggling. What the agent does with git is entirely up to the agent.

## What it does

dmux is a tmux + Ink TUI that opens a pane per task and launches an AI agent in it. It's a **pane manager**, not a git wrapper: branches, commits, and merges are the agent's job, not dmux's.

- **No git oversight** &mdash; panes run in the project dir; the agent owns its own branches/commits/merges
- **Agent support** &mdash; Claude Code, Codex, Grok, OpenCode, Cline CLI, Gemini CLI, Qwen CLI, Amp CLI, pi CLI, Cursor CLI, Copilot CLI, and Crush CLI
- **Configurable AI provider** &mdash; point branch-name/commit AI helpers at any provider (`DMUX_AI_PROVIDER`, `DMUX_AI_MODEL`, `DMUX_AI_BASE_URL`, `DMUX_AI_API_KEY`); DeepSeek preset included
- **Favourite startup commands** &mdash; per-project list of commands (`cc`, `cc -c`, `pi`, …) offered when opening a pane
- **Virtual grid layout** &mdash; fix content panes to a column count (`g`: auto/1/2/3/4) or let it adapt
- **Pane management** &mdash; reorder, resize, per-pane agent override, and manual pane colors from the sidebar
- **Quick project open** &mdash; `p` jumps to any repo under `~/git` (MRU-sorted) and starts a chosen command
- **Goal launches** &mdash; optionally start supported agents in goal mode from the initial prompt
- **Multi-select launches** &mdash; choose any combination of enabled agents per prompt
- **macOS notifications** &mdash; background panes send native attention alerts when they settle and need you, with a global off switch
- **Built-in file browser** &mdash; inspect a pane's directory, search files, and preview code or diffs without leaving dmux
- **Pane visibility controls** &mdash; hide individual panes, isolate one project, single-pane mode, or restore everything later
- **Multi-project** &mdash; add multiple repos to the same session
- **Lifecycle hooks** &mdash; run scripts on pane/worktree events

## Worktrees (opt-in)

Worktrees are off by default. Set `DMUX_USE_WORKTREE=1` to restore the upstream behavior where each new pane gets its own git worktree and branch. Without it, panes share the project directory and dmux does nothing to your git state.

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `n` | New agent pane |
| `t` | New terminal pane |
| `p` | Quick-open a project from `~/git` (pick a command) |
| `j` / `Enter` | Jump to pane |
| `m` | Open pane menu |
| `f` | Browse files in the selected pane's directory |
| `g` | Cycle virtual grid columns (auto/1/2/3/4) |
| `[` | Collapse/expand the sidebar |
| `Shift+↑↓` | Reorder selected pane |
| `Ctrl+↑↓←→` | Resize selected pane |
| `x` | Close pane |
| `h` | Hide/show selected pane |
| `H` | Hide/show all other panes |
| `P` | Show only the selected project's panes, then show all |
| `s` | Settings |
| `?` | All shortcuts |
| `q` | Quit |

## Requirements

- tmux 3.0+
- Node.js 18+
- Git 2.20+
- At least one supported agent CLI (for example [Claude Code](https://docs.anthropic.com/en/docs/claude-code), [Codex](https://github.com/openai/codex), [Grok Build](https://docs.x.ai/build/overview), [OpenCode](https://github.com/opencode-ai/opencode), [Cline CLI](https://docs.cline.bot/cline-cli/getting-started), [Gemini CLI](https://github.com/google-gemini/gemini-cli), [Qwen CLI](https://github.com/QwenLM/qwen-code), [Amp CLI](https://ampcode.com/manual), [pi CLI](https://www.npmjs.com/package/@mariozechner/pi-coding-agent), [Cursor CLI](https://docs.cursor.com/en/cli/overview), [Copilot CLI](https://github.com/github/copilot-cli), [Crush CLI](https://github.com/charmbracelet/crush))
- [OpenRouter API key](https://openrouter.ai/) (optional, for AI branch names and commit messages)

## Documentation

The upstream project's docs at **[dmux.ai](https://dmux.ai)** cover the core concepts, but they describe the original worktree-centric behavior and won't reflect this fork's changes. Fork-specific behavior and maintainer notes live in **[AGENTS.md](./AGENTS.md)**.

## Contributing

This is a personal fork, so I'm not really soliciting contributions. If you want to hack on it locally, **[CONTRIBUTING.md](./CONTRIBUTING.md)** documents the "dmux-on-dmux" development loop. For the maintained, general-purpose tool, contribute to the original at **[formkit/dmux](https://github.com/formkit/dmux)**.

## Credits

Built on top of **[dmux](https://github.com/formkit/dmux)** by the FormKit team. All the hard foundational work is theirs; this fork just reshapes it for one person's workflow.

## License

MIT
