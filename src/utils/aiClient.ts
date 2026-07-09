/**
 * Reusable OpenAI-compatible chat client for the quake-mode assistant.
 *
 * Mirrors the proven request shape used by `PaneAnalyzer.tryModel` (headers,
 * body layout, auth), but adds SSE streaming support driven by
 * `ChatCompletionOptions.onToken` and returns free-form text instead of
 * forcing a JSON response format.
 */

import { getAiConfig, type AiConfigInput } from './aiConfig.js';
import type { ChatCompletionOptions } from './quakeTypes.js';

const DEFAULT_TEMPERATURE = 0.3;
const DEFAULT_MAX_TOKENS = 2048;

/**
 * Check whether an AI API key is configured, without needing to catch the
 * error `callChatCompletion` throws when it's missing.
 */
export function hasApiKey(configInput?: AiConfigInput): boolean {
  const config = getAiConfig(configInput ?? {});
  return !!config.apiKey;
}

/** Shared request headers (mirrors PaneAnalyzer.tryModel). */
function buildHeaders(apiKey: string): Record<string, string> {
  return {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'HTTP-Referer': 'https://github.com/qmux/qmux',
    'X-Title': 'qmux',
  };
}

function isAbortError(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as { name?: string }).name === 'AbortError';
}

/**
 * Send a non-streaming chat completion request and return the assistant's
 * message content (or '' if the response has no content).
 */
async function requestNonStreaming(
  baseUrl: string,
  apiKey: string,
  model: string,
  opts: ChatCompletionOptions,
  temperature: number,
  maxTokens: number,
): Promise<string> {
  const response = await fetch(baseUrl, {
    method: 'POST',
    headers: buildHeaders(apiKey),
    body: JSON.stringify({
      model,
      messages: opts.messages,
      temperature,
      max_tokens: maxTokens,
    }),
    signal: opts.signal,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`AI API error: ${response.status} ${errorText}`);
  }

  const data = (await response.json()) as any;
  const content = data?.choices?.[0]?.message?.content ?? '';
  const reasoning =
    data?.choices?.[0]?.message?.reasoning_content ||
    data?.choices?.[0]?.message?.reasoning ||
    data?.choices?.[0]?.message?.thinking ||
    '';
  if (reasoning && opts.onThinkingToken) {
    opts.onThinkingToken(reasoning);
  }
  return content;
}

/**
 * Send a streaming chat completion request, invoking `opts.onToken` for each
 * content delta as it arrives over SSE. Returns the full accumulated text.
 *
 * Throws on failure (non-ok status, missing body, or a parse error before any
 * token was emitted) so the caller can fall back to a non-streaming request.
 * AbortErrors are rethrown as-is and must NOT trigger a fallback.
 */
async function requestStreaming(
  baseUrl: string,
  apiKey: string,
  model: string,
  opts: ChatCompletionOptions,
  temperature: number,
  maxTokens: number,
): Promise<string> {
  const response = await fetch(baseUrl, {
    method: 'POST',
    headers: buildHeaders(apiKey),
    body: JSON.stringify({
      model,
      messages: opts.messages,
      temperature,
      max_tokens: maxTokens,
      stream: true,
    }),
    signal: opts.signal,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`AI API error: ${response.status} ${errorText}`);
  }

  if (!response.body) {
    throw new Error('AI API error: streaming response has no body');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';
  let emittedAny = false;

  const processLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) return;
    const payload = trimmed.slice('data:'.length).trim();
    if (!payload || payload === '[DONE]') return;

    try {
      const chunk = JSON.parse(payload);
      const delta: string | undefined = chunk?.choices?.[0]?.delta?.content;
      const reasoningDelta: string | undefined =
        chunk?.choices?.[0]?.delta?.reasoning_content ||
        chunk?.choices?.[0]?.delta?.reasoning ||
        chunk?.choices?.[0]?.delta?.thinking;

      if (reasoningDelta && opts.onThinkingToken) {
        emittedAny = true;
        opts.onThinkingToken(reasoningDelta);
      }
      if (delta) {
        full += delta;
        emittedAny = true;
        opts.onToken!(delta);
      }
    } catch {
      // JSON parse error, ignore malformed stream chunk
    }
  };

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      // Keep the last (possibly incomplete) line in the buffer.
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        processLine(line);
      }
    }
    // Flush any trailing buffered line (e.g. stream ended without a
    // trailing newline).
    if (buffer.trim()) {
      processLine(buffer);
    }
  } catch (err) {
    if (isAbortError(err)) throw err;
    if (emittedAny) {
      // Some tokens already reached the caller; return what we have rather
      // than falling back and duplicating output.
      return full;
    }
    throw err;
  }

  return full;
}

/**
 * Call the configured OpenAI-compatible chat completion endpoint.
 *
 * - Resolves provider/model/baseUrl/apiKey via `getAiConfig`.
 * - If `opts.onToken` is set, streams the response and reports each delta;
 *   falls back to a single non-streaming request if streaming fails before
 *   any token was emitted.
 * - Otherwise sends a plain (non-streaming) request.
 *
 * Throws if no API key is configured, on non-ok HTTP status, or if the
 * request is aborted via `opts.signal`.
 */
export async function callChatCompletion(
  opts: ChatCompletionOptions,
  configInput?: AiConfigInput,
): Promise<string> {
  const config = getAiConfig(configInput ?? {});
  if (!config.apiKey) {
    throw new Error('No AI API key configured. Set QMUX_AI_API_KEY or OPENROUTER_API_KEY.');
  }

  const temperature = opts.temperature ?? DEFAULT_TEMPERATURE;
  const maxTokens = opts.maxTokens ?? DEFAULT_MAX_TOKENS;

  if (opts.onToken) {
    try {
      return await requestStreaming(
        config.baseUrl,
        config.apiKey,
        config.model,
        opts,
        temperature,
        maxTokens,
      );
    } catch (err) {
      if (isAbortError(err)) throw err;
      // Streaming failed before any token was emitted (or the stream itself
      // errored out entirely) — fall back to a non-streaming request.
      return requestNonStreaming(
        config.baseUrl,
        config.apiKey,
        config.model,
        opts,
        temperature,
        maxTokens,
      );
    }
  }

  return requestNonStreaming(config.baseUrl, config.apiKey, config.model, opts, temperature, maxTokens);
}
