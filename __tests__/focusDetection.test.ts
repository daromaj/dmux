import { describe, expect, it } from 'vitest';
import {
  buildFocusToken,
  buildFocusWindowTitle,
  buildTerminalTitleSequence,
  mapTerminalProgramToBundleId,
  parseTmuxSocketPath,
  supportsNativeQmuxHelper,
} from '../src/utils/focusDetection.js';

describe('focusDetection utils', () => {
  it('builds a compact focus token from an instance id', () => {
    expect(buildFocusToken('123e4567-e89b-12d3-a456-426614174000')).toBe('dmx-123e4567');
  });

  it('builds a focus window title including the token', () => {
    expect(buildFocusWindowTitle('qmux', 'dmx-abc123')).toBe('qmux qmux [dmx-abc123]');
  });

  it('wraps terminal titles for tmux passthrough when needed', () => {
    expect(buildTerminalTitleSequence('qmux demo', false)).toBe('\u001b]2;qmux demo\u0007');
    expect(buildTerminalTitleSequence('qmux demo', true)).toContain('\u001bPtmux;');
  });

  it('maps known terminal programs to bundle ids', () => {
    expect(mapTerminalProgramToBundleId('Apple_Terminal')).toBe('com.apple.Terminal');
    expect(mapTerminalProgramToBundleId('iTerm.app')).toBe('com.googlecode.iterm2');
    expect(mapTerminalProgramToBundleId('Ghostty')).toBe('com.mitchellh.ghostty');
    expect(mapTerminalProgramToBundleId('ghostty')).toBe('com.mitchellh.ghostty');
    expect(mapTerminalProgramToBundleId('unknown')).toBeUndefined();
  });

  it('parses the tmux socket path from the TMUX environment variable', () => {
    expect(parseTmuxSocketPath('/tmp/tmux-501/default,1234,0')).toBe('/tmp/tmux-501/default');
    expect(parseTmuxSocketPath('')).toBeUndefined();
    expect(parseTmuxSocketPath(undefined)).toBeUndefined();
  });

  it('only enables the native qmux helper on macOS', () => {
    expect(supportsNativeQmuxHelper('darwin')).toBe(true);
    expect(supportsNativeQmuxHelper('linux')).toBe(false);
    expect(supportsNativeQmuxHelper('win32')).toBe(false);
  });
});
