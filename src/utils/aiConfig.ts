/**
 * AI Provider Configuration
 *
 * Resolves AI provider, model, and API endpoint from environment variables
 * and dmux settings. Supports OpenRouter (default), DeepSeek, and custom providers.
 *
 * Environment variables (highest priority):
 *   DMUX_AI_BASE_URL  - Full API endpoint URL
 *   DMUX_AI_MODEL     - Model name (comma-separated for fallback stack)
 *   DMUX_AI_API_KEY   - API key (falls back to OPENROUTER_API_KEY)
 *
 * Settings (dmux.config.json / .dmux.global.json):
 *   aiProvider - 'openrouter' | 'deepseek' | 'custom'
 *   aiModel    - Model name(s)
 *   aiBaseUrl  - API endpoint URL
 */

import fs from 'fs';
import os from 'os';
import { getShellConfigCandidates } from './openRouterApiKeySetup.js';

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
}

function resolveProvider(input: AiConfigInput): 'openrouter' | 'deepseek' | 'custom' {
  const fromEnv = process.env.DMUX_AI_PROVIDER?.toLowerCase();
  if (fromEnv === 'deepseek') return 'deepseek';
  if (fromEnv === 'openrouter') return 'openrouter';
  if (fromEnv === 'custom') return 'custom';

  const fromSettings = input.aiProvider?.toLowerCase();
  if (fromSettings === 'deepseek') return 'deepseek';
  if (fromSettings === 'openrouter') return 'openrouter';
  if (fromSettings === 'custom') return 'custom';

  // Detect from URL if set
  const url = process.env.DMUX_AI_BASE_URL || input.aiBaseUrl;
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
  const envModel = process.env.DMUX_AI_MODEL;
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
  const envUrl = process.env.DMUX_AI_BASE_URL;
  if (envUrl) return envUrl;

  if (input.aiBaseUrl) return input.aiBaseUrl;

  if (provider === 'deepseek') return DEEPSEEK_DEFAULT_URL;
  return OPENROUTER_DEFAULT_URL;
}

const API_KEY_VAR_PRIORITY = ['DMUX_AI_API_KEY', 'OPENROUTER_API_KEY'] as const;

/** Strip one layer of matching single/double quotes from a shell value. */
function unquoteShellValue(raw: string): string {
  const trimmed = raw.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith("'") && trimmed.endsWith("'")) ||
      (trimmed.startsWith('"') && trimmed.endsWith('"')))
  ) {
    return trimmed.slice(1, -1);
  }
  // Value may be followed by a trailing comment or extra tokens; keep the first token.
  return trimmed.split(/\s+/)[0] ?? '';
}

/** Extract `NAME`'s value from a single shell-config line, or undefined. */
function extractVarFromLine(line: string, name: string): string | undefined {
  const stripped = line.trim();
  if (!stripped || stripped.startsWith('#')) return undefined;

  // POSIX: `export NAME=value` or `NAME=value`
  const posix = new RegExp(`^(?:export\\s+)?${name}=(.*)$`);
  const posixMatch = stripped.match(posix);
  if (posixMatch) {
    const value = unquoteShellValue(posixMatch[1]);
    return value.length ? value : undefined;
  }

  // fish: `set -gx NAME value` / `set -x NAME value`
  const fish = new RegExp(`^set\\s+(?:-[a-zA-Z]+\\s+)*${name}\\s+(.*)$`);
  const fishMatch = stripped.match(fish);
  if (fishMatch) {
    const value = unquoteShellValue(fishMatch[1]);
    return value.length ? value : undefined;
  }

  return undefined;
}

/**
 * Recover the API key from the user's shell config files (the same files dmux's
 * onboarding writes to). This is the fallback for the tmux-stale-environment
 * case: a dmux process spawned by a long-lived tmux server inherits an
 * environment without the key even though the shell rc defines it.
 *
 * Exported for testing. Synchronous so it can back `resolveApiKey()`.
 */
export function readApiKeyFromShellConfigSync(
  homeDir: string,
  shellPath: string | undefined,
): string | undefined {
  const candidates = getShellConfigCandidates(shellPath, homeDir);
  // DMUX_AI_API_KEY wins over OPENROUTER_API_KEY across all files.
  for (const name of API_KEY_VAR_PRIORITY) {
    for (const candidate of candidates) {
      let content: string;
      try {
        content = fs.readFileSync(candidate, 'utf-8');
      } catch {
        continue; // file missing / unreadable
      }
      for (const line of content.split('\n')) {
        const value = extractVarFromLine(line, name);
        if (value) return value;
      }
    }
  }
  return undefined;
}

let cachedShellConfigApiKey: string | undefined;
let shellConfigApiKeyScanned = false;

function resolveApiKey(): string | undefined {
  // DMUX_AI_API_KEY takes priority, then fall back to OPENROUTER_API_KEY.
  const fromEnv = process.env.DMUX_AI_API_KEY || process.env.OPENROUTER_API_KEY;
  if (fromEnv) return fromEnv;

  // Env is empty — most commonly because a long-lived tmux server spawned this
  // dmux with a stale environment. Recover from the shell rc dmux persists to.
  if (!shellConfigApiKeyScanned) {
    shellConfigApiKeyScanned = true;
    const homeDir = process.env.HOME || os.homedir();
    if (homeDir) {
      try {
        cachedShellConfigApiKey = readApiKeyFromShellConfigSync(
          homeDir,
          process.env.SHELL,
        );
      } catch {
        cachedShellConfigApiKey = undefined;
      }
    }
  }
  return cachedShellConfigApiKey;
}

/**
 * Resolve the full AI configuration from env vars and settings.
 * Settings come from the dmux settings system (merged global + project).
 */
export function getAiConfig(input: AiConfigInput = {}): AiConfig {
  const provider = resolveProvider(input);
  const modelStack = resolveModelStack(provider, input);
  const baseUrl = resolveBaseUrl(provider, input);
  const apiKey = resolveApiKey();
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
  return !!(process.env.DMUX_AI_BASE_URL ||
    process.env.DMUX_AI_MODEL ||
    process.env.DMUX_AI_PROVIDER);
}
