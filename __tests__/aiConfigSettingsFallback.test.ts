import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { readApiKeyFromSettingsSync, readAiSettingsSync } from '../src/utils/aiConfig.js';

/**
 * Regression coverage for the tmux-stale-environment bug: qmux processes spawned
 * by a long-lived tmux server inherit an environment without the API key. Storing
 * `aiApiKey` in the qmux settings file lets resolveApiKey() recover it from disk.
 *
 * The global path is injected here so the tests never touch the real
 * ~/.qmux.global.json.
 */
describe('readApiKeyFromSettingsSync', () => {
  let cwd: string;
  let globalPath: string;

  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'qmux-settings-'));
    fs.mkdirSync(path.join(cwd, '.qmux'), { recursive: true });
    globalPath = path.join(cwd, 'global.json'); // isolated, does not exist by default
  });

  afterEach(() => {
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  const writeProjectSettings = (obj: unknown) => {
    fs.writeFileSync(
      path.join(cwd, '.qmux', 'settings.json'),
      JSON.stringify(obj),
      'utf-8',
    );
  };
  const writeGlobalSettings = (obj: unknown) => {
    fs.writeFileSync(globalPath, JSON.stringify(obj), 'utf-8');
  };

  it('reads aiApiKey from project settings', () => {
    writeProjectSettings({ aiApiKey: 'sk-from-project', aiProvider: 'deepseek' });
    expect(readApiKeyFromSettingsSync(cwd, globalPath)).toBe('sk-from-project');
  });

  it('reads aiApiKey from global settings when project has none', () => {
    writeGlobalSettings({ aiApiKey: 'sk-from-global' });
    expect(readApiKeyFromSettingsSync(cwd, globalPath)).toBe('sk-from-global');
  });

  it('project settings override global', () => {
    writeGlobalSettings({ aiApiKey: 'sk-global-loser' });
    writeProjectSettings({ aiApiKey: 'sk-project-winner' });
    expect(readApiKeyFromSettingsSync(cwd, globalPath)).toBe('sk-project-winner');
  });

  it('returns undefined when aiApiKey is absent everywhere', () => {
    writeProjectSettings({ aiProvider: 'deepseek' });
    expect(readApiKeyFromSettingsSync(cwd, globalPath)).toBeUndefined();
  });

  it('returns undefined when aiApiKey is empty', () => {
    writeProjectSettings({ aiApiKey: '' });
    expect(readApiKeyFromSettingsSync(cwd, globalPath)).toBeUndefined();
  });

  it('returns undefined when no settings files exist', () => {
    expect(readApiKeyFromSettingsSync(cwd, globalPath)).toBeUndefined();
  });

  it('returns undefined on malformed JSON (does not throw)', () => {
    fs.writeFileSync(path.join(cwd, '.qmux', 'settings.json'), '{ not json', 'utf-8');
    expect(readApiKeyFromSettingsSync(cwd, globalPath)).toBeUndefined();
  });

  it('ignores a non-string aiApiKey', () => {
    writeProjectSettings({ aiApiKey: 12345 });
    expect(readApiKeyFromSettingsSync(cwd, globalPath)).toBeUndefined();
  });
});

describe('readAiSettingsSync (provider/model/baseUrl + key)', () => {
  let cwd: string;
  let globalPath: string;

  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'qmux-ai-'));
    fs.mkdirSync(path.join(cwd, '.qmux'), { recursive: true });
    globalPath = path.join(cwd, 'global.json');
  });

  afterEach(() => {
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  const writeProject = (obj: unknown) =>
    fs.writeFileSync(path.join(cwd, '.qmux', 'settings.json'), JSON.stringify(obj), 'utf-8');
  const writeGlobal = (obj: unknown) =>
    fs.writeFileSync(globalPath, JSON.stringify(obj), 'utf-8');

  it('reads the full AI block from global settings', () => {
    // Regression: a DeepSeek key must not drift from an OpenRouter provider.
    writeGlobal({
      aiProvider: 'deepseek',
      aiModel: 'deepseek-v4-pro',
      aiBaseUrl: 'https://api.deepseek.com/chat/completions',
      aiApiKey: 'sk-deep',
    });
    expect(readAiSettingsSync(cwd, globalPath)).toEqual({
      aiProvider: 'deepseek',
      aiModel: 'deepseek-v4-pro',
      aiBaseUrl: 'https://api.deepseek.com/chat/completions',
      aiApiKey: 'sk-deep',
    });
  });

  it('project fields override global, missing project fields fall through', () => {
    writeGlobal({ aiProvider: 'openrouter', aiModel: 'gpt-x', aiApiKey: 'sk-global' });
    writeProject({ aiProvider: 'deepseek' });
    const merged = readAiSettingsSync(cwd, globalPath);
    expect(merged.aiProvider).toBe('deepseek'); // project override
    expect(merged.aiModel).toBe('gpt-x'); // fell through from global
    expect(merged.aiApiKey).toBe('sk-global'); // fell through from global
  });

  it('returns an empty object when nothing is configured', () => {
    expect(readAiSettingsSync(cwd, globalPath)).toEqual({});
  });
});
