/**
 * AI Provider Configuration
 *
 * Resolves AI provider, model, and API endpoint from environment variables
 * and qmux settings. Supports OpenRouter (default), DeepSeek, and custom providers.
 *
 * Environment variables (highest priority):
 *   QMUX_AI_BASE_URL  - Full API endpoint URL
 *   QMUX_AI_MODEL     - Model name (comma-separated for fallback stack)
 *   QMUX_AI_API_KEY   - API key (falls back to OPENROUTER_API_KEY)
 *
 * Settings (qmux.config.json / .qmux.global.json):
 *   aiProvider - 'openrouter' | 'deepseek' | 'custom'
 *   aiModel    - Model name(s)
 *   aiBaseUrl  - API endpoint URL
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { getQmuxEnv } from './qmuxEnv.js';

export interface AiConfig {
  /** Resolved API key (may be undefined if not set) */
  apiKey: string | undefined;
  /** Full API endpoint URL (e.g. https://openrouter.ai/api/v1/chat/completions) */
  baseUrl: string;
  /** Primary model name */
  model: string;
  /** Fallback model stack (includes primary model as first element) */
  modelStack: string[];
  /** Provider identifier */
  provider: 'openrouter' | 'deepseek' | 'custom';
}

const OPENROUTER_DEFAULT_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEEPSEEK_DEFAULT_URL = 'https://api.deepseek.com/chat/completions';

const OPENROUTER_DEFAULT_MODEL_STACK = [
  'google/gemini-2.5-flash',
  'openai/gpt-4o-mini',
];

const OPENROUTER_FREE_FALLBACK_STACK = [
  'openai/gpt-oss-120b:free',
  'nvidia/nemotron-3-super-120b-a12b:free',
];

const DEEPSEEK_DEFAULT_MODEL = 'deepseek-v4-pro';

export interface AiConfigInput {
  aiProvider?: string;
  aiModel?: string;
  aiBaseUrl?: string;
  aiApiKey?: string;
}

function resolveProvider(input: AiConfigInput): 'openrouter' | 'deepseek' | 'custom' {
  const fromEnv = getQmuxEnv('AI_PROVIDER')?.toLowerCase();
  if (fromEnv === 'deepseek') return 'deepseek';
  if (fromEnv === 'openrouter') return 'openrouter';
  if (fromEnv === 'custom') return 'custom';

  const fromSettings = input.aiProvider?.toLowerCase();
  if (fromSettings === 'deepseek') return 'deepseek';
  if (fromSettings === 'openrouter') return 'openrouter';
  if (fromSettings === 'custom') return 'custom';

  // Detect from URL if set
  const url = getQmuxEnv('AI_BASE_URL') || input.aiBaseUrl;
  if (url) {
    if (url.includes('deepseek.com')) return 'deepseek';
    if (url.includes('openrouter.ai') || url.includes('l.ai')) return 'openrouter';
    return 'custom';
  }

  return 'openrouter';
}

function resolveModelStack(
  provider: 'openrouter' | 'deepseek' | 'custom',
  input: AiConfigInput,
): string[] {
  // Env var takes highest priority
  const envModel = getQmuxEnv('AI_MODEL');
  if (envModel) {
    return envModel.split(',').map(s => s.trim()).filter(Boolean);
  }

  // Settings
  if (input.aiModel) {
    return input.aiModel.split(',').map(s => s.trim()).filter(Boolean);
  }

  // Provider defaults
  if (provider === 'deepseek') {
    return [DEEPSEEK_DEFAULT_MODEL];
  }

  // openrouter or custom - use openrouter defaults
  return [...OPENROUTER_DEFAULT_MODEL_STACK];
}

function resolveBaseUrl(
  provider: 'openrouter' | 'deepseek' | 'custom',
  input: AiConfigInput,
): string {
  const envUrl = getQmuxEnv('AI_BASE_URL');
  if (envUrl) return envUrl;

  if (input.aiBaseUrl) return input.aiBaseUrl;

  if (provider === 'deepseek') return DEEPSEEK_DEFAULT_URL;
  return OPENROUTER_DEFAULT_URL;
}

const GLOBAL_SETTINGS_PATH = path.join(os.homedir() || '', '.qmux.global.json');

/** Read the AI-related fields from a single qmux settings JSON file. */
function readAiSettingsFromFile(filePath: string): AiConfigInput {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return {}; // file missing / unreadable
  }
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {}; // malformed JSON
  }
  const out: AiConfigInput = {};
  const str = (v: unknown): string | undefined =>
    typeof v === 'string' && v.length > 0 ? v : undefined;
  out.aiProvider = str(parsed?.aiProvider);
  out.aiModel = str(parsed?.aiModel);
  out.aiBaseUrl = str(parsed?.aiBaseUrl);
  out.aiApiKey = str(parsed?.aiApiKey);
  return out;
}

/**
 * Read AI settings (provider/model/baseUrl/apiKey) from qmux settings files.
 * This is the persisted fallback for the tmux-stale-environment case: a qmux
 * process spawned by a long-lived tmux server inherits an environment without
 * the AI env vars even when the shell defines them, so it must resolve config
 * from disk. Storing these in the settings file makes qmux work regardless of
 * the process environment.
 *
 * Project settings (<cwd>/.qmux/settings.json) override global
 * (~/.qmux.global.json). Exported for testing; synchronous.
 */
export function readAiSettingsSync(
  cwd: string,
  globalPath: string = GLOBAL_SETTINGS_PATH,
): AiConfigInput {
  const projectPath = path.join(cwd, '.qmux', 'settings.json');
  const globalSettings = readAiSettingsFromFile(globalPath);
  const projectSettings = readAiSettingsFromFile(projectPath);
  // Project overrides global; drop undefined so they don't clobber.
  return {
    ...stripUndefined(globalSettings),
    ...stripUndefined(projectSettings),
  };
}

/** Back-compat helper: just the API key from settings files. */
export function readApiKeyFromSettingsSync(
  cwd: string,
  globalPath: string = GLOBAL_SETTINGS_PATH,
): string | undefined {
  return readAiSettingsSync(cwd, globalPath).aiApiKey;
}

function stripUndefined(input: AiConfigInput): AiConfigInput {
  const out: AiConfigInput = {};
  for (const [k, v] of Object.entries(input)) {
    if (v !== undefined) (out as any)[k] = v;
  }
  return out;
}

let cachedDiskSettings: AiConfigInput | null = null;

function getDiskAiSettings(): AiConfigInput {
  // Read once per process and cache — the settings file doesn't change under us,
  // and this backs every getAiConfig() call.
  if (cachedDiskSettings === null) {
    try {
      cachedDiskSettings = readAiSettingsSync(process.cwd());
    } catch {
      cachedDiskSettings = {};
    }
  }
  return cachedDiskSettings;
}

function resolveApiKey(input: AiConfigInput): string | undefined {
  // Environment (explicit override) wins; QMUX_AI_API_KEY (falling back to
  // legacy DMUX_AI_API_KEY) then OPENROUTER_API_KEY.
  return (
    getQmuxEnv('AI_API_KEY') ||
    process.env.OPENROUTER_API_KEY ||
    input.aiApiKey ||
    undefined
  );
}

/**
 * Resolve the full AI configuration. Priority for every field:
 *   environment  >  explicit `input`  >  qmux settings files  >  built-in default
 *
 * Disk settings are folded UNDER `input` so callers that already loaded merged
 * settings behave identically, while callers passing nothing (slug, merge, the
 * quake popup) still get the persisted config — keeping provider/model/baseUrl
 * and the API key from drifting apart (e.g. a DeepSeek key with the OpenRouter
 * endpoint).
 */
export function getAiConfig(input: AiConfigInput = {}): AiConfig {
  const merged: AiConfigInput = {
    ...getDiskAiSettings(),
    ...stripUndefined(input),
  };
  const provider = resolveProvider(merged);
  const modelStack = resolveModelStack(provider, merged);
  const baseUrl = resolveBaseUrl(provider, merged);
  const apiKey = resolveApiKey(merged);
  const model = modelStack[0] || '';

  return {
    apiKey,
    baseUrl,
    model,
    modelStack,
    provider,
  };
}

/**
 * Get the default OpenRouter model stack (used when no custom config).
 */
export function getOpenRouterPreferredStack(): string[] {
  return [...OPENROUTER_DEFAULT_MODEL_STACK];
}

/**
 * Get the free fallback model stack (used by PaneAnalyzer when preferred models fail).
 */
export function getOpenRouterFreeFallbackStack(): string[] {
  return [...OPENROUTER_FREE_FALLBACK_STACK];
}

/**
 * Quick check: is a custom AI provider configured?
 */
export function hasCustomAiConfig(): boolean {
  return !!(getQmuxEnv('AI_BASE_URL') ||
    getQmuxEnv('AI_MODEL') ||
    getQmuxEnv('AI_PROVIDER'));
}
