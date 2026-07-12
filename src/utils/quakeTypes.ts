/**
 * Shared types for the quake-mode assistant.
 *
 * The quake assistant is a basic agentic harness: a chat overlay that talks to
 * qmux's configured LLM and operates the workspace by emitting shell/tmux
 * commands (executed via a shell) and `qmux:` control verbs (routed into the
 * running Ink process). See docs/superpowers/specs/2026-07-09-quake-mode-assistant-design.md
 */

/** Chat roles for the OpenAI-compatible messages array. */
export type QuakeRole = 'system' | 'user' | 'assistant';

export interface QuakeMessage {
  role: QuakeRole;
  content: string;
}

/* ------------------------------------------------------------------ *
 * aiClient (src/utils/aiClient.ts)
 * ------------------------------------------------------------------ */

export interface ChatCompletionOptions {
  messages: QuakeMessage[];
  /** Abort in-flight request (Esc). */
  signal?: AbortSignal;
  /** Streaming delta callback; called for each token chunk as it arrives. */
  onToken?: (delta: string) => void;
  /** Streaming reasoning/thinking delta callback. */
  onThinkingToken?: (delta: string) => void;
  temperature?: number;
  maxTokens?: number;
}

/* ------------------------------------------------------------------ *
 * Command parser (src/utils/quakeCommands.ts)
 * ------------------------------------------------------------------ */

/**
 * A parsed segment of an assistant message.
 * - `prose`   : plain text to show the user.
 * - `shell`   : a fenced ```run / ```sh / ```bash block to execute in a shell.
 * - `qmux`    : a fenced ```qmux block containing control verbs (one per line).
 */
export type QuakeBlockKind = 'prose' | 'shell' | 'qmux';

export interface QuakeBlock {
  kind: QuakeBlockKind;
  content: string;
}

/** A command block extracted for execution, in emission order. */
export interface QuakeCommand {
  kind: 'shell' | 'qmux';
  content: string;
}

/* ------------------------------------------------------------------ *
 * Control verbs (src/utils/quakeControlVerbs.ts)
 * ------------------------------------------------------------------ */

/**
 * In-process effects the `qmux:` control lane routes into the running app.
 * Implementations live in the wiring layer (QmuxApp) and reuse existing
 * settings/layout closures; this keeps the verb module pure and testable.
 * Each handler returns (or resolves to) a short human-readable result note.
 */
export interface QuakeControlHandlers {
  /** gridColumns: 0/'auto' = adaptive, else 1..4. */
  setGridColumns: (columns: number | 'auto') => Promise<string> | string;
  setControlPosition: (position: 'bottom' | 'left') => Promise<string> | string;
  /** paneRef = pane slug or tmux pane id (%3) or qmux id. */
  setPaneColor: (paneRef: string, color: string) => Promise<string> | string;
  refreshLayout: () => Promise<string> | string;
}

/* ------------------------------------------------------------------ *
 * System prompt context (src/utils/quakeSystemPrompt.ts)
 * ------------------------------------------------------------------ */

export interface QuakePaneContext {
  /** qmux logical id. */
  id: string;
  slug: string;
  /** tmux pane id, e.g. "%4" — the send-keys / capture-pane target. */
  paneId: string;
  agent?: string;
  worktreePath?: string;
  status?: string;
}

export interface QuakeWorkspaceContext {
  sessionName: string;
  projectRoot: string;
  gridColumns: number; // 0 = auto
  controlPanePosition: 'bottom' | 'left';
  /** Content panes only — never includes the control pane. */
  panes: QuakePaneContext[];
}

/* ------------------------------------------------------------------ *
 * Service events (src/services/QuakeAssistantService.ts)
 * ------------------------------------------------------------------ */

export type QuakeEntryKind =
  | 'user'          // user message
  | 'assistant'     // assistant prose
  | 'thinking'      // model thinking process
  | 'command'       // a shell/qmux command about to run
  | 'output'        // result of a command
  | 'error'         // error notice
  | 'info';         // system notice (aborted, max steps, no api key, ...)

export interface QuakeTranscriptEntry {
  kind: QuakeEntryKind;
  text: string;
  /** For 'command'/'output': which lane. */
  lane?: 'shell' | 'qmux';
  /** Monotonic id for keying in the UI. */
  seq: number;
}

/* ------------------------------------------------------------------ *
 * Session persistence (src/services/quakeSessionStore.ts)
 * ------------------------------------------------------------------ */

/**
 * A serializable snapshot of a quake conversation. The quake overlay runs as a
 * short-lived child process (tmux display-popup), so this snapshot travels via
 * the popup data/result files and is held by a parent-side module singleton
 * (quakeSessionStore) keyed by project root. It naturally clears on app restart.
 */
export interface QuakeSessionState {
  /** LLM-facing message history (includes "Command results:" feedback turns). */
  history: QuakeMessage[];
  /** UI transcript entries. */
  entries: QuakeTranscriptEntry[];
  /** Monotonic entry counter, so restored entries keep unique keys. */
  seq: number;
}
