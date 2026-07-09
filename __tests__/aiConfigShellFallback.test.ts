import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { readApiKeyFromShellConfigSync } from '../src/utils/aiConfig.js';

/**
 * Regression coverage for the tmux-stale-environment bug: dmux persists the API
 * key to the user's shell rc, but a dmux process spawned by a long-lived tmux
 * server inherits an environment without it. resolveApiKey() must be able to
 * recover the key by reading the same shell config file.
 */
describe('readApiKeyFromShellConfigSync', () => {
  let home: string;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'dmux-rc-'));
  });

  afterEach(() => {
    fs.rmSync(home, { recursive: true, force: true });
  });

  const writeRc = (name: string, content: string) => {
    fs.writeFileSync(path.join(home, name), content, 'utf-8');
  };

  it('reads a plain `export DMUX_AI_API_KEY=` line (unquoted)', () => {
    writeRc('.zshrc', 'export PATH=/usr/bin\nexport DMUX_AI_API_KEY=sk-plain-123\n');
    expect(readApiKeyFromShellConfigSync(home, '/bin/zsh')).toBe('sk-plain-123');
  });

  it('reads a single-quoted value', () => {
    writeRc('.zshrc', "export DMUX_AI_API_KEY='sk-quoted-abc'\n");
    expect(readApiKeyFromShellConfigSync(home, '/bin/zsh')).toBe('sk-quoted-abc');
  });

  it('reads a double-quoted value', () => {
    writeRc('.zshrc', 'export DMUX_AI_API_KEY="sk-dq-xyz"\n');
    expect(readApiKeyFromShellConfigSync(home, '/bin/zsh')).toBe('sk-dq-xyz');
  });

  it('falls back to OPENROUTER_API_KEY when DMUX_AI_API_KEY is absent', () => {
    writeRc('.zshrc', "export OPENROUTER_API_KEY='or-key-999'\n");
    expect(readApiKeyFromShellConfigSync(home, '/bin/zsh')).toBe('or-key-999');
  });

  it('prefers DMUX_AI_API_KEY over OPENROUTER_API_KEY', () => {
    writeRc('.zshrc', "export OPENROUTER_API_KEY='or-loser'\nexport DMUX_AI_API_KEY='dmux-winner'\n");
    expect(readApiKeyFromShellConfigSync(home, '/bin/zsh')).toBe('dmux-winner');
  });

  it('reads the dmux-managed block written by onboarding', () => {
    writeRc(
      '.zshrc',
      '# >>> dmux openrouter >>>\nexport OPENROUTER_API_KEY=\'sk-block\'\n# <<< dmux openrouter <<<\n',
    );
    expect(readApiKeyFromShellConfigSync(home, '/bin/zsh')).toBe('sk-block');
  });

  it('reads a fish `set -gx` line', () => {
    fs.mkdirSync(path.join(home, '.config', 'fish'), { recursive: true });
    fs.writeFileSync(
      path.join(home, '.config', 'fish', 'config.fish'),
      'set -gx DMUX_AI_API_KEY "sk-fish-1"\n',
      'utf-8',
    );
    expect(readApiKeyFromShellConfigSync(home, '/usr/bin/fish')).toBe('sk-fish-1');
  });

  it('returns undefined when no key is present', () => {
    writeRc('.zshrc', 'export PATH=/usr/bin\n');
    expect(readApiKeyFromShellConfigSync(home, '/bin/zsh')).toBeUndefined();
  });

  it('returns undefined when the rc file does not exist', () => {
    expect(readApiKeyFromShellConfigSync(home, '/bin/zsh')).toBeUndefined();
  });

  it('ignores commented-out export lines', () => {
    writeRc('.zshrc', '# export DMUX_AI_API_KEY=sk-commented\n');
    expect(readApiKeyFromShellConfigSync(home, '/bin/zsh')).toBeUndefined();
  });
});
