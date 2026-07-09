import { describe, it, expect, vi } from 'vitest';
import { QuakeAssistantService } from '../src/services/QuakeAssistantService.js';
import type {
  ChatCompletionOptions,
  QuakeControlHandlers,
  QuakeWorkspaceContext,
} from '../src/utils/quakeTypes.js';

const ctx: QuakeWorkspaceContext = {
  sessionName: 'qmux-test',
  projectRoot: '/tmp/project',
  gridColumns: 0,
  controlPanePosition: 'bottom',
  panes: [{ id: 'p1', slug: 'feature-x', paneId: '%4', agent: 'claude' }],
};

function makeHandlers(): QuakeControlHandlers {
  return {
    setGridColumns: vi.fn(() => 'grid ok'),
    setControlPosition: vi.fn(() => 'control ok'),
    setPaneColor: vi.fn(() => 'color ok'),
    refreshLayout: vi.fn(() => 'refreshed'),
  };
}

/** Build a service whose model returns the given scripted responses in order. */
function makeService(
  responses: string[],
  overrides: Partial<{
    runShell: any;
    handlers: QuakeControlHandlers;
    maxSteps: number;
    stream: boolean;
  }> = {},
) {
  let call = 0;
  const complete = vi.fn(async (opts: ChatCompletionOptions) => {
    const text = responses[call++] ?? '';
    if (overrides.stream && opts.onToken) {
      for (const ch of text) opts.onToken(ch);
    }
    return text;
  });
  const runShell = overrides.runShell ?? vi.fn(async () => 'shell-output');
  const handlers = overrides.handlers ?? makeHandlers();
  const service = new QuakeAssistantService({
    getWorkspaceContext: () => ctx,
    controlHandlers: handlers,
    runShell,
    complete,
    maxSteps: overrides.maxSteps ?? 25,
  });
  return { service, complete, runShell, handlers };
}

describe('QuakeAssistantService', () => {
  it('ends on a prose-only response without running commands', async () => {
    const { service, complete, runShell } = makeService(['All done, nothing to do.']);
    await service.sendUserMessage('hi');

    expect(complete).toHaveBeenCalledTimes(1);
    expect(runShell).not.toHaveBeenCalled();
    const kinds = service.getEntries().map((e) => e.kind);
    expect(kinds).toEqual(['user', 'assistant']);
    expect(service.isBusy()).toBe(false);
  });

  it('runs a shell command, feeds the result back, then terminates', async () => {
    const { service, complete, runShell } = makeService([
      'Running it:\n```run\ntmux capture-pane -t %4 -p\n```',
      'Here is what the pane shows.',
    ]);
    await service.sendUserMessage('what does pane 4 say');

    expect(complete).toHaveBeenCalledTimes(2);
    expect(runShell).toHaveBeenCalledTimes(1);
    expect(runShell.mock.calls[0][0]).toContain('capture-pane -t %4');

    const kinds = service.getEntries().map((e) => e.kind);
    expect(kinds).toEqual(['user', 'assistant', 'command', 'output', 'assistant']);
    // Second model call must include the command result as a fed-back turn.
    const secondMessages = complete.mock.calls[1][0].messages;
    const fedBack = secondMessages.some(
      (m: any) => m.role === 'user' && m.content.includes('shell-output'),
    );
    expect(fedBack).toBe(true);
  });

  it('routes qmux control blocks through the injected handlers', async () => {
    const handlers = makeHandlers();
    const { service } = makeService(
      ['```qmux\ngrid 2\n```', 'Grid updated.'],
      { handlers },
    );
    await service.sendUserMessage('two columns please');

    expect(handlers.setGridColumns).toHaveBeenCalledWith(2);
  });

  it('streams assistant tokens via append events', async () => {
    const { service } = makeService(['hello world'], { stream: true });
    const deltas: string[] = [];
    service.on('append', ({ delta }: any) => deltas.push(delta));
    await service.sendUserMessage('hi');
    expect(deltas.join('')).toBe('hello world');
  });

  it('stops at the step cap', async () => {
    // Every response emits a command, so it would loop forever without the cap.
    const responses = Array.from({ length: 10 }, () => '```run\necho loop\n```');
    const { service, complete } = makeService(responses, { maxSteps: 3 });
    await service.sendUserMessage('go');
    expect(complete).toHaveBeenCalledTimes(3);
    const info = service.getEntries().find((e) => e.kind === 'info');
    expect(info?.text).toContain('Stopped after 3 steps');
  });

  it('aborts the loop when abort() is called mid-run', async () => {
    let resolveShell: (v: string) => void = () => {};
    const runShell = vi.fn(
      () => new Promise<string>((res) => { resolveShell = res; }),
    );
    const { service, complete } = makeService(
      ['```run\nsleep 100\n```', 'should not reach'],
      { runShell },
    );
    const run = service.sendUserMessage('go');
    // Let the first model call + command dispatch happen.
    await new Promise((r) => setTimeout(r, 10));
    service.abort();
    resolveShell('interrupted');
    await run;

    expect(complete).toHaveBeenCalledTimes(1); // never looped to the 2nd response
    expect(service.getEntries().some((e) => e.kind === 'info' && e.text === 'Aborted.')).toBe(true);
    expect(service.isBusy()).toBe(false);
  });
});
