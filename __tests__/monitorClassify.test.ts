import { describe, expect, it } from 'vitest';
import {
  parseFinishedVerdict,
  isShellCommand,
  SHELL_COMMAND_NAMES,
} from '../src/utils/monitorClassify.js';

describe('parseFinishedVerdict', () => {
  it('maps a clean FINISHED reply to finished', () => {
    expect(parseFinishedVerdict('FINISHED')).toBe('finished');
  });

  it('maps a clean STALLED reply to stalled', () => {
    expect(parseFinishedVerdict('STALLED')).toBe('stalled');
  });

  it('maps UNSURE to ambiguous', () => {
    expect(parseFinishedVerdict('UNSURE')).toBe('ambiguous');
  });

  it('is case- and punctuation-insensitive', () => {
    expect(parseFinishedVerdict('finished.')).toBe('finished');
    expect(parseFinishedVerdict('  Stalled\n')).toBe('stalled');
  });

  it('extracts the verdict from a short sentence', () => {
    expect(parseFinishedVerdict('The agent is STALLED, waiting for a nudge.')).toBe('stalled');
  });

  it('treats DONE/COMPLETE as finished and PAUSED/CONTINUE as stalled', () => {
    expect(parseFinishedVerdict('DONE')).toBe('finished');
    expect(parseFinishedVerdict('complete')).toBe('finished');
    expect(parseFinishedVerdict('paused')).toBe('stalled');
    expect(parseFinishedVerdict('continue')).toBe('stalled');
  });

  it('defaults to ambiguous on empty or unrecognized replies', () => {
    expect(parseFinishedVerdict('')).toBe('ambiguous');
    expect(parseFinishedVerdict('who knows')).toBe('ambiguous');
  });

  it('returns ambiguous when the reply contains conflicting signals', () => {
    expect(parseFinishedVerdict('FINISHED STALLED')).toBe('ambiguous');
  });
});

describe('isShellCommand', () => {
  it('recognizes common shells as a bare prompt (agent gone)', () => {
    for (const name of SHELL_COMMAND_NAMES) {
      expect(isShellCommand(name)).toBe(true);
    }
  });

  it('handles full paths and trailing whitespace', () => {
    expect(isShellCommand('/bin/zsh')).toBe(true);
    expect(isShellCommand('  bash \n')).toBe(true);
  });

  it('does not treat a running agent process as a shell', () => {
    expect(isShellCommand('claude')).toBe(false);
    expect(isShellCommand('node')).toBe(false);
    expect(isShellCommand('')).toBe(false);
  });
});
