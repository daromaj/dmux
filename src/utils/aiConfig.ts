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

function resolveApiKey(): string | undefined {
  // DMUX_AI_API_KEY takes priority, then fall back to OPENROUTER_API_KEY
  return process.env.DMUX_AI_API_KEY || process.env.OPENROUTER_API_KEY || undefined;
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
