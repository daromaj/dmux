import { describe, it, expect } from 'vitest';
import {
  parseSlashCommand,
  QUAKE_SLASH_COMMANDS_HELP,
} from '../src/utils/quakeSlashCommands.js';

describe('parseSlashCommand', () => {
  it('returns none for non-slash text', () => {
    expect(parseSlashCommand('do the thing')).toEqual({ kind: 'none' });
    expect(parseSlashCommand('  hello  ')).toEqual({ kind: 'none' });
    expect(parseSlashCommand('')).toEqual({ kind: 'none' });
  });

  it('treats text with a mid-string slash as normal chat', () => {
    expect(parseSlashCommand('run a/b test')).toEqual({ kind: 'none' });
  });

  describe('/new', () => {
    it('parses /new', () => {
      expect(parseSlashCommand('/new')).toEqual({ kind: 'new' });
    });

    it('is forgiving of whitespace and casing', () => {
      expect(parseSlashCommand('   /NEW   ')).toEqual({ kind: 'new' });
    });

    it('ignores trailing args on /new', () => {
      expect(parseSlashCommand('/new please')).toEqual({ kind: 'new' });
    });
  });

  describe('/loop plain (until Esc)', () => {
    it('parses /loop <prompt> with no count', () => {
      expect(parseSlashCommand('/loop check the tests')).toEqual({
        kind: 'loop',
        prompt: 'check the tests',
      });
    });

    it('collapses extra whitespace after the verb', () => {
      expect(parseSlashCommand('/loop    keep going')).toEqual({
        kind: 'loop',
        prompt: 'keep going',
      });
    });

    it('reports usage for a bare /loop', () => {
      const result = parseSlashCommand('/loop');
      expect(result.kind).toBe('unknown');
      if (result.kind === 'unknown') {
        expect(result.name).toBe('loop');
        expect(result.message).toContain('Usage');
      }
    });
  });

  describe('/loop <N> <prompt>', () => {
    it('parses an integer count', () => {
      expect(parseSlashCommand('/loop 5 run the suite')).toEqual({
        kind: 'loop',
        prompt: 'run the suite',
        times: 5,
      });
    });

    it('treats a leading number with no prompt as a plain prompt', () => {
      // "/loop 5" has no prompt after the number, so the whole rest is the prompt.
      expect(parseSlashCommand('/loop 5')).toEqual({
        kind: 'loop',
        prompt: '5',
      });
    });

    it('does not treat a decimal as a count', () => {
      const result = parseSlashCommand('/loop 2.5 things');
      expect(result).toEqual({ kind: 'loop', prompt: '2.5 things' });
    });
  });

  describe('/loop until <condition> <prompt>', () => {
    it('parses a single-word condition', () => {
      expect(parseSlashCommand('/loop until done keep improving')).toEqual({
        kind: 'loop',
        prompt: 'keep improving',
        until: 'done',
      });
    });

    it('parses a quoted multi-word condition', () => {
      expect(
        parseSlashCommand('/loop until "all tests pass" run the suite'),
      ).toEqual({
        kind: 'loop',
        prompt: 'run the suite',
        until: 'all tests pass',
      });
    });

    it('parses a single-quoted condition', () => {
      expect(parseSlashCommand("/loop until 'green' fix it")).toEqual({
        kind: 'loop',
        prompt: 'fix it',
        until: 'green',
      });
    });

    it('is case-insensitive on the until keyword', () => {
      expect(parseSlashCommand('/loop UNTIL done work')).toEqual({
        kind: 'loop',
        prompt: 'work',
        until: 'done',
      });
    });

    it('reports usage when the prompt is missing', () => {
      const result = parseSlashCommand('/loop until done');
      expect(result.kind).toBe('unknown');
      if (result.kind === 'unknown') {
        expect(result.name).toBe('loop');
      }
    });
  });

  describe('unknown commands', () => {
    it('reports unknown slash commands with the name', () => {
      expect(parseSlashCommand('/teleport mars')).toEqual({
        kind: 'unknown',
        name: 'teleport',
      });
    });

    it('lowercases the reported name', () => {
      expect(parseSlashCommand('/FOO')).toEqual({ kind: 'unknown', name: 'foo' });
    });

    it('handles a lone slash', () => {
      expect(parseSlashCommand('/')).toEqual({ kind: 'unknown', name: '' });
    });
  });

  it('exposes help text', () => {
    expect(QUAKE_SLASH_COMMANDS_HELP).toContain('/new');
    expect(QUAKE_SLASH_COMMANDS_HELP).toContain('/loop');
  });
});
