import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const AI_CONFIG_MODULE = '../src/utils/aiConfig.js';

/** Build a minimal AiConfig matching the shape returned by getAiConfig(). */
function makeAiConfig(overrides: Partial<{
  apiKey: string | undefined;
  baseUrl: string;
  model: string;
}> = {}) {
  return {
    apiKey: 'test-key',
    baseUrl: 'https://openrouter.ai/api/v1/chat/completions',
    model: 'google/gemini-2.5-flash',
    modelStack: ['google/gemini-2.5-flash'],
    provider: 'openrouter' as const,
    ...overrides,
  };
}

/**
 * Build a fake `Response`-like object whose `.body` is a ReadableStream-ish
 * object exposing `getReader()` that yields the given SSE lines chunk by
 * chunk.
 */
function fakeStreamResponse(lines: string[], opts: { ok?: boolean; status?: number } = {}) {
  const encoder = new TextEncoder();
  let index = 0;
  return {
    ok: opts.ok ?? true,
    status: opts.status ?? 200,
    text: async () => '',
    body: {
      getReader() {
        return {
          async read() {
            if (index >= lines.length) {
              return { value: undefined, done: true };
            }
            const chunk = lines[index++];
            return { value: encoder.encode(chunk), done: false };
          },
        };
      },
    },
  };
}

function sseLine(delta: string): string {
  return `data: ${JSON.stringify({ choices: [{ delta: { content: delta } }] })}\n\n`;
}

describe('aiClient', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.doUnmock(AI_CONFIG_MODULE);
    vi.resetModules();
  });

  it('non-streaming returns message content', async () => {
    vi.doMock(AI_CONFIG_MODULE, () => ({
      getAiConfig: () => makeAiConfig(),
    }));
    const { callChatCompletion } = await import('../src/utils/aiClient.js');

    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ choices: [{ message: { content: 'hello there' } }] }),
        { status: 200 },
      ),
    );

    const result = await callChatCompletion({
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(result).toBe('hello there');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe('google/gemini-2.5-flash');
    expect(body.stream).toBeUndefined();
    expect(body.response_format).toBeUndefined();
    expect(init.headers['Authorization']).toBe('Bearer test-key');
  });

  it('throws when no apiKey is configured', async () => {
    vi.doMock(AI_CONFIG_MODULE, () => ({
      getAiConfig: () => makeAiConfig({ apiKey: undefined }),
    }));
    const { callChatCompletion, hasApiKey } = await import('../src/utils/aiClient.js');

    expect(hasApiKey()).toBe(false);
    await expect(
      callChatCompletion({ messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toThrow(/No AI API key configured/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('streaming calls onToken per delta and returns full concatenation', async () => {
    vi.doMock(AI_CONFIG_MODULE, () => ({
      getAiConfig: () => makeAiConfig(),
    }));
    const { callChatCompletion } = await import('../src/utils/aiClient.js');

    fetchMock.mockResolvedValueOnce(
      fakeStreamResponse([
        sseLine('Hello'),
        sseLine(', '),
        sseLine('world!'),
        'data: [DONE]\n\n',
      ]),
    );

    const tokens: string[] = [];
    const result = await callChatCompletion({
      messages: [{ role: 'user', content: 'hi' }],
      onToken: (delta) => tokens.push(delta),
    });

    expect(tokens).toEqual(['Hello', ', ', 'world!']);
    expect(result).toBe('Hello, world!');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(body.stream).toBe(true);
  });

  it('falls back to non-streaming when the stream fails before any token', async () => {
    vi.doMock(AI_CONFIG_MODULE, () => ({
      getAiConfig: () => makeAiConfig(),
    }));
    const { callChatCompletion } = await import('../src/utils/aiClient.js');

    // First call: streaming request whose body is missing -> triggers fallback.
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => '',
      body: null,
    });
    // Second call: non-streaming fallback succeeds.
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ choices: [{ message: { content: 'fallback content' } }] }),
        { status: 200 },
      ),
    );

    const tokens: string[] = [];
    const result = await callChatCompletion({
      messages: [{ role: 'user', content: 'hi' }],
      onToken: (delta) => tokens.push(delta),
    });

    expect(result).toBe('fallback content');
    expect(tokens).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondBody = JSON.parse(String(fetchMock.mock.calls[1][1].body));
    expect(secondBody.stream).toBeUndefined();
  });

  it('throws on HTTP non-ok status (non-streaming)', async () => {
    vi.doMock(AI_CONFIG_MODULE, () => ({
      getAiConfig: () => makeAiConfig(),
    }));
    const { callChatCompletion } = await import('../src/utils/aiClient.js');

    fetchMock.mockResolvedValueOnce(
      new Response('Internal Server Error', { status: 500 }),
    );

    await expect(
      callChatCompletion({ messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toThrow(/500/);
  });

  it('throws on HTTP non-ok status when streaming (no fallback swallow)', async () => {
    vi.doMock(AI_CONFIG_MODULE, () => ({
      getAiConfig: () => makeAiConfig(),
    }));
    const { callChatCompletion } = await import('../src/utils/aiClient.js');

    // Streaming request fails with non-ok.
    fetchMock.mockResolvedValueOnce(
      new Response('Bad Gateway', { status: 502 }),
    );
    // Fallback non-streaming request also fails.
    fetchMock.mockResolvedValueOnce(
      new Response('Bad Gateway', { status: 502 }),
    );

    await expect(
      callChatCompletion({
        messages: [{ role: 'user', content: 'hi' }],
        onToken: () => {},
      }),
    ).rejects.toThrow(/502/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('propagates AbortError without falling back to non-streaming', async () => {
    vi.doMock(AI_CONFIG_MODULE, () => ({
      getAiConfig: () => makeAiConfig(),
    }));
    const { callChatCompletion } = await import('../src/utils/aiClient.js');

    const abortError = new Error('The operation was aborted');
    abortError.name = 'AbortError';
    fetchMock.mockRejectedValueOnce(abortError);

    await expect(
      callChatCompletion({
        messages: [{ role: 'user', content: 'hi' }],
        onToken: () => {},
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
