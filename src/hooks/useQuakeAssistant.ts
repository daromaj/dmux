import { useCallback, useMemo, useRef, useState } from 'react';
import { useInput } from 'ink';
import path from 'path';
import { QuakeAssistantService } from '../services/QuakeAssistantService.js';
import { callChatCompletion } from '../utils/aiClient.js';
import { runQuakeShell } from '../utils/quakeShell.js';
import { SettingsManager } from '../utils/settingsManager.js';
import { enforceControlPaneSize, SIDEBAR_WIDTH } from '../utils/tmux.js';
import { TmuxService } from '../services/TmuxService.js';
import { isDmuxThemeName } from '../theme/themePalette.js';
import type { DmuxPane, DmuxSettings, DmuxThemeName } from '../types.js';
import type {
  QuakeControlHandlers,
  QuakeWorkspaceContext,
} from '../utils/quakeTypes.js';

const CHORD_WINDOW_MS = 800;

interface UseQuakeAssistantParams {
  panes: DmuxPane[];
  sessionName: string;
  sessionProjectRoot: string;
  controlPaneId?: string;
  terminalHeight: number;
  settings: DmuxSettings;
  savePanes: (panes: DmuxPane[]) => Promise<void>;
  refreshDmuxSettings: (projectRoot?: string) => void;
}

export interface UseQuakeAssistantResult {
  quakeOpen: boolean;
  service: QuakeAssistantService;
  closeQuake: () => void;
  toggleQuake: () => void;
}

/**
 * Owns the quake assistant service, the Ctrl+` toggle, and the control-pane
 * drop-down grow/restore. Keeps the DmuxApp wiring thin: the injected deps
 * read the latest panes/settings via refs so the assistant always sees live
 * workspace state.
 */
export function useQuakeAssistant(params: UseQuakeAssistantParams): UseQuakeAssistantResult {
  const {
    panes,
    sessionName,
    sessionProjectRoot,
    controlPaneId,
    terminalHeight,
    settings,
    savePanes,
    refreshDmuxSettings,
  } = params;

  const [quakeOpen, setQuakeOpen] = useState(false);

  // Refs keep injected closures reading the latest render values.
  const panesRef = useRef(panes);
  panesRef.current = panes;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const terminalHeightRef = useRef(terminalHeight);
  terminalHeightRef.current = terminalHeight;
  const chordArmedRef = useRef<number>(0);

  const refreshLayout = useCallback(() => {
    if (controlPaneId) {
      void enforceControlPaneSize(controlPaneId, SIDEBAR_WIDTH, { forceLayout: true });
    }
  }, [controlPaneId]);

  const controlHandlers = useMemo<QuakeControlHandlers>(() => {
    const applySetting = <K extends keyof DmuxSettings>(key: K, value: DmuxSettings[K]) => {
      new SettingsManager(sessionProjectRoot).updateSetting(key, value, 'global');
      refreshDmuxSettings(sessionProjectRoot);
      refreshLayout();
    };

    return {
      setGridColumns: (columns) => {
        const n = columns === 'auto' ? 0 : columns;
        applySetting('gridColumns', n as any);
        return `Grid columns set to ${n === 0 ? 'auto' : n}.`;
      },
      setControlPosition: (position) => {
        applySetting('controlPanePosition', position as any);
        return `Control pane moved to ${position}.`;
      },
      setPaneColor: async (paneRef, color) => {
        const normalized = color.trim().toLowerCase();
        if (!isDmuxThemeName(normalized)) {
          return `Invalid color "${color}". Not a known theme.`;
        }
        const current = panesRef.current;
        const target = current.find(
          (p) => p.slug === paneRef || p.paneId === paneRef || p.id === paneRef,
        );
        if (!target) {
          return `No pane matched "${paneRef}".`;
        }
        const updated = current.map((p) =>
          p.id === target.id
            ? { ...p, colorTheme: normalized as DmuxThemeName, colorThemeSource: 'manual' as const }
            : p,
        );
        await savePanes(updated);
        refreshLayout();
        return `Pane ${target.slug} colored ${normalized}.`;
      },
      refreshLayout: () => {
        refreshLayout();
        return 'Layout refreshed.';
      },
    };
  }, [sessionProjectRoot, refreshDmuxSettings, refreshLayout, savePanes]);

  const getWorkspaceContext = useCallback((): QuakeWorkspaceContext => {
    const s = settingsRef.current;
    const contentPanes = panesRef.current.filter((p) => p.paneId !== controlPaneId);
    return {
      sessionName,
      projectRoot: sessionProjectRoot,
      gridColumns: s.gridColumns ?? 0,
      controlPanePosition: (s.controlPanePosition as 'bottom' | 'left') ?? 'bottom',
      panes: contentPanes.map((p) => ({
        id: p.id,
        slug: p.slug,
        paneId: p.paneId,
        agent: p.agent,
        worktreePath: p.worktreePath,
        status: p.agentStatus,
      })),
    };
  }, [sessionName, sessionProjectRoot, controlPaneId]);

  // The service must be created exactly once — several DmuxApp deps (e.g.
  // refreshDmuxSettings) are recreated every render, so a memo keyed on them
  // would rebuild the service and wipe the conversation. Delegate through refs.
  const handlersRef = useRef(controlHandlers);
  handlersRef.current = controlHandlers;
  const ctxRef = useRef(getWorkspaceContext);
  ctxRef.current = getWorkspaceContext;

  const serviceRef = useRef<QuakeAssistantService | null>(null);
  if (!serviceRef.current) {
    serviceRef.current = new QuakeAssistantService({
      getWorkspaceContext: () => ctxRef.current(),
      controlHandlers: {
        setGridColumns: (c) => handlersRef.current.setGridColumns(c),
        setControlPosition: (p) => handlersRef.current.setControlPosition(p),
        setPaneColor: (r, c) => handlersRef.current.setPaneColor(r, c),
        refreshLayout: () => handlersRef.current.refreshLayout(),
      },
      runShell: (command, { signal, timeoutMs }) =>
        runQuakeShell(command, {
          cwd: sessionProjectRoot,
          env: process.env,
          signal,
          timeoutMs,
        }),
      complete: (opts) => callChatCompletion(opts, settingsRef.current),
      transcriptPath: path.join(sessionProjectRoot, '.dmux', 'quake-history.jsonl'),
    });
  }
  const service = serviceRef.current;

  const openQuake = useCallback(() => {
    setQuakeOpen(true);
    if (controlPaneId) {
      const height = Math.max(10, terminalHeightRef.current - 4);
      void TmuxService.getInstance().resizePane(controlPaneId, { height });
    }
  }, [controlPaneId]);

  const closeQuake = useCallback(() => {
    setQuakeOpen(false);
    refreshLayout();
  }, [refreshLayout]);

  const toggleQuake = useCallback(() => {
    setQuakeOpen((open) => {
      if (open) {
        refreshLayout();
        return false;
      }
      if (controlPaneId) {
        const height = Math.max(10, terminalHeightRef.current - 4);
        void TmuxService.getInstance().resizePane(controlPaneId, { height });
      }
      return true;
    });
  }, [controlPaneId, refreshLayout]);

  // Global open binding (only when closed; the overlay owns close/abort while open).
  useInput(
    (input, key) => {
      if (quakeOpen) return;
      const directToggle = (key.ctrl && input === '`') || input === '\x1c';
      if (directToggle) {
        openQuake();
        return;
      }
      // Chord: Ctrl+b then ` (fallback when Ctrl+` is unmappable).
      if (key.ctrl && input === 'b') {
        chordArmedRef.current = Date.now();
        return;
      }
      if (input === '`' && chordArmedRef.current) {
        if (Date.now() - chordArmedRef.current <= CHORD_WINDOW_MS) {
          chordArmedRef.current = 0;
          openQuake();
        } else {
          chordArmedRef.current = 0;
        }
      }
    },
    { isActive: !quakeOpen },
  );

  return { quakeOpen, service, closeQuake, toggleQuake };
}
