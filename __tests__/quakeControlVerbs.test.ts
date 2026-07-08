import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runControlBlock, parseControlVerb } from '../src/utils/quakeControlVerbs.js';
import type { QuakeControlHandlers } from '../src/utils/quakeTypes.js';

function makeHandlers(): QuakeControlHandlers {
  return {
    setGridColumns: vi.fn(async (columns) => `grid set to ${columns}`),
    setControlPosition: vi.fn(async (position) => `control moved to ${position}`),
    setPaneColor: vi.fn(async (paneRef, color) => `${paneRef} colored ${color}`),
    refreshLayout: vi.fn(async () => 'layout refreshed'),
  };
}

describe('parseControlVerb', () => {
  it('parses a simple verb line', () => {
    expect(parseControlVerb('grid 3')).toEqual({ verb: 'grid', args: ['3'] });
  });

  it('lowercases the verb but preserves arg casing', () => {
    expect(parseControlVerb('COLOR feature-x Blue')).toEqual({
      verb: 'color',
      args: ['feature-x', 'Blue'],
    });
  });

  it('returns null for blank lines', () => {
    expect(parseControlVerb('')).toBeNull();
    expect(parseControlVerb('   ')).toBeNull();
  });

  it('returns null for comment lines', () => {
    expect(parseControlVerb('# a comment')).toBeNull();
    expect(parseControlVerb('   # indented comment')).toBeNull();
  });

  it('handles a verb with no args', () => {
    expect(parseControlVerb('refresh')).toEqual({ verb: 'refresh', args: [] });
  });
});

describe('runControlBlock', () => {
  let handlers: QuakeControlHandlers;

  beforeEach(() => {
    handlers = makeHandlers();
  });

  it('grid auto calls setGridColumns("auto")', async () => {
    const result = await runControlBlock('grid auto', handlers);
    expect(handlers.setGridColumns).toHaveBeenCalledWith('auto');
    expect(result).toBe('grid set to auto');
  });

  it('grid 0 calls setGridColumns("auto")', async () => {
    await runControlBlock('grid 0', handlers);
    expect(handlers.setGridColumns).toHaveBeenCalledWith('auto');
  });

  it('grid 3 calls setGridColumns(3)', async () => {
    await runControlBlock('grid 3', handlers);
    expect(handlers.setGridColumns).toHaveBeenCalledWith(3);
  });

  it('grid 9 is rejected without calling the handler', async () => {
    const result = await runControlBlock('grid 9', handlers);
    expect(handlers.setGridColumns).not.toHaveBeenCalled();
    expect(result).toBe('Invalid grid columns: 9 (expected auto or 1-4)');
  });

  it('grid -1 is rejected without calling the handler', async () => {
    const result = await runControlBlock('grid -1', handlers);
    expect(handlers.setGridColumns).not.toHaveBeenCalled();
    expect(result).toContain('Invalid grid columns');
  });

  it('control bottom calls setControlPosition', async () => {
    const result = await runControlBlock('control bottom', handlers);
    expect(handlers.setControlPosition).toHaveBeenCalledWith('bottom');
    expect(result).toBe('control moved to bottom');
  });

  it('control left calls setControlPosition', async () => {
    await runControlBlock('control left', handlers);
    expect(handlers.setControlPosition).toHaveBeenCalledWith('left');
  });

  it('control top is rejected without calling the handler', async () => {
    const result = await runControlBlock('control top', handlers);
    expect(handlers.setControlPosition).not.toHaveBeenCalled();
    expect(result).toContain('Invalid control position');
  });

  it('color <paneRef> <colorName> calls setPaneColor', async () => {
    const result = await runControlBlock('color feature-x blue', handlers);
    expect(handlers.setPaneColor).toHaveBeenCalledWith('feature-x', 'blue');
    expect(result).toBe('feature-x colored blue');
  });

  it('color joins multi-word color names', async () => {
    await runControlBlock('color feature-x light blue', handlers);
    expect(handlers.setPaneColor).toHaveBeenCalledWith('feature-x', 'light blue');
  });

  it('layout refresh calls refreshLayout', async () => {
    const result = await runControlBlock('layout refresh', handlers);
    expect(handlers.refreshLayout).toHaveBeenCalledTimes(1);
    expect(result).toBe('layout refreshed');
  });

  it('bare refresh calls refreshLayout', async () => {
    const result = await runControlBlock('refresh', handlers);
    expect(handlers.refreshLayout).toHaveBeenCalledTimes(1);
    expect(result).toBe('layout refreshed');
  });

  it('unknown verb produces an error note without throwing', async () => {
    const result = await runControlBlock('teleport mars', handlers);
    expect(result).toBe('Unknown dmux verb: teleport mars');
  });

  it('runs a multi-line block in order and joins notes with newlines', async () => {
    const block = ['grid 2', 'control left', 'color feature-x red', 'refresh'].join('\n');
    const result = await runControlBlock(block, handlers);

    expect(handlers.setGridColumns).toHaveBeenCalledWith(2);
    expect(handlers.setControlPosition).toHaveBeenCalledWith('left');
    expect(handlers.setPaneColor).toHaveBeenCalledWith('feature-x', 'red');
    expect(handlers.refreshLayout).toHaveBeenCalledTimes(1);

    expect(result).toBe(
      ['grid set to 2', 'control moved to left', 'feature-x colored red', 'layout refreshed'].join('\n')
    );
  });

  it('skips blank and comment lines within a block', async () => {
    const block = ['# resize the grid', '', 'grid 4', '  ', '# done'].join('\n');
    const result = await runControlBlock(block, handlers);
    expect(handlers.setGridColumns).toHaveBeenCalledWith(4);
    expect(result).toBe('grid set to 4');
  });

  it('turns a rejected handler into an error note but keeps running subsequent lines', async () => {
    handlers.setPaneColor = vi.fn().mockRejectedValue(new Error('no such pane: bogus'));

    const block = ['color bogus red', 'refresh'].join('\n');
    const result = await runControlBlock(block, handlers);

    expect(handlers.setPaneColor).toHaveBeenCalledWith('bogus', 'red');
    expect(handlers.refreshLayout).toHaveBeenCalledTimes(1);
    expect(result).toBe(['Error: no such pane: bogus', 'layout refreshed'].join('\n'));
  });

  it('turns a synchronously-throwing handler into an error note but keeps running subsequent lines', async () => {
    handlers.setControlPosition = vi.fn(() => {
      throw new Error('boom');
    });

    const block = ['control bottom', 'refresh'].join('\n');
    const result = await runControlBlock(block, handlers);

    expect(result).toBe(['Error: boom', 'layout refreshed'].join('\n'));
  });

  it('returns an empty string for an all-blank/comment block', async () => {
    const result = await runControlBlock('\n# nothing\n  \n', handlers);
    expect(result).toBe('');
  });
});
