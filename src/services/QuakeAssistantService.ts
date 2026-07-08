import { EventEmitter } from 'events';
import { appendFile } from 'fs/promises';
import {
  buildQuakeSystemPrompt,
} from '../utils/quakeSystemPrompt.js';
import { extractCommands, hasCommands } from '../utils/quakeCommands.js';
import { runControlBlock } from '../utils/quakeControlVerbs.js';
import type {
  ChatCompletionOptions,
  QuakeControlHandlers,
  QuakeMessage,
  QuakeTranscriptEntry,
  QuakeWorkspaceContext,
} from '../utils/quakeTypes.js';

/**
 * QuakeAssistantService — the basic agentic harness behind the quake overlay.
 *
 * Loop: user message -> model streams prose + emits fenced command blocks ->
 * we run them (shell lane via injected runner, dmux lane via control handlers)
 * -> feed results back -> repeat until the model emits no commands, or Esc, or
 * the step cap. Ink-agnostic: everything external is injected, so the loop is
 * unit-testable with a scripted model.
 *
 * Events:
 *   'entry' (QuakeTranscriptEntry)      a new transcript entry was added
 *   'append' ({ seq, delta })           streaming token appended to an entry
 *   'busy' (boolean)                    loop running / idle (input gating + spinner)
 */

const MAX_STEPS_DEFAULT = 25;
const SHELL_TIMEOUT_MS = 120_000;
const OUTPUT_MAX_LINES = 40;

export type QuakeShellRunner = (
  command: string,
  opts: { signal: AbortSignal; timeoutMs: number },
) => Promise<string>;

export type QuakeModelComplete = (opts: ChatCompletionOptions) => Promise<string>;

export interface QuakeAssistantDeps {
  /** Fresh workspace context, read each turn so panes/settings stay live. */
  getWorkspaceContext: () => QuakeWorkspaceContext;
  /** In-process control-verb effects (grid/control/color/refresh). */
  controlHandlers: QuakeControlHandlers;
  /** Runs a shell/tmux command, returns combined stdout/stderr/exit text. */
  runShell: QuakeShellRunner;
  /** Calls the LLM. Defaults to aiClient.callChatCompletion when omitted. */
  complete: QuakeModelComplete;
  /** Forensic transcript path (JSONL). Optional; append is best-effort. */
  transcriptPath?: string;
  maxSteps?: number;
}

function truncateOutput(text: string): string {
  const lines = text.split('\n');
  if (lines.length <= OUTPUT_MAX_LINES) return text;
  const kept = lines.slice(0, OUTPUT_MAX_LINES).join('\n');
  return `${kept}\n… (${lines.length - OUTPUT_MAX_LINES} more lines)`;
}

export class QuakeAssistantService extends EventEmitter {
  private history: QuakeMessage[] = [];
  private entries: QuakeTranscriptEntry[] = [];
  private seq = 0;
  private abortController: AbortController | null = null;
  private busy = false;
  private readonly deps: QuakeAssistantDeps;
  private readonly maxSteps: number;

  constructor(deps: QuakeAssistantDeps) {
    super();
    this.deps = deps;
    this.maxSteps = deps.maxSteps ?? MAX_STEPS_DEFAULT;
  }

  isBusy(): boolean {
    return this.busy;
  }

  getEntries(): QuakeTranscriptEntry[] {
    return this.entries;
  }

  reset(): void {
    this.history = [];
    this.entries = [];
  }

  /** Esc: abort the running loop (in-flight model request + loop continuation). */
  abort(): void {
    if (this.abortController) {
      this.abortController.abort();
    }
  }

  private nextSeq(): number {
    return ++this.seq;
  }

  private pushEntry(
    kind: QuakeTranscriptEntry['kind'],
    text: string,
    lane?: 'shell' | 'dmux',
  ): QuakeTranscriptEntry {
    const entry: QuakeTranscriptEntry = { kind, text, lane, seq: this.nextSeq() };
    this.entries.push(entry);
    this.emit('entry', entry);
    void this.writeTranscript(entry);
    return entry;
  }

  private async writeTranscript(entry: QuakeTranscriptEntry): Promise<void> {
    if (!this.deps.transcriptPath) return;
    try {
      await appendFile(
        this.deps.transcriptPath,
        JSON.stringify({ ...entry, ts: Date.now() }) + '\n',
        'utf-8',
      );
    } catch {
      // Forensic log is best-effort; never fail the loop over it.
    }
  }

  private setBusy(value: boolean): void {
    this.busy = value;
    this.emit('busy', value);
  }

  /**
   * Send a user message and run the agentic loop to completion (or abort).
   */
  async sendUserMessage(text: string): Promise<void> {
    if (this.busy) return;
    const trimmed = text.trim();
    if (!trimmed) return;

    this.abortController = new AbortController();
    const signal = this.abortController.signal;
    this.setBusy(true);

    this.pushEntry('user', trimmed);
    this.history.push({ role: 'user', content: trimmed });

    try {
      const systemPrompt = buildQuakeSystemPrompt(this.deps.getWorkspaceContext());

      for (let step = 0; step < this.maxSteps; step++) {
        if (signal.aborted) {
          this.pushEntry('info', 'Aborted.');
          break;
        }

        // Fresh system prompt each step keeps live pane/settings context current.
        const messages: QuakeMessage[] = [
          { role: 'system', content: systemPrompt },
          ...this.history,
        ];

        // Streaming assistant entry: create a placeholder, append deltas into it.
        const assistantEntry = this.pushEntry('assistant', '');
        let assistantText = '';
        try {
          assistantText = await this.deps.complete({
            messages,
            signal,
            onToken: (delta) => {
              assistantText += delta;
              assistantEntry.text += delta;
              this.emit('append', { seq: assistantEntry.seq, delta });
            },
          });
        } catch (err: any) {
          if (err?.name === 'AbortError' || signal.aborted) {
            this.pushEntry('info', 'Aborted.');
            break;
          }
          this.pushEntry('error', `Model error: ${err?.message || String(err)}`);
          break;
        }

        // If the model didn't stream (onToken unused), finalize the entry text.
        if (!assistantEntry.text && assistantText) {
          assistantEntry.text = assistantText;
          this.emit('append', { seq: assistantEntry.seq, delta: assistantText });
        }
        this.history.push({ role: 'assistant', content: assistantText });

        if (!hasCommands(assistantText)) {
          break; // prose-only turn => task done
        }

        const { commands } = extractCommands(assistantText);
        const feedbackParts: string[] = [];

        for (const cmd of commands) {
          if (signal.aborted) break;
          this.pushEntry('command', cmd.content, cmd.kind);

          let result: string;
          try {
            if (cmd.kind === 'shell') {
              result = await this.deps.runShell(cmd.content, {
                signal,
                timeoutMs: SHELL_TIMEOUT_MS,
              });
            } else {
              result = await runControlBlock(cmd.content, this.deps.controlHandlers);
            }
          } catch (err: any) {
            if (err?.name === 'AbortError' || signal.aborted) {
              break;
            }
            result = `Error: ${err?.message || String(err)}`;
          }

          const shown = truncateOutput(result || '(no output)');
          this.pushEntry('output', shown, cmd.kind);
          feedbackParts.push(
            `[${cmd.kind}] ${cmd.content}\n---\n${result || '(no output)'}`,
          );
        }

        if (signal.aborted) {
          this.pushEntry('info', 'Aborted.');
          break;
        }

        // Feed all command results back as one turn, then loop.
        this.history.push({
          role: 'user',
          content: `Command results:\n\n${feedbackParts.join('\n\n')}`,
        });

        if (step === this.maxSteps - 1) {
          this.pushEntry('info', `Stopped after ${this.maxSteps} steps.`);
        }
      }
    } finally {
      this.abortController = null;
      this.setBusy(false);
    }
  }
}
