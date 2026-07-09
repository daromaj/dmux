import React, { useEffect, useState, useRef } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import CleanTextInput from './inputs/CleanTextInput.js';
import type { QuakeAssistantService } from '../services/QuakeAssistantService.js';
import type { QuakeTranscriptEntry } from '../utils/quakeTypes.js';
import { wrapText } from '../utils/input.js';
import stringWidth from 'string-width';
import { getPeakInfo, formatPeakBadge } from '../utils/peakHours.js';

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
  italic?: boolean;
}

/** Flatten transcript entries into styled lines with word wrapping and proper indentation. */
function entriesToLines(entries: QuakeTranscriptEntry[], maxWidth: number): RenderLine[] {
  const lines: RenderLine[] = [];
  for (const entry of entries) {
    const raw = entry.text.length ? entry.text.split('\n') : [''];
    raw.forEach((lineText, i) => {
      let prefix = '';
      let indent = '';
      let color: string | undefined;
      let dimColor = false;
      let bold = false;
      let italic = false;
      switch (entry.kind) {
        case 'user':
          prefix = i === 0 ? '❯ ' : '  ';
          indent = '  ';
          bold = true;
          break;
        case 'assistant':
          prefix = '';
          indent = '';
          break;
        case 'thinking':
          prefix = i === 0 ? '🧠 ' : '   ';
          indent = '   ';
          color = 'yellow';
          italic = true;
          break;
        case 'command':
          prefix = i === 0 ? (entry.lane === 'qmux' ? 'qmux❯ ' : '$ ') : '  ';
          indent = entry.lane === 'qmux' ? '      ' : '  ';
          color = 'cyan';
          break;
        case 'output':
          prefix = '  ';
          indent = '  ';
          dimColor = true;
          break;
        case 'error':
          prefix = i === 0 ? '✗ ' : '  ';
          indent = '  ';
          color = 'red';
          break;
        case 'info':
          prefix = '· ';
          indent = '  ';
          dimColor = true;
          break;
      }

      const prefixWidth = stringWidth(prefix);
      const availableWidth = Math.max(10, maxWidth - prefixWidth);
      const wrapped = wrapText(lineText, availableWidth);

      wrapped.forEach((wrappedLine, wIdx) => {
        lines.push({
          key: `${entry.seq}-${i}-${wIdx}`,
          text: (wIdx === 0 ? prefix : indent) + wrappedLine.line,
          color,
          dimColor,
          bold,
          italic,
        });
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
  const columns = stdout?.columns || 80;
  const [entries, setEntries] = useState<QuakeTranscriptEntry[]>(() => [...service.getEntries()]);
  const [busy, setBusy] = useState<boolean>(service.isBusy());
  const [input, setInput] = useState('');
  const [spinnerFrame, setSpinnerFrame] = useState(0);
  const bumpRef = useRef(0);

  const [scrollOffset, setScrollOffset] = useState(0);
  const [isDocked, setIsDocked] = useState(true);

  // Peak-hours indicator: refresh every 30s so the badge (and its countdown)
  // stays accurate while the overlay is open.
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const peakBadge = formatPeakBadge(getPeakInfo(new Date(nowMs)));

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

  const border = accentColor || 'magenta';
  // header(1) + border(2) + input(1) + footer(1) + a little slack
  const bodyHeight = Math.max(3, rows - 6);
  const maxWidth = bordered ? columns - 4 : columns - 2;
  const allLines = entriesToLines(entries, maxWidth);
  const maxScroll = Math.max(0, allLines.length - bodyHeight);

  // Update scroll offset to stay docked to bottom when new lines arrive
  useEffect(() => {
    if (isDocked) {
      setScrollOffset(maxScroll);
    }
  }, [allLines.length, isDocked, maxScroll]);

  // Esc: abort if running, else close. Ctrl+backtick (and its raw \x1c form) closes.
  // PageUp / PageDown for scrolling the chat history.
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
      return;
    }
    if (key.pageUp) {
      setIsDocked(false);
      setScrollOffset((prev) => Math.max(0, prev - Math.floor(bodyHeight / 2)));
      return;
    }
    if (key.pageDown) {
      setScrollOffset((prev) => {
        const next = Math.min(maxScroll, prev + Math.floor(bodyHeight / 2));
        if (next >= maxScroll) {
          setIsDocked(true);
        }
        return next;
      });
      return;
    }
  });

  const handleSubmit = () => {
    const text = input;
    setInput('');
    if (text.trim()) {
      setIsDocked(true);
      void service.sendUserMessage(text);
    }
  };

  const visible = allLines.slice(scrollOffset, scrollOffset + bodyHeight);

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
        <Box>
          <Text color={peakBadge.color}>{peakBadge.text}</Text>
          <Text dimColor>
            {'  '}
            {busy ? `${SPINNER_FRAMES[spinnerFrame]} working…` : 'idle'}
          </Text>
        </Box>
      </Box>

      <Box flexDirection="column" height={bodyHeight} marginTop={1}>
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
              italic={line.italic}
              wrap="wrap"
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

      <Box justifyContent="space-between">
        <Text dimColor>
          Enter send · Esc {busy ? 'abort' : 'close'} · Ctrl+\ toggle
        </Text>
        {maxScroll > 0 && (
          <Text dimColor>
            PgUp/PgDn scroll {isDocked ? '(bottom)' : `(${scrollOffset}/${maxScroll})`}
          </Text>
        )}
      </Box>
    </Box>
  );
};

export default QuakeOverlay;
