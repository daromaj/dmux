/**
 * Parser/dispatcher for `qmux:` control verbs emitted by the quake-mode
 * assistant inside fenced ```qmux blocks (see docs/superpowers/specs/
 * 2026-07-09-quake-mode-assistant-design.md and src/utils/quakeTypes.ts).
 *
 * This module is intentionally free of side effects: every verb is routed
 * into an injected `QuakeControlHandlers` implementation. That keeps it
 * pure and unit-testable — the wiring layer (QmuxApp) supplies handlers
 * that close over real settings/layout state.
 */

import type { QuakeControlHandlers } from './quakeTypes.js';

const GRID_MIN = 1;
const GRID_MAX = 4;

export interface ParsedControlVerb {
  verb: string;
  args: string[];
}

/**
 * Parse a single control-block line into a verb + args tuple.
 * Returns null for blank lines and comment lines (starting with `#`).
 */
export function parseControlVerb(line: string): ParsedControlVerb | null {
  const trimmed = line.trim();
  if (trimmed === '' || trimmed.startsWith('#')) {
    return null;
  }
  const tokens = trimmed.split(/\s+/);
  const verb = tokens[0].toLowerCase();
  const args = tokens.slice(1);
  return { verb, args };
}

/** Format a handler rejection/throw into a single-line error note. */
function toErrorNote(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return `Error: ${message}`;
}

/** Run a single already-parsed verb against the injected handlers. */
async function dispatchVerb(parsed: ParsedControlVerb, handlers: QuakeControlHandlers): Promise<string> {
  const { verb, args } = parsed;

  try {
    switch (verb) {
      case 'grid': {
        const raw = (args[0] ?? '').toLowerCase();
        if (raw === 'auto' || raw === '0') {
          return await handlers.setGridColumns('auto');
        }
        const n = Number(raw);
        if (!Number.isInteger(n) || n < GRID_MIN || n > GRID_MAX) {
          return `Invalid grid columns: ${args[0] ?? ''} (expected auto or 1-4)`;
        }
        return await handlers.setGridColumns(n);
      }

      case 'control': {
        const raw = (args[0] ?? '').toLowerCase();
        if (raw !== 'bottom' && raw !== 'left') {
          return `Invalid control position: ${args[0] ?? ''} (expected bottom or left)`;
        }
        return await handlers.setControlPosition(raw);
      }

      case 'color': {
        const [paneRef, ...rest] = args;
        const color = rest.join(' ');
        if (!paneRef || !color) {
          return `Invalid color command: expected "color <paneRef> <colorName>"`;
        }
        return await handlers.setPaneColor(paneRef, color);
      }

      case 'layout': {
        const sub = (args[0] ?? '').toLowerCase();
        if (sub !== 'refresh') {
          return `Unknown qmux verb: layout ${args.join(' ')}`.trimEnd();
        }
        return await handlers.refreshLayout();
      }

      case 'refresh':
        return await handlers.refreshLayout();

      default:
        return `Unknown qmux verb: ${verb}${args.length ? ' ' + args.join(' ') : ''}`;
    }
  } catch (err) {
    return toErrorNote(err);
  }
}

/**
 * Run every verb line in a ```qmux control block, in order, against the
 * injected handlers. Never throws — a failing/unknown verb is turned into
 * an error result line so it doesn't abort the rest of the block.
 * Returns all per-line result notes joined by newlines.
 */
export async function runControlBlock(block: string, handlers: QuakeControlHandlers): Promise<string> {
  const lines = block.split('\n');
  const notes: string[] = [];

  for (const line of lines) {
    const parsed = parseControlVerb(line);
    if (!parsed) continue;
    const note = await dispatchVerb(parsed, handlers);
    notes.push(note);
  }

  return notes.join('\n');
}
