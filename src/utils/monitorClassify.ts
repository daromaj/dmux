/**
 * Pure helpers for Monitor mode's classification layer:
 *  - detecting whether a pane's foreground process is a bare shell (agent gone),
 *  - parsing the finished-vs-stalled LLM verdict.
 *
 * The LLM call itself lives in PaneMonitorService; these pieces are pure so the
 * fragile bits (verdict parsing, shell detection) are unit-testable.
 */

/** Foreground process names that mean "no agent running — back at a shell prompt". */
export const SHELL_COMMAND_NAMES = new Set([
  'bash',
  'zsh',
  'sh',
  'fish',
  'dash',
  'ksh',
  'tcsh',
]);

/**
 * True when `command` (a tmux `pane_current_command`, possibly a full path) is a
 * plain shell — i.e. the agent has exited and the pane dropped to a prompt.
 */
export function isShellCommand(command: string | null | undefined): boolean {
  if (!command) return false;
  const trimmed = command.trim();
  if (!trimmed) return false;
  // Strip any directory prefix (e.g. "/bin/zsh" -> "zsh").
  const base = trimmed.split('/').pop() || trimmed;
  return SHELL_COMMAND_NAMES.has(base.toLowerCase());
}

export type FinishedVerdict = 'finished' | 'stalled' | 'ambiguous';

/**
 * Map a finished-vs-stalled LLM reply to a verdict. The model is asked to answer
 * with one token (FINISHED / STALLED / UNSURE); this parses leniently and, when
 * signals conflict or nothing matches, returns 'ambiguous' so the caller errs
 * toward doing nothing rather than nudging wrongly.
 */
export function parseFinishedVerdict(raw: string | null | undefined): FinishedVerdict {
  if (!raw) return 'ambiguous';
  const text = raw.toLowerCase();
  const finished = /\b(finished|done|complete|completed)\b/.test(text);
  const stalled = /\b(stalled|paused|continue|waiting|incomplete)\b/.test(text);
  if (finished && stalled) return 'ambiguous';
  if (finished) return 'finished';
  if (stalled) return 'stalled';
  return 'ambiguous';
}

/** System prompt for the finished-vs-stalled judgment. */
export const FINISHED_JUDGE_SYSTEM_PROMPT = `You are inspecting the recent terminal output of a coding agent that has gone idle.
Decide whether the agent has FINISHED the task it was working on, or has merely STALLED / paused mid-task and would keep going if nudged.

Reply with EXACTLY ONE word, nothing else:
- FINISHED — the agent completed its task and is waiting for a new, unrelated instruction.
- STALLED — the agent paused mid-task (e.g. awaiting a trivial "continue", stopped after a step, hit a soft limit) and should resume the same task.
- UNSURE — you cannot tell.

When in doubt, answer UNSURE.`;
