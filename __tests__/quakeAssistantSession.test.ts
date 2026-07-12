import { describe, it, expect, vi } from 'vitest';
import { QuakeAssistantService } from '../src/services/QuakeAssistantService.js';
import type {
  ChatCompletionOptions,
  QuakeControlHandlers,
  QuakeSessionState,
  QuakeWorkspaceContext,
} from '../src/utils/quakeTypes.js';

const ctx: QuakeWorkspaceContext = {
  sessionName: 'qmux-test',
  projectRoot: '/tmp/project',
  gridColumns: 0,
  controlPanePosition: 'bottom',
  panes: [],
};

function makeHandlers(): QuakeControlHandlers {
  return {
    setGridColumns: vi.fn(() => 'grid ok'),
    setControlPosition: vi.fn(() => 'control ok'),
    setPaneColor: vi.fn(() => 'color ok'),
    refreshLayout: vi.fn(() => 'refreshed'),
  };
}

function makeService(
  responses: string[],
  overrides: Partial<{ initialSession: QuakeSessionState }> = {},
) {
  let call = 0;
  const complete = vi.fn(async (_opts: ChatCompletionOptions) => {
    return responses[call++] ?? '';
  });
  const service = new QuakeAssistantService({
    getWorkspaceContext: () => ctx,
    controlHandlers: makeHandlers(),
    runShell: vi.fn(async () => 'shell-output'),
    complete,
    initialSession: overrides.initialSession,
  });
  return { service, complete };
}

describe('QuakeAssistantService session state', () => {
  it('seeds history/entries/seq from initialSession', () => {
    const session: QuakeSessionState = {
      history: [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'hello' },
      ],
      entries: [
        { kind: 'user', text: 'hi', seq: 1 },
        { kind: 'assistant', text: 'hello', seq: 2 },
      ],
      seq: 2,
    };
    const { service } = makeService([], { initialSession: session });
    expect(service.getHistory()).toEqual(session.history);
    expect(service.getEntries()).toEqual(session.entries);
    expect(service.getSeq()).toBe(2);
  });

  it('continues the seq counter after a restore so keys stay unique', async () => {
    const session: QuakeSessionState = {
      history: [],
      entries: [{ kind: 'user', text: 'old', seq: 7 }],
      seq: 7,
    };
    const { service } = makeService(['done'], { initialSession: session });
    await service.sendUserMessage('next');
    const seqs = service.getEntries().map((e) => e.seq);
    // No duplicates, and new entries continue after 7.
    expect(new Set(seqs).size).toBe(seqs.length);
    expect(Math.max(...seqs)).toBeGreaterThan(7);
  });

  it('reset() clears history/entries, resets seq, and emits "reset"', async () => {
    const { service } = makeService(['done']);
    await service.sendUserMessage('hi');
    expect(service.getEntries().length).toBeGreaterThan(0);

    const onReset = vi.fn();
    service.on('reset', onReset);
    service.reset();

    expect(onReset).toHaveBeenCalledTimes(1);
    expect(service.getEntries()).toEqual([]);
    expect(service.getHistory()).toEqual([]);
    expect(service.getSeq()).toBe(0);
  });
});

describe('QuakeAssistantService.handleUserInput', () => {
  it('routes plain text to sendUserMessage', async () => {
    const { service, complete } = makeService(['reply']);
    await service.handleUserInput('just chatting');
    expect(complete).toHaveBeenCalledTimes(1);
    const kinds = service.getEntries().map((e) => e.kind);
    expect(kinds).toEqual(['user', 'assistant']);
  });

  it('/new resets and adds an info entry', async () => {
    const { service } = makeService(['reply']);
    await service.handleUserInput('hi there');
    const onReset = vi.fn();
    service.on('reset', onReset);

    await service.handleUserInput('/new');
    expect(onReset).toHaveBeenCalledTimes(1);
    const entries = service.getEntries();
    // Only the post-reset info entry remains.
    expect(entries.map((e) => e.kind)).toEqual(['info']);
    expect(entries[0].text).toContain('new session');
  });

  it('unknown command adds an info entry without calling the model', async () => {
    const { service, complete } = makeService([]);
    await service.handleUserInput('/teleport mars');
    expect(complete).not.toHaveBeenCalled();
    const info = service.getEntries().find((e) => e.kind === 'info');
    expect(info?.text).toContain('/teleport');
  });
});

describe('QuakeAssistantService.runLoop', () => {
  it('runs a bounded loop N times with per-iteration info labels', async () => {
    const { service, complete } = makeService(['a', 'b', 'c']);
    await service.handleUserInput('/loop 3 do it');
    expect(complete).toHaveBeenCalledTimes(3);
    const labels = service
      .getEntries()
      .filter((e) => e.kind === 'info')
      .map((e) => e.text);
    expect(labels).toEqual(['Loop 1/3…', 'Loop 2/3…', 'Loop 3/3…']);
  });

  it('stops in until-mode when the reply contains the condition', async () => {
    const { service, complete } = makeService([
      'still working',
      'we are done now',
      'should not run',
    ]);
    await service.handleUserInput('/loop until done keep going');
    // Second reply contains "done", so it stops after 2 turns.
    expect(complete).toHaveBeenCalledTimes(2);
    const stopNote = service
      .getEntries()
      .find((e) => e.kind === 'info' && e.text.includes('matched'));
    expect(stopNote).toBeDefined();
  });

  it('honors abort between iterations', async () => {
    // Each turn resolves fast; abort fired during the first turn stops the loop.
    let call = 0;
    const complete = vi.fn(async () => {
      call++;
      if (call === 1) service.abort();
      return 'ok';
    });
    const service = new QuakeAssistantService({
      getWorkspaceContext: () => ctx,
      controlHandlers: makeHandlers(),
      runShell: vi.fn(async () => 'out'),
      complete,
    });
    await service.runLoop('spin', { times: 10 });
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('ignores an empty loop prompt', async () => {
    const { service, complete } = makeService([]);
    await service.runLoop('   ', {});
    expect(complete).not.toHaveBeenCalled();
  });
});
