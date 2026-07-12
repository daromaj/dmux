/**
 * Parser for `/` slash commands typed into the quake-mode assistant chat.
 *
 * Like quakeControlVerbs.ts this module is intentionally pure and side-effect
 * free: it turns a raw input line into a discriminated union that the service
 * layer (QuakeAssistantService.handleUserInput) acts on. That keeps parsing
 * fully unit-testable and the effects (reset, loop, chat) in one place.
 *
 * Recognized forms (leading `/`, forgiving of extra whitespace):
 *   /new                          -> { kind: 'new' }
 *   /loop <prompt>                -> { kind: 'loop', prompt } (repeat until Esc)
 *   /loop <N> <prompt>            -> { kind: 'loop', prompt, times: N }
 *   /loop until <cond> <prompt>   -> { kind: 'loop', prompt, until: cond }
 *   /<other>                      -> { kind: 'unknown', name }
 *   non-slash text                -> { kind: 'none' } (falls through to chat)
 *
 * For the until-form, the condition is the first whitespace-delimited token, or
 * a quoted string when it spans multiple words:
 *   /loop until done keep working
 *   /loop until "all tests pass" run the suite
 */

export type QuakeSlashCommand =
  | { kind: 'none' }
  | { kind: 'new' }
  | { kind: 'loop'; prompt: string; times?: number; until?: string }
  | { kind: 'unknown'; name: string; message?: string };

/** Human-readable help, usable in the system prompt or a UI hint. */
export const QUAKE_SLASH_COMMANDS_HELP = [
  'Slash commands:',
  '  /new                         start a fresh session (clears the chat)',
  '  /loop <prompt>               repeat <prompt> until Esc',
  '  /loop <N> <prompt>           repeat <prompt> N times',
  '  /loop until <cond> <prompt>  repeat until the reply contains <cond>',
].join('\n');

const LOOP_USAGE =
  'Usage: /loop <prompt>, /loop <N> <prompt>, or /loop until <condition> <prompt>';

/** Split the text after `until` into a condition + prompt. */
function splitUntil(remainder: string): { condition: string; prompt: string } {
  // Quoted condition can span multiple words: until "all tests pass" <prompt>
  const quoted = remainder.match(/^(["'])([\s\S]*?)\1\s*([\s\S]*)$/);
  if (quoted) {
    return { condition: quoted[2].trim(), prompt: quoted[3].trim() };
  }
  // Otherwise the condition is the first whitespace-delimited token.
  const spaceIdx = remainder.search(/\s/);
  if (spaceIdx === -1) {
    return { condition: remainder.trim(), prompt: '' };
  }
  return {
    condition: remainder.slice(0, spaceIdx).trim(),
    prompt: remainder.slice(spaceIdx + 1).trim(),
  };
}

function parseLoop(rest: string): QuakeSlashCommand {
  if (!rest) {
    return { kind: 'unknown', name: 'loop', message: LOOP_USAGE };
  }

  // until-mode: /loop until <condition> <prompt>
  const untilMatch = rest.match(/^until\s+([\s\S]+)$/i);
  if (untilMatch) {
    const { condition, prompt } = splitUntil(untilMatch[1].trim());
    if (!condition || !prompt) {
      return {
        kind: 'unknown',
        name: 'loop',
        message:
          'Usage: /loop until <condition> <prompt> (quote a multi-word condition)',
      };
    }
    return { kind: 'loop', prompt, until: condition };
  }

  // N-mode: /loop <N> <prompt> (integer count followed by a prompt)
  const nMatch = rest.match(/^(\d+)\s+([\s\S]+)$/);
  if (nMatch) {
    const times = parseInt(nMatch[1], 10);
    const prompt = nMatch[2].trim();
    if (times > 0 && prompt) {
      return { kind: 'loop', prompt, times };
    }
  }

  // Plain: /loop <prompt> (repeat until Esc)
  return { kind: 'loop', prompt: rest };
}

/** Parse a raw input line into a slash-command descriptor. */
export function parseSlashCommand(input: string): QuakeSlashCommand {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) {
    return { kind: 'none' };
  }

  // Separate the command name (first token) from the remainder.
  const match = trimmed.match(/^\/(\S+)\s*([\s\S]*)$/);
  if (!match) {
    // A lone "/" with nothing after it.
    return { kind: 'unknown', name: '' };
  }
  const name = match[1].toLowerCase();
  const rest = match[2].trim();

  switch (name) {
    case 'new':
      return { kind: 'new' };
    case 'loop':
      return parseLoop(rest);
    default:
      return { kind: 'unknown', name };
  }
}
