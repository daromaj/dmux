import type { QmuxPane } from '../types.js';
import type { AgentName, PermissionMode } from './agentLaunch.js';

export const QMUX_BOOTSTRAP_PANE_TITLE_PREFIX = 'qmux-bootstrap:';

export interface PaneBootstrapConfig {
  version: 1;
  projectRoot: string;
  worktreePath: string;
  branchName?: string;
  slug: string;
  prompt: string;
  agent?: AgentName;
  permissionMode?: PermissionMode;
  goalMode?: boolean;
  pane: QmuxPane;
  tmuxTitle: string;
  existingWorktree: boolean;
  resolvedStartPoint?: string;
  isHooksEditingSession: boolean;
  metadata: {
    agent?: AgentName;
    permissionMode?: PermissionMode;
    goalMode?: boolean;
    displayName?: string;
    branchName?: string;
    mergeTargetChain?: QmuxPane['mergeTargetChain'];
  };
  hookExtraEnv?: Record<string, string>;
}
