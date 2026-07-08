import { describe, it, expect } from 'vitest';
import { parseAssistantMessage, extractCommands, hasCommands } from '../src/utils/quakeCommands.js';

describe('parseAssistantMessage', () => {
  it('returns a single prose block for plain text with no fences', () => {
    const text = 'Hello there, this is just prose.\nSecond line.';
    const blocks = parseAssistantMessage(text);
    expect(blocks).toEqual([{ kind: 'prose', content: text }]);
  });

  it('handles a single shell fence with prose before and after', () => {
    const text = [
      'Let me check that for you.',
      '',
      '```sh',
      'ls -la',
      '```',
      '',
      'Done, see above.',
    ].join('\n');

    const blocks = parseAssistantMessage(text);
    expect(blocks).toEqual([
      { kind: 'prose', content: 'Let me check that for you.' },
      { kind: 'shell', content: 'ls -la' },
      { kind: 'prose', content: 'Done, see above.' },
    ]);
  });

  it.each(['sh', 'bash', 'run', 'shell', 'SH', 'Bash', 'RUN', 'SHELL'])(
    'recognizes ```%s as a shell block',
    (info) => {
      const text = ['```' + info, 'echo hi', '```'].join('\n');
      const blocks = parseAssistantMessage(text);
      expect(blocks).toEqual([{ kind: 'shell', content: 'echo hi' }]);
    }
  );

  it('recognizes ```dmux as a dmux control block', () => {
    const text = ['```dmux', 'setGridColumns 2', '```'].join('\n');
    const blocks = parseAssistantMessage(text);
    expect(blocks).toEqual([{ kind: 'dmux', content: 'setGridColumns 2' }]);
  });

  it('treats ```json and unknown/empty info fences as prose', () => {
    const jsonText = ['Here is some data:', '```json', '{"a": 1}', '```'].join('\n');
    const jsonBlocks = parseAssistantMessage(jsonText);
    expect(jsonBlocks).toHaveLength(1);
    expect(jsonBlocks[0]!.kind).toBe('prose');
    expect(jsonBlocks[0]!.content).toContain('{"a": 1}');
    expect(hasCommands(jsonText)).toBe(false);

    const unknownText = ['```python', 'print(1)', '```'].join('\n');
    const unknownBlocks = parseAssistantMessage(unknownText);
    expect(unknownBlocks).toHaveLength(1);
    expect(unknownBlocks[0]!.kind).toBe('prose');

    const emptyInfoText = ['```', 'plain fenced text', '```'].join('\n');
    const emptyInfoBlocks = parseAssistantMessage(emptyInfoText);
    expect(emptyInfoBlocks).toHaveLength(1);
    expect(emptyInfoBlocks[0]!.kind).toBe('prose');
    expect(emptyInfoBlocks[0]!.content).toContain('plain fenced text');
  });

  it('preserves multiple commands / multi-line content within one shell block', () => {
    const text = ['```sh', 'echo one', 'echo two', 'echo three', '```'].join('\n');
    const blocks = parseAssistantMessage(text);
    expect(blocks).toEqual([{ kind: 'shell', content: 'echo one\necho two\necho three' }]);
  });

  it('preserves order across several fences', () => {
    const text = [
      'Step 1: list files',
      '```sh',
      'ls',
      '```',
      'Step 2: set columns',
      '```dmux',
      'setGridColumns 3',
      '```',
      'Step 3: run again',
      '```bash',
      'pwd',
      '```',
      'All done.',
    ].join('\n');

    const blocks = parseAssistantMessage(text);
    expect(blocks).toEqual([
      { kind: 'prose', content: 'Step 1: list files' },
      { kind: 'shell', content: 'ls' },
      { kind: 'prose', content: 'Step 2: set columns' },
      { kind: 'dmux', content: 'setGridColumns 3' },
      { kind: 'prose', content: 'Step 3: run again' },
      { kind: 'shell', content: 'pwd' },
      { kind: 'prose', content: 'All done.' },
    ]);
  });

  it('handles an unclosed final fence leniently', () => {
    const text = ['Running this now:', '```sh', 'echo start', 'echo unfinished'].join('\n');
    const blocks = parseAssistantMessage(text);
    expect(blocks).toEqual([
      { kind: 'prose', content: 'Running this now:' },
      { kind: 'shell', content: 'echo start\necho unfinished' },
    ]);
  });

  it('handles fences with leading whitespace', () => {
    const text = ['   ```sh', '  echo indented', '   ```'].join('\n');
    const blocks = parseAssistantMessage(text);
    expect(blocks).toEqual([{ kind: 'shell', content: '  echo indented' }]);
  });

  it('handles fences at the very start and end of the message with no surrounding prose', () => {
    const text = ['```sh', 'echo only', '```'].join('\n');
    const blocks = parseAssistantMessage(text);
    expect(blocks).toEqual([{ kind: 'shell', content: 'echo only' }]);
  });
});

describe('hasCommands', () => {
  it('returns true when the message has a shell block', () => {
    expect(hasCommands(['```sh', 'echo hi', '```'].join('\n'))).toBe(true);
  });

  it('returns true when the message has a dmux block', () => {
    expect(hasCommands(['```dmux', 'refreshLayout', '```'].join('\n'))).toBe(true);
  });

  it('returns false for plain prose', () => {
    expect(hasCommands('Just some text, nothing fenced.')).toBe(false);
  });

  it('returns false for non-shell/dmux fences', () => {
    expect(hasCommands(['```json', '{}', '```'].join('\n'))).toBe(false);
  });
});

describe('extractCommands', () => {
  it('joins prose blocks and lists commands in order', () => {
    const text = [
      'First, list files.',
      '```sh',
      'ls',
      '```',
      'Then adjust the layout.',
      '```dmux',
      'setGridColumns 2',
      '```',
      'That is all.',
    ].join('\n');

    const { prose, commands } = extractCommands(text);
    expect(prose).toBe('First, list files.\n\nThen adjust the layout.\n\nThat is all.');
    expect(commands).toEqual([
      { kind: 'shell', content: 'ls' },
      { kind: 'dmux', content: 'setGridColumns 2' },
    ]);
  });

  it('returns empty commands and full prose when there are no fences', () => {
    const { prose, commands } = extractCommands('Nothing to run here.');
    expect(prose).toBe('Nothing to run here.');
    expect(commands).toEqual([]);
  });
});
