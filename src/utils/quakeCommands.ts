/**
 * Parses an LLM assistant message into ordered prose/command blocks for the
 * quake-mode agentic harness. Pure string logic — no side effects, no I/O.
 *
 * The assistant interleaves prose with fenced code blocks. Fence info
 * strings decide what a block is:
 *   - `run` / `sh` / `bash` / `shell` (case-insensitive) -> shell command block
 *   - `qmux`                                              -> qmux control block
 *   - anything else (e.g. `json`, `python`, or empty)     -> not executable;
 *     folded back into the surrounding prose verbatim (fence markers kept)
 *
 * See docs/superpowers/specs/2026-07-09-quake-mode-assistant-design.md
 */

import type { QuakeBlock, QuakeCommand } from './quakeTypes.js';

const SHELL_INFO_STRINGS = new Set(['run', 'sh', 'bash', 'shell']);

type ParseState = 'prose' | 'shell' | 'qmux';

/**
 * Parse an assistant message into ordered prose/shell/qmux blocks.
 *
 * A small line-scanning state machine: while in `prose` state, a line whose
 * trimmed form opens a recognized (`shell`/`qmux`) fence switches state and
 * starts collecting command content; while in `shell`/`qmux` state, a line
 * whose trimmed form is exactly ``` closes the block and returns to prose.
 * An unclosed trailing fence is flushed leniently at end-of-input.
 */
export function parseAssistantMessage(text: string): QuakeBlock[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n');

  const blocks: QuakeBlock[] = [];
  let state: ParseState = 'prose';
  let proseLines: string[] = [];
  let commandLines: string[] = [];

  const flushProse = () => {
    const content = proseLines.join('\n').trim();
    if (content !== '') {
      blocks.push({ kind: 'prose', content });
    }
    proseLines = [];
  };

  const flushCommand = (kind: 'shell' | 'qmux') => {
    const content = commandLines.join('\n').replace(/\n+$/, '');
    blocks.push({ kind, content });
    commandLines = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();

    if (state === 'prose') {
      if (trimmed.startsWith('```')) {
        const info = trimmed.slice(3).trim().toLowerCase();
        if (SHELL_INFO_STRINGS.has(info)) {
          flushProse();
          state = 'shell';
          continue;
        }
        if (info === 'qmux') {
          flushProse();
          state = 'qmux';
          continue;
        }
        // Unknown/empty info string: not executable — keep as literal prose text.
        proseLines.push(line);
        continue;
      }
      proseLines.push(line);
    } else {
      // state === 'shell' || state === 'qmux'
      if (trimmed === '```') {
        flushCommand(state);
        state = 'prose';
        continue;
      }
      commandLines.push(line);
    }
  }

  // End of input: flush whatever is left. An unclosed fence is treated
  // leniently — everything collected since the opening fence becomes its
  // block's content.
  if (state === 'prose') {
    flushProse();
  } else {
    flushCommand(state);
  }

  return blocks;
}

/**
 * Convenience wrapper over {@link parseAssistantMessage}: splits an
 * assistant message into the prose shown to the user and the ordered list
 * of executable shell/qmux commands.
 */
export function extractCommands(text: string): { prose: string; commands: QuakeCommand[] } {
  const blocks = parseAssistantMessage(text);

  const prose = blocks
    .filter((block): block is QuakeBlock & { kind: 'prose' } => block.kind === 'prose')
    .map((block) => block.content)
    .join('\n\n');

  const commands: QuakeCommand[] = blocks
    .filter((block): block is QuakeBlock & { kind: 'shell' | 'qmux' } => block.kind === 'shell' || block.kind === 'qmux')
    .map((block) => ({ kind: block.kind, content: block.content }));

  return { prose, commands };
}

/**
 * True if the assistant message contains at least one shell or qmux
 * command block. Used by the harness loop to decide whether to continue
 * executing or stop and wait for the user.
 */
export function hasCommands(text: string): boolean {
  return parseAssistantMessage(text).some((block) => block.kind === 'shell' || block.kind === 'qmux');
}
