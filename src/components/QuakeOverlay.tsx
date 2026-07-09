import React, { useEffect, useState, useRef } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import CleanTextInput from './inputs/CleanTextInput.js';
import type { QuakeAssistantService } from '../services/QuakeAssistantService.js';
import type { QuakeTranscriptEntry } from '../utils/quakeTypes.js';

interface QuakeOverlayProps {
  service: QuakeAssistantService;
  onClose: () => void;
  /** Accent color (tmux/ink color) for the border. */
  accentColor?: string;
  /** Draw the Ink border box. Set false when a tmux popup border already frames it. */
  bordered?: boolean;
}

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

interface RenderLine {
  key: string;
  text: string;
  color?: string;
  dimColor?: boolean;
  bold?: boolean;
}

/** Flatten transcript entries into styled lines (newest kept when clipped). */
function entriesToLines(entries: QuakeTranscriptEntry[]): RenderLine[] {
  const lines: RenderLine[] = [];
  for (const entry of entries) {
    const raw = entry.text.length ? entry.text.split('\n') : [''];
    raw.forEach((line, i) => {
      let prefix = '';
      let color: string | undefined;
      let dimColor = false;
      let bold = false;
      switch (entry.kind) {
        case 'user':
          prefix = i === 0 ? '❯ ' : '  ';
          bold = true;
          break;
        case 'assistant':
          prefix = '';
          break;
        case 'command':
          prefix = i === 0 ? (entry.lane === 'qmux' ? 'qmux❯ ' : '$ ') : '  ';
          color = 'cyan';
          break;
        case 'output':
          prefix = '  ';
          dimColor = true;
          break;
        case 'error':
          prefix = i === 0 ? '✗ ' : '  ';
          color = 'red';
          break;
        case 'info':
          prefix = '· ';
          dimColor = true;
          break;
      }
      lines.push({
        key: `${entry.seq}-${i}`,
        text: prefix + line,
        color,
        dimColor,
        bold,
      });
    });
  }
  return lines;
}

/**
 * In-process drop-down chat overlay for the quake assistant. Rendered on top of
 * the control-pane UI while active; subscribes to the service's event stream.
 */
const QuakeOverlay: React.FC<QuakeOverlayProps> = ({ service, onClose, accentColor, bordered = true }) => {
  const { stdout } = useStdout();
  const rows = stdout?.rows || 24;
  const [entries, setEntries] = useState<QuakeTranscriptEntry[]>(() => [...service.getEntries()]);
  const [busy, setBusy] = useState<boolean>(service.isBusy());
  const [input, setInput] = useState('');
  const [spinnerFrame, setSpinnerFrame] = useState(0);
  const bumpRef = useRef(0);

  // Sync from the service's event stream.
  useEffect(() => {
    const onEntry = (entry: QuakeTranscriptEntry) => {
      setEntries((prev) => [...prev, { ...entry }]);
    };
    const onAppend = ({ seq, delta }: { seq: number; delta: string }) => {
      setEntries((prev) =>
        prev.map((e) => (e.seq === seq ? { ...e, text: e.text + delta } : e)),
      );
    };
    const onBusy = (value: boolean) => setBusy(value);

    service.on('entry', onEntry);
    service.on('append', onAppend);
    service.on('busy', onBusy);
    return () => {
      service.off('entry', onEntry);
      service.off('append', onAppend);
      service.off('busy', onBusy);
    };
  }, [service]);

  // Spinner animation while the loop runs.
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => {
      bumpRef.current = (bumpRef.current + 1) % SPINNER_FRAMES.length;
      setSpinnerFrame(bumpRef.current);
    }, 80);
    return () => clearInterval(timer);
  }, [busy]);

  // Esc: abort if running, else close. Ctrl+backtick (and its raw \x1c form) closes.
  useInput((inputChar, key) => {
    if (key.escape) {
      if (service.isBusy()) {
        service.abort();
      } else {
        onClose();
      }
      return;
    }
    if ((key.ctrl && inputChar === '`') || inputChar === '\x1c') {
      onClose();
    }
  });

  const handleSubmit = () => {
    const text = input;
    setInput('');
    if (text.trim()) {
      void service.sendUserMessage(text);
    }
  };

  const border = accentColor || 'magenta';
  // header(1) + border(2) + input(1) + footer(1) + a little slack
  const bodyHeight = Math.max(3, rows - 6);
  const allLines = entriesToLines(entries);
  const visible = allLines.slice(-bodyHeight);

  return (
    <Box
      flexDirection="column"
      height={rows}
      borderStyle={bordered ? 'round' : undefined}
      borderColor={bordered ? border : undefined}
      paddingX={1}
    >
      <Box justifyContent="space-between">
        <Text bold color={border}>
          ⚡ Quake Assistant
        </Text>
        <Text dimColor>
          {busy ? `${SPINNER_FRAMES[spinnerFrame]} working…` : 'idle'}
        </Text>
      </Box>

      <Box flexDirection="column" flexGrow={1} marginTop={1}>
        {visible.length === 0 ? (
          <Text dimColor>
            Ask me to distribute work, watch a pane, clean up, or set up the workspace.
          </Text>
        ) : (
          visible.map((line) => (
            <Text
              key={line.key}
              color={line.color}
              dimColor={line.dimColor}
              bold={line.bold}
              wrap="truncate-end"
            >
              {line.text.length ? line.text : ' '}
            </Text>
          ))
        )}
      </Box>

      <Box>
        <Text color={border}>❯ </Text>
        <CleanTextInput
          value={input}
          onChange={setInput}
          onSubmit={handleSubmit}
          placeholder={busy ? 'working… (Esc to abort)' : 'Ask the assistant…'}
          disabled={busy}
          disableEscape
          ignoreFocus
        />
      </Box>

      <Box>
        <Text dimColor>
          Enter send · Esc {busy ? 'abort' : 'close'} · Ctrl+\ toggle
        </Text>
      </Box>
    </Box>
  );
};

export default QuakeOverlay;
