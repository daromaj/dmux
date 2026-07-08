import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'ink-testing-library';
import stripAnsi from 'strip-ansi';
import { EventEmitter } from 'events';
import QuakeOverlay from '../src/components/QuakeOverlay.js';
import type { QuakeTranscriptEntry } from '../src/utils/quakeTypes.js';

class MockService extends EventEmitter {
  entries: QuakeTranscriptEntry[] = [];
  busy = false;
  sendUserMessage = vi.fn(async () => {});
  abort = vi.fn();
  getEntries() {
    return this.entries;
  }
  isBusy() {
    return this.busy;
  }
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('QuakeOverlay', () => {
  it('shows the empty-state hint when there are no entries', () => {
    const service = new MockService();
    const { lastFrame } = render(
      <QuakeOverlay service={service as any} onClose={() => {}} />,
    );
    expect(stripAnsi(lastFrame() ?? '')).toContain('Quake Assistant');
    expect(stripAnsi(lastFrame() ?? '')).toContain('distribute work');
  });

  it('renders transcript entries pushed via events', async () => {
    const service = new MockService();
    const { lastFrame } = render(
      <QuakeOverlay service={service as any} onClose={() => {}} />,
    );
    await tick(); // let the subscription effect run before emitting

    service.emit('entry', { kind: 'user', text: 'list the panes', seq: 1 });
    service.emit('entry', { kind: 'assistant', text: 'Here are your panes.', seq: 2 });
    await tick();

    const frame = stripAnsi(lastFrame() ?? '');
    expect(frame).toContain('list the panes');
    expect(frame).toContain('Here are your panes.');
  });

  it('appends streamed deltas into the matching entry', async () => {
    const service = new MockService();
    const { lastFrame } = render(
      <QuakeOverlay service={service as any} onClose={() => {}} />,
    );
    await tick(); // let the subscription effect run before emitting

    service.emit('entry', { kind: 'assistant', text: '', seq: 5 });
    service.emit('append', { seq: 5, delta: 'Hello' });
    service.emit('append', { seq: 5, delta: ' there' });
    await tick();

    expect(stripAnsi(lastFrame() ?? '')).toContain('Hello there');
  });

  it('closes on Esc when idle', async () => {
    const service = new MockService();
    const onClose = vi.fn();
    const { stdin } = render(
      <QuakeOverlay service={service as any} onClose={onClose} />,
    );
    await tick();
    stdin.write('\x1b'); // Esc
    await tick();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('aborts instead of closing on Esc while busy', async () => {
    const service = new MockService();
    service.busy = true;
    const onClose = vi.fn();
    const { stdin } = render(
      <QuakeOverlay service={service as any} onClose={onClose} />,
    );
    await tick();
    stdin.write('\x1b'); // Esc
    await tick();
    expect(service.abort).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });
});
