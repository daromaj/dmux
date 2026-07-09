import { useCallback, useRef } from 'react';
import { useInput } from 'ink';

const CHORD_WINDOW_MS = 800;

interface UseQuakeAssistantParams {
  /** Launches the quake drawer; resolves when it closes. */
  launchQuake: () => Promise<void>;
}

export interface UseQuakeAssistantResult {
  openQuake: () => void;
}

/**
 * Registers the quake toggle binding. The assistant itself runs in a separate
 * top-drawer popup process (see PopupManager.launchQuakePopup); this hook only
 * detects the key and launches it, guarding against stacking multiple drawers.
 *
 * Binding: `Ctrl+\` (arrives as raw \x1c) primary; `Ctrl+\`` where the terminal
 * emits it; fallback chord `Ctrl+b` then `` ` ``.
 */
export function useQuakeAssistant(params: UseQuakeAssistantParams): UseQuakeAssistantResult {
  const { launchQuake } = params;
  const openRef = useRef(false);
  const chordArmedRef = useRef<number>(0);

  const openQuake = useCallback(() => {
    if (openRef.current) return;
    openRef.current = true;
    Promise.resolve(launchQuake())
      .catch(() => undefined)
      .finally(() => {
        openRef.current = false;
      });
  }, [launchQuake]);

  useInput((input, key) => {
    const directToggle =
      (key.ctrl && input === '`') || input === '\x1c'; // \x1c == Ctrl+\
    if (directToggle) {
      openQuake();
      return;
    }
    // Chord: Ctrl+b then ` (fallback when Ctrl+\ / Ctrl+` are unavailable).
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
  });

  return { openQuake };
}
