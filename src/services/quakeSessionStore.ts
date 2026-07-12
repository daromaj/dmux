/**
 * Parent-process session store for the quake-mode assistant.
 *
 * The quake overlay runs as a short-lived child process (tmux display-popup)
 * that is fully torn down on every close, so nothing survives inside it. To let
 * closing and reopening the assistant show the same conversation, the long-lived
 * parent process (which owns PopupManager) keeps the last conversation snapshot
 * here, keyed by project root.
 *
 * This is a module-level singleton on purpose: PopupManager instances are
 * rebuilt by a useMemo on terminal resize (see src/hooks/useServices.ts), so the
 * snapshot must NOT live on a PopupManager field. Because it is only in-memory,
 * it naturally clears on app restart — which matches the desired semantics
 * (reopen restores; /new clears; restart clears).
 */

import type { QuakeSessionState } from '../utils/quakeTypes.js';

const sessions = new Map<string, QuakeSessionState>();

/** Return the stored session for a project root, or null if none. */
export function getSession(projectRoot: string): QuakeSessionState | null {
  return sessions.get(projectRoot) ?? null;
}

/** Persist (replace) the session snapshot for a project root. */
export function setSession(projectRoot: string, session: QuakeSessionState): void {
  sessions.set(projectRoot, session);
}

/** Forget the stored session for a project root. */
export function clearSession(projectRoot: string): void {
  sessions.delete(projectRoot);
}
