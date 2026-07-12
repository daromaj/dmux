import { useEffect, useRef } from "react"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { useInput } from "ink"
import type { QmuxPane, NewPaneInput, SidebarProject } from "../types.js"
import type { TrackProjectActivity } from "../types/activity.js"
import { StateManager } from "../shared/StateManager.js"
import { TmuxService } from "../services/TmuxService.js"
import {
  STATUS_MESSAGE_DURATION_SHORT,
  STATUS_MESSAGE_DURATION_LONG,
  ANIMATION_DELAY,
} from "../constants/timing.js"
import {
  isPaneAction,
  PaneAction,
  TOGGLE_PANE_VISIBILITY_ACTION,
} from "../actions/index.js"
import { getMainBranch } from "../utils/git.js"
import {
  getResumableBranches,
  type ResumableBranchCandidate,
} from "../utils/resumeBranches.js"
import { enforceControlPaneSize, getContentPaneIds } from "../utils/tmux.js"
import { SIDEBAR_WIDTH } from "../utils/layoutManager.js"
import { suggestCommand } from "../utils/commands.js"
import type { PopupManager } from "../services/PopupManager.js"
import { getPaneProjectName, getPaneProjectRoot } from "../utils/paneProject.js"
import { getPaneDisplayName } from "../utils/paneTitle.js"
import {
  buildProjectActionLayout,
  getProjectActionByIndex,
  type ProjectActionItem,
} from "../utils/projectActions.js"
import { createShellPane, getNextQmuxId } from "../utils/shellPaneDetection.js"
import type { AgentName } from "../utils/agentLaunch.js"
import { buildAgentCommand, getAgentDefinitions } from "../utils/agentLaunch.js"
import { QMUX_THEME_NAMES } from "../theme/themePalette.js"
import type { QmuxThemeName } from "../types.js"
import {
  getBulkVisibilityAction,
  getProjectVisibilityAction,
  partitionPanesByProject,
} from "../utils/paneVisibility.js"
import { buildFilesOnlyCommand } from "../utils/qmuxCommand.js"
import {
  addSidebarProject,
  getAutoSidebarProjectColorTheme,
  getSidebarProjectColorTheme,
  hasSidebarProject,
  removeSidebarProject,
  setSidebarProjectColorThemeSettingValue,
  sameSidebarProjectRoot,
  SIDEBAR_PROJECT_COLOR_THEME_SETTING_KEY,
} from "../utils/sidebarProjects.js"
import {
  drainRemotePaneActions,
  getCurrentTmuxSessionName,
  type RemotePaneActionShortcut,
} from "../utils/remotePaneActions.js"
import {
  DEFAULT_COLOR_THEME_SETTING_KEY,
  SettingsManager,
} from "../utils/settingsManager.js"
import {
  resolveProjectColorTheme,
  syncPaneColorThemes,
} from "../utils/paneColors.js"
import { syncWelcomePaneVisibility } from "../utils/welcomePaneManager.js"

// Type for the action system returned by useActionSystem hook
interface ActionSystem {
  actionState: any
  executeAction: (actionId: any, pane: QmuxPane, params?: any) => Promise<void>
  executeCallback: (callback: (() => Promise<any>) | null, options?: { showProgress?: boolean; progressMessage?: string }) => Promise<void>
  clearDialog: (dialogType: any) => void
  clearStatus: () => void
  setActionState: (state: any) => void
}

interface UseInputHandlingParams {
  // State
  panes: QmuxPane[]
  selectedIndex: number
  setSelectedIndex: (index: number) => void
  isCreatingPane: boolean
  setIsCreatingPane: (value: boolean) => void
  runningCommand: boolean
  isLoading: boolean
  ignoreInput: boolean
  isDevMode: boolean
  quitConfirmMode: boolean
  setQuitConfirmMode: (value: boolean) => void

  // Dialog state
  showCommandPrompt: "test" | "dev" | null
  setShowCommandPrompt: (value: "test" | "dev" | null) => void
  commandInput: string
  setCommandInput: (value: string) => void
  showFileCopyPrompt: boolean
  setShowFileCopyPrompt: (value: boolean) => void
  currentCommandType: "test" | "dev" | null
  setCurrentCommandType: (value: "test" | "dev" | null) => void

  // Settings
  projectSettings: any
  saveSettings: (settings: any) => Promise<void>
  settingsManager: any
  refreshQmuxSettings: (projectRoot?: string) => void

  // Services
  popupManager: PopupManager
  actionSystem: ActionSystem
  controlPaneId: string | undefined
  trackProjectActivity: TrackProjectActivity

  // Callbacks
  setStatusMessage: (message: string) => void
  copyNonGitFiles: (worktreePath: string, sourceProjectRoot?: string) => Promise<void>
  runCommandInternal: (type: "test" | "dev", pane: QmuxPane) => Promise<void>
  handlePaneCreationWithAgent: (paneInput: NewPaneInput, targetProjectRoot?: string) => Promise<void>
  handleCreateChildWorktree: (pane: QmuxPane) => Promise<void>
  handleReopenWorktree: (
    candidate: ResumableBranchCandidate,
    targetProjectRoot?: string
  ) => Promise<void>
  setDevSourceFromPane: (pane: QmuxPane) => Promise<void>
  savePanes: (panes: QmuxPane[]) => Promise<void>
  sidebarProjects: SidebarProject[]
  saveSidebarProjects: (projects: SidebarProject[]) => Promise<SidebarProject[]>
  loadPanes: () => Promise<void>
  cleanExit: () => void
  killSessionExit: () => void

  // Agent info
  getAvailableAgentsForProject: (projectRoot?: string) => AgentName[]
  panesFile: string

  // Project info
  projectRoot: string
  activeProjectRoot: string
  projectActionItems: ProjectActionItem[]

  // Navigation
  findCardInDirection: (currentIndex: number, direction: "up" | "down" | "left" | "right") => number | null
}

/**
 * Hook that handles all keyboard input for the TUI
 * Extracted from QmuxApp.tsx to reduce component complexity
 */
export function useInputHandling(params: UseInputHandlingParams) {
  const {
    panes,
    selectedIndex,
    setSelectedIndex,
    isCreatingPane,
    setIsCreatingPane,
    runningCommand,
    isLoading,
    ignoreInput,
    isDevMode,
    quitConfirmMode,
    setQuitConfirmMode,
    showCommandPrompt,
    setShowCommandPrompt,
    commandInput,
    setCommandInput,
    showFileCopyPrompt,
    setShowFileCopyPrompt,
    currentCommandType,
    setCurrentCommandType,
    projectSettings,
    saveSettings,
    settingsManager,
    refreshQmuxSettings,
    popupManager,
    actionSystem,
    controlPaneId,
    trackProjectActivity,
    setStatusMessage,
    copyNonGitFiles,
    runCommandInternal,
    handlePaneCreationWithAgent,
    handleCreateChildWorktree,
    handleReopenWorktree,
    setDevSourceFromPane,
    savePanes,
    sidebarProjects,
    saveSidebarProjects,
    loadPanes,
    cleanExit,
    killSessionExit,
    getAvailableAgentsForProject,
    panesFile,
    projectRoot,
    activeProjectRoot,
    projectActionItems,
    findCardInDirection,
  } = params

  const layoutRefreshDebounceRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    return () => {
      if (layoutRefreshDebounceRef.current) {
        clearTimeout(layoutRefreshDebounceRef.current)
        layoutRefreshDebounceRef.current = null
      }
    }
  }, [])

  const queueLayoutRefresh = () => {
    if (!controlPaneId) {
      return
    }

    if (layoutRefreshDebounceRef.current) {
      clearTimeout(layoutRefreshDebounceRef.current)
    }

    layoutRefreshDebounceRef.current = setTimeout(async () => {
      layoutRefreshDebounceRef.current = null
      try {
        await enforceControlPaneSize(controlPaneId, SIDEBAR_WIDTH, { forceLayout: true })
      } catch (error: any) {
        setStatusMessage(`Setting saved but layout refresh failed: ${error?.message || String(error)}`)
        setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_LONG)
      }
    }, 250)
  }

  const handleCreateAgentPane = async (targetProjectRoot: string) => {
    const paneInput = await popupManager.launchNewPanePopup(targetProjectRoot)
    if (paneInput) {
      await handlePaneCreationWithAgent(paneInput, targetProjectRoot)
    }
  }

  const handleCreateTerminalPane = async (
    targetProjectRoot: string,
    startupCommand?: string
  ) => {
    try {
      setIsCreatingPane(true)
      setStatusMessage("Creating terminal pane...")

      const tmuxService = TmuxService.getInstance()
      const newPaneId = await tmuxService.splitPane({ cwd: targetProjectRoot })

      // Wait for pane creation to settle
      await new Promise((resolve) => setTimeout(resolve, ANIMATION_DELAY))

      // Optionally run a startup command (e.g. cc, ccc, pi) in the fresh shell.
      if (startupCommand) {
        await tmuxService.sendShellCommand(newPaneId, startupCommand)
        await tmuxService.sendTmuxKeys(newPaneId, "Enter")
      }

      // Persist shell pane immediately with project metadata so grouping is stable.
      const shellPane = await createShellPane(
        newPaneId,
        getNextQmuxId(panes)
      )
      shellPane.projectRoot = targetProjectRoot
      shellPane.projectName = path.basename(targetProjectRoot)
      shellPane.colorTheme = resolveProjectColorTheme(targetProjectRoot, sidebarProjects)
      await savePanes([...panes, shellPane])

      setIsCreatingPane(false)
      setStatusMessage("Terminal pane created")
      setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_SHORT)

      // Force a reload to ensure tmux metadata and pane IDs are in sync
      await loadPanes()
    } catch (error: any) {
      setIsCreatingPane(false)
      setStatusMessage(`Failed to create terminal pane: ${error.message}`)
      setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_LONG)
    }
  }

  const selectProjectAction = (
    targetProjectRoot: string,
    projectsToRender: SidebarProject[] = sidebarProjects
  ) => {
    const actionLayout = buildProjectActionLayout(
      panes,
      projectsToRender,
      projectRoot,
      path.basename(projectRoot)
    )
    const selectedAction = actionLayout.actionItems.find(
      (action) =>
        action.kind === "terminal" &&
        sameSidebarProjectRoot(action.projectRoot, targetProjectRoot)
    )
    if (selectedAction) {
      setSelectedIndex(selectedAction.index)
    }
  }

  const openTerminalInWorktree = async (selectedPane: QmuxPane) => {
    if (!selectedPane.worktreePath) {
      setStatusMessage("Cannot open terminal: this pane has no worktree")
      setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_SHORT)
      return
    }

    const targetProjectRoot = getPaneProjectRoot(selectedPane, projectRoot)

    try {
      setIsCreatingPane(true)
      setStatusMessage(`Opening terminal in ${getPaneDisplayName(selectedPane)}...`)

      const tmuxService = TmuxService.getInstance()
      const newPaneId = await tmuxService.splitPane({ cwd: selectedPane.worktreePath })

      // Wait for pane creation to settle
      await new Promise((resolve) => setTimeout(resolve, ANIMATION_DELAY))

      const shellPane = await createShellPane(
        newPaneId,
        getNextQmuxId(panes)
      )
      shellPane.projectRoot = targetProjectRoot
      shellPane.projectName = path.basename(targetProjectRoot)
      shellPane.colorTheme = resolveProjectColorTheme(targetProjectRoot, sidebarProjects)
      await savePanes([...panes, shellPane])

      setStatusMessage(`Opened terminal in ${getPaneDisplayName(selectedPane)}`)
      setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_SHORT)

      // Force a reload to ensure tmux metadata and pane IDs are in sync
      await loadPanes()
    } catch (error: any) {
      setStatusMessage(`Failed to open terminal in worktree: ${error.message}`)
      setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_LONG)
    } finally {
      setIsCreatingPane(false)
    }
  }

  const openFileBrowserInWorktree = async (selectedPane: QmuxPane) => {
    if (!selectedPane.worktreePath) {
      setStatusMessage("Cannot open file browser: this pane has no worktree")
      setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_SHORT)
      return
    }

    const existingBrowserPane = panes.find((pane) =>
      pane.browserPath === selectedPane.worktreePath && !pane.hidden
    )

    if (existingBrowserPane) {
      try {
        await TmuxService.getInstance().selectPane(existingBrowserPane.paneId)
        setStatusMessage(`File browser already open for ${getPaneDisplayName(selectedPane)}`)
        setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_SHORT)
      } catch (error: any) {
        setStatusMessage(`Failed to focus file browser: ${error?.message || String(error)}`)
        setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_LONG)
      }
      return
    }

    const targetProjectRoot = getPaneProjectRoot(selectedPane, projectRoot)
    const targetProjectName = path.basename(targetProjectRoot)

    try {
      setIsCreatingPane(true)
      setStatusMessage(`Opening file browser for ${getPaneDisplayName(selectedPane)}...`)

      const tmuxService = TmuxService.getInstance()
      const newPaneId = await tmuxService.splitPane({
        cwd: selectedPane.worktreePath,
        command: buildFilesOnlyCommand(projectRoot),
      })

      await new Promise((resolve) => setTimeout(resolve, ANIMATION_DELAY))

      const slugBase = `files-${path.basename(selectedPane.worktreePath)}`
      let slug = slugBase
      let suffix = 2
      while (panes.some((pane) => pane.slug === slug)) {
        slug = `${slugBase}-${suffix}`
        suffix += 1
      }

      const browserPane: QmuxPane = {
        id: `qmux-${getNextQmuxId(panes)}`,
        slug,
        prompt: "",
        paneId: newPaneId,
        projectRoot: targetProjectRoot,
        projectName: targetProjectName,
        colorTheme: resolveProjectColorTheme(targetProjectRoot, sidebarProjects),
        type: "shell",
        shellType: "fb",
        browserPath: selectedPane.worktreePath,
      }

      await tmuxService.setPaneTitle(newPaneId, slug)
      await savePanes([...panes, browserPane])
      await loadPanes()

      setStatusMessage(`Opened file browser for ${getPaneDisplayName(selectedPane)}`)
      setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_SHORT)
    } catch (error: any) {
      setStatusMessage(`Failed to open file browser: ${error?.message || String(error)}`)
      setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_LONG)
    } finally {
      setIsCreatingPane(false)
    }
  }

  const sidebarCollapsedRef = useRef(false)

  /**
   * Toggle sidebar collapse/expand using '[' key.
   */
  const handleToggleSidebar = async () => {
    if (!controlPaneId) return
    try {
      const tmuxService = TmuxService.getInstance()
      const isBottom = new SettingsManager(
        StateManager.getInstance().getState().projectRoot || process.cwd()
      ).getSettings().controlPanePosition === 'bottom'

      sidebarCollapsedRef.current = !sidebarCollapsedRef.current
      if (sidebarCollapsedRef.current) {
        await tmuxService.resizePane(
          controlPaneId,
          isBottom ? { height: 1 } : { width: 1 }
        )
        tmuxService.setPaneOptionSync(controlPaneId, '@qmux_sidebar_collapsed', '1')
        setStatusMessage(isBottom ? "Strip collapsed ([ to expand)" : "Sidebar collapsed ([ to expand)")
      } else {
        tmuxService.setPaneOptionSync(controlPaneId, '@qmux_sidebar_collapsed', '0')
        await enforceControlPaneSize(controlPaneId, SIDEBAR_WIDTH, { forceLayout: true })
        setStatusMessage(isBottom ? "Strip expanded" : "Sidebar expanded")
      }
      setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_SHORT)
    } catch (error: any) {
      setStatusMessage(`Failed: ${error.message}`)
      setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_LONG)
    }
  }

  /**
   * Scan ~/git for projects, sorted by most recently modified,
   * present them in a choice popup, and open a terminal pane.
   */
  const handleProjectQuickOpen = async () => {
    try {
      setStatusMessage("Scanning projects...")
      const gitDir = path.join(os.homedir(), "git")
      const entries = await fs.readdir(gitDir, { withFileTypes: true })

      const projects: { name: string; fullPath: string; mtime: number }[] = []
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith(".")) continue
        const fullPath = path.join(gitDir, entry.name)
        try {
          const stat = await fs.stat(fullPath)
          // Must be a git repo. Use the .git mtime as the recency signal —
          // it bumps on commits/staging/checkouts/fetches, whereas the project
          // root dir mtime only changes when top-level entries change (editing
          // nested files never touches it), which sorts active projects wrong.
          let gitMtime: number
          try {
            const gitStat = await fs.stat(path.join(fullPath, ".git"))
            gitMtime = gitStat.mtimeMs
          } catch {
            continue // skip non-git dirs
          }
          const mtime = Math.max(stat.mtimeMs, gitMtime)
          projects.push({ name: entry.name, fullPath, mtime })
        } catch {
          continue
        }
      }

      if (projects.length === 0) {
        setStatusMessage("No git projects found in ~/git")
        setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_LONG)
        return
      }

      // Sort by most recently modified
      projects.sort((a, b) => b.mtime - a.mtime)

      const selected = await popupManager.launchChoicePopup(
        "Open Project",
        `Projects in ~/git (${projects.length} found)`,
        projects.map((p) => ({
          id: p.fullPath,
          label: p.name,
          description: p.fullPath,
        })),
      )

      if (!selected) {
        setStatusMessage("")
        return
      }

      // Ask which command to run in the new pane for the selected project.
      // Favourite commands are user-configurable via settings (favoriteCommands);
      // fall back to sensible defaults when none are set.
      const projectName = path.basename(selected)
      const favoriteCommands = new SettingsManager(selected).getSettings().favoriteCommands
      const favorites = Array.isArray(favoriteCommands) && favoriteCommands.length > 0
        ? favoriteCommands
        : ["cc", "cc -c", "pi", "pi -c"]
      const command = await popupManager.launchChoicePopup(
        "Open With",
        `Command to run in ${projectName}`,
        [
          { id: "shell", label: "Shell", description: "Plain terminal, no command" },
          ...favorites.map((cmd) => ({
            id: cmd,
            label: cmd,
            description: `Run "${cmd}" after the terminal starts`,
          })),
        ],
      )

      if (!command) {
        setStatusMessage("")
        return
      }

      // "shell" => plain terminal; anything else runs as a startup command.
      const startupCommand = command === "shell" ? undefined : command
      await handleCreateTerminalPane(selected, startupCommand)
    } catch (error: any) {
      setStatusMessage(`Failed: ${error.message}`)
      setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_LONG)
    }
  }

  const handleAddProjectToSidebar = async () => {
    const selectedAction = getProjectActionByIndex(projectActionItems, selectedIndex)
    const selectedPane = selectedIndex < panes.length ? panes[selectedIndex] : undefined
    const defaultProjectPath = selectedPane
      ? getPaneProjectRoot(selectedPane, projectRoot)
      : (selectedAction?.projectRoot || projectRoot)

    const requestedProjectPath = await popupManager.launchProjectSelectPopup(
      defaultProjectPath,
      defaultProjectPath
    )

    if (!requestedProjectPath) {
      return
    }

    const resolveProjectTheme = (targetProjectRoot: string) =>
      getSidebarProjectColorTheme(sidebarProjects, targetProjectRoot)
      || new SettingsManager(targetProjectRoot).getSettings().colorTheme

    try {
      const { resolveProjectRootFromPath } = await import("../utils/projectRoot.js")
      const resolved = resolveProjectRootFromPath(requestedProjectPath, projectRoot)
      const nextProjects = addSidebarProject(sidebarProjects, {
        ...resolved,
        colorTheme: getAutoSidebarProjectColorTheme(
          sidebarProjects,
          resolved,
          resolveProjectTheme
        ),
        colorThemeSource: 'auto',
      })

      if (nextProjects === sidebarProjects) {
        selectProjectAction(resolved.projectRoot)
        setStatusMessage(`${resolved.projectName} is already in the sidebar`)
        setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_SHORT)
        return
      }

      const savedProjects = await saveSidebarProjects(nextProjects)
      selectProjectAction(resolved.projectRoot, savedProjects)
      setStatusMessage(`Added ${resolved.projectName} to the sidebar`)
      setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_SHORT)
    } catch (error: any) {
      const {
        createEmptyGitProject,
        inspectProjectCreationTarget,
      } = await import("../utils/projectRoot.js")
      const target = inspectProjectCreationTarget(requestedProjectPath, projectRoot)

      if (target.state !== "missing" && target.state !== "empty_directory") {
        const message = target.state === "directory_not_empty"
          ? `Directory is not a git repository and is not empty: ${target.absolutePath}. New projects can only be created in a missing or empty directory.`
          : (error?.message || "Invalid project path")
        setStatusMessage(message)
        setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_LONG)
        return
      }

      const confirmMessage = target.state === "missing"
        ? `This project does not exist yet:\n${target.absolutePath}\n\nCreate a new empty git repository here?`
        : `This directory is not a git repository:\n${target.absolutePath}\n\nInitialize a new empty git repository here?`
      const shouldCreateProject = await popupManager.launchConfirmPopup(
        "Create Project",
        confirmMessage,
        "Create Project",
        "Cancel",
        projectRoot
      )

      if (!shouldCreateProject) {
        return
      }

      try {
        setStatusMessage(`Creating ${path.basename(target.absolutePath) || "project"}...`)
        const createdProject = createEmptyGitProject(requestedProjectPath, projectRoot)
        const nextProjects = addSidebarProject(sidebarProjects, {
          ...createdProject,
          colorTheme: getAutoSidebarProjectColorTheme(
            sidebarProjects,
            createdProject,
            resolveProjectTheme
          ),
          colorThemeSource: 'auto',
        })

        if (nextProjects === sidebarProjects) {
          selectProjectAction(createdProject.projectRoot)
          setStatusMessage(`${createdProject.projectName} is already in the sidebar`)
          setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_SHORT)
          return
        }

        const savedProjects = await saveSidebarProjects(nextProjects)
        selectProjectAction(createdProject.projectRoot, savedProjects)
        setStatusMessage(`Created ${createdProject.projectName} and added it to the sidebar`)
        setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_SHORT)
      } catch (creationError: any) {
        setStatusMessage(creationError?.message || "Failed to create project")
        setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_LONG)
      }
    }
  }

  const handleRemoveProjectFromSidebar = async (targetProjectRoot: string) => {
    if (sameSidebarProjectRoot(targetProjectRoot, projectRoot)) {
      setStatusMessage("The session project cannot be removed from the sidebar")
      setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_SHORT)
      return
    }

    const projectHasPanes = panes.some((pane) =>
      sameSidebarProjectRoot(getPaneProjectRoot(pane, projectRoot), targetProjectRoot)
    )
    if (projectHasPanes) {
      setStatusMessage("Close this project's panes before removing it from the sidebar")
      setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_LONG)
      return
    }

    if (!hasSidebarProject(sidebarProjects, targetProjectRoot)) {
      setStatusMessage("Project is not in the sidebar")
      setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_SHORT)
      return
    }

    const updatedProjects = removeSidebarProject(sidebarProjects, targetProjectRoot)
    const savedProjects = await saveSidebarProjects(updatedProjects)
    selectProjectAction(projectRoot, savedProjects)
    setStatusMessage(`Removed ${path.basename(targetProjectRoot)} from the sidebar`)
    setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_SHORT)
  }

  const getActiveProjectRoot = (): string => {
    return activeProjectRoot || projectRoot
  }

  const launchHooksAuthoringSession = async (targetProjectRoot?: string) => {
    const hooksProjectRoot = targetProjectRoot || getActiveProjectRoot()
    const { initializeHooksDirectory } = await import("../utils/hooks.js")
    initializeHooksDirectory(hooksProjectRoot)

    const prompt =
      "I would like to create or edit my qmux hooks in .qmux-hooks. Please read AGENTS.md or CLAUDE.md first, then ask me what I want to create or modify."
    await handlePaneCreationWithAgent({ prompt }, hooksProjectRoot)
  }

  const refreshPaneLayout = async () => {
    if (!controlPaneId) {
      return
    }

    await enforceControlPaneSize(controlPaneId, SIDEBAR_WIDTH, {
      forceLayout: true,
      suppressLayoutLogs: true,
    })
  }

  // Assign an explicit per-pane color (marks it manual so project-theme sync leaves it alone).
  const setPaneColor = async (pane: QmuxPane) => {
    const options = [
      { id: "__auto__", label: "Auto (follow project theme)", description: "Clear the manual color" },
      ...QMUX_THEME_NAMES.map((themeName) => ({
        id: themeName,
        label: themeName.charAt(0).toUpperCase() + themeName.slice(1),
      })),
    ]
    const chosen = await popupManager.launchChoicePopup(
      "Set Pane Color",
      `Color for "${getPaneDisplayName(pane)}"`,
      options
    )
    if (!chosen) return

    const updatedPanes = panes.map((p) => {
      if (p.id !== pane.id) return p
      if (chosen === "__auto__") {
        const { colorThemeSource, ...rest } = p
        return {
          ...rest,
          colorTheme: resolveProjectColorTheme(getPaneProjectRoot(p, projectRoot), sidebarProjects),
        }
      }
      return { ...p, colorTheme: chosen as QmuxThemeName, colorThemeSource: "manual" as const }
    })
    await savePanes(updatedPanes)
    setStatusMessage(
      chosen === "__auto__"
        ? `Pane color reset to project theme`
        : `Pane color set to ${chosen}`
    )
    setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_SHORT)
  }

  // Relaunch an existing agent pane with a different agent (fresh session).
  const changePaneAgent = async (pane: QmuxPane) => {
    const targetProjectRoot = getPaneProjectRoot(pane, projectRoot)
    const availableAgents = getAvailableAgentsForProject(targetProjectRoot)
    if (availableAgents.length === 0) {
      setStatusMessage("No agents available")
      setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_SHORT)
      return
    }

    const definitions = getAgentDefinitions()
    const chosen = await popupManager.launchChoicePopup(
      "Change Agent",
      `Relaunch "${getPaneDisplayName(pane)}" with:`,
      availableAgents.map((agentId) => {
        const def = definitions.find((d) => d.id === agentId)
        return {
          id: agentId,
          label: def?.name || agentId,
          description: agentId === pane.agent ? "Current agent" : def?.description,
        }
      })
    )
    if (!chosen) return
    if (chosen === pane.agent) {
      setStatusMessage(`Pane already running ${chosen}`)
      setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_SHORT)
      return
    }

    if (pane.agentStatus === "working") {
      const confirmed = await popupManager.launchConfirmPopup(
        "Agent Active",
        `Agent in "${getPaneDisplayName(pane)}" is currently working. Replace it with ${chosen}?`,
        "Replace",
        "Cancel",
        targetProjectRoot
      )
      if (!confirmed) return
    }

    try {
      setStatusMessage(`Relaunching with ${chosen}...`)
      const newAgent = chosen as AgentName
      const command = buildAgentCommand(newAgent, pane.permissionMode)
      const tmuxService = TmuxService.getInstance()
      await tmuxService.respawnPane(pane.paneId, command)

      const updatedPanes = panes.map((p) =>
        p.id === pane.id ? { ...p, agent: newAgent, agentStatus: undefined, agentSummary: undefined } : p
      )
      await savePanes(updatedPanes)
      await loadPanes()

      setStatusMessage(`Relaunched with ${chosen}`)
      setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_SHORT)
    } catch (error: any) {
      setStatusMessage(`Failed to change agent: ${error?.message || String(error)}`)
      setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_LONG)
    }
  }

  // Swap a pane with its neighbor in the list (and in the tmux layout).
  const movePane = async (pane: QmuxPane, direction: -1 | 1) => {
    const index = panes.findIndex((p) => p.id === pane.id)
    if (index === -1) return
    const targetIndex = index + direction
    if (targetIndex < 0 || targetIndex >= panes.length) {
      setStatusMessage(direction < 0 ? "Already at the top" : "Already at the bottom")
      setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_SHORT)
      return
    }

    const neighbor = panes[targetIndex]
    try {
      // Swap tmux geometry first so the visible layout matches the new order.
      const tmuxService = TmuxService.getInstance()
      await tmuxService.swapPane(pane.paneId, neighbor.paneId)

      const reordered = [...panes]
      reordered[index] = neighbor
      reordered[targetIndex] = pane
      await savePanes(reordered)
      await refreshPaneLayout()
      await loadPanes()

      setSelectedIndex(targetIndex)
      setStatusMessage(`Moved "${getPaneDisplayName(pane)}" ${direction < 0 ? "up" : "down"}`)
      setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_SHORT)
    } catch (error: any) {
      setStatusMessage(`Failed to move pane: ${error?.message || String(error)}`)
      setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_LONG)
    }
  }

  // Virtual grid: pin the number of columns for content panes (0 = auto-adaptive).
  const handleGridColumnsChange = async () => {
    const activeProjectRoot = getActiveProjectRoot()
    const current = new SettingsManager(activeProjectRoot).getSettings().gridColumns ?? 0
    const choices = [0, 1, 2, 3, 4].map((n) => ({
      id: String(n),
      label: n === 0 ? "Auto (adaptive)" : `${n} column${n > 1 ? "s" : ""}`,
      description: n === current ? "Current" : undefined,
    }))
    const chosen = await popupManager.launchChoicePopup(
      "Grid Columns",
      "Fixed content-pane columns (virtual grid)",
      choices
    )
    if (chosen === null || chosen === undefined) return

    try {
      const settingsManager = new SettingsManager(activeProjectRoot)
      settingsManager.updateSetting(
        "gridColumns",
        parseInt(chosen, 10) as any,
        "global"
      )
      // Grid and preset are mutually exclusive; choosing a grid clears the preset.
      settingsManager.updateSetting("layoutPreset", "" as any, "global")
      refreshQmuxSettings(activeProjectRoot)
      queueLayoutRefresh()
      const label = chosen === "0" ? "auto" : `${chosen} column${chosen === "1" ? "" : "s"}`
      setStatusMessage(`Grid: ${label}`)
      setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_SHORT)
    } catch (error: any) {
      setStatusMessage(`Failed to set grid: ${error?.message || String(error)}`)
      setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_LONG)
    }
  }

  // Rearrange 2-3 content panes into a fixed preset arrangement (or back to auto).
  const handleRearrangeChange = async () => {
    if (!controlPaneId) return
    const count = getContentPaneIds(controlPaneId).length
    if (count < 2 || count > 3) {
      setStatusMessage("Rearrange needs exactly 2 or 3 content panes")
      setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_SHORT)
      return
    }

    const activeProjectRoot = getActiveProjectRoot()
    const current = new SettingsManager(activeProjectRoot).getSettings().layoutPreset ?? ""
    const presets =
      count === 2
        ? [
            { id: "side-by-side", label: "Side by side" },
            { id: "stacked", label: "Stacked" },
          ]
        : [
            { id: "main-left", label: "Main left + 2 stacked right" },
            { id: "main-right", label: "2 stacked left + main right" },
            { id: "main-top", label: "Main top + 2 side by side below" },
            { id: "main-bottom", label: "2 side by side above + main bottom" },
          ]

    const choices = [
      ...presets.map((p) => ({
        id: p.id,
        label: p.label,
        description: p.id === current ? "Current" : undefined,
      })),
      {
        id: "auto",
        label: "Auto (adaptive grid)",
        description: current === "" ? "Current" : undefined,
      },
    ]

    const chosen = await popupManager.launchChoicePopup(
      "Rearrange Panels",
      `Choose an arrangement for ${count} panes`,
      choices
    )
    if (chosen === null || chosen === undefined) return

    try {
      const settingsManager = new SettingsManager(activeProjectRoot)
      const value = chosen === "auto" ? "" : chosen
      settingsManager.updateSetting("layoutPreset", value as any, "global")
      // Preset and grid are mutually exclusive; choosing a preset clears the grid.
      settingsManager.updateSetting("gridColumns", 0 as any, "global")
      refreshQmuxSettings(activeProjectRoot)
      queueLayoutRefresh()
      const chosenPreset = presets.find((p) => p.id === chosen)
      setStatusMessage(
        chosen === "auto" ? "Arrangement: auto" : `Arrangement: ${chosenPreset?.label ?? chosen}`
      )
      setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_SHORT)
    } catch (error: any) {
      setStatusMessage(`Failed to set arrangement: ${error?.message || String(error)}`)
      setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_LONG)
    }
  }

  const syncWelcomePaneForPanes = async (
    nextPanes: QmuxPane[],
    targetProjectRoot: string = getActiveProjectRoot()
  ) => {
    if (!controlPaneId) {
      return
    }

    const hasVisiblePanes = nextPanes.some((pane) => !pane.hidden)
    const themeName = resolveProjectColorTheme(targetProjectRoot, sidebarProjects)

    await syncWelcomePaneVisibility(
      projectRoot,
      controlPaneId,
      !hasVisiblePanes,
      themeName
    )
  }

  const getPaneShowTarget = async (excludedPaneId?: string): Promise<string | null> => {
    const visiblePaneId = panes.find(
      (pane) => !pane.hidden && pane.paneId !== excludedPaneId
    )?.paneId
    if (visiblePaneId) {
      return visiblePaneId
    }

    if (controlPaneId) {
      return controlPaneId
    }

    try {
      return await TmuxService.getInstance().getCurrentPaneId()
    } catch {
      return null
    }
  }

  const togglePaneVisibility = async (selectedPane: QmuxPane) => {
    const tmuxService = TmuxService.getInstance()

    try {
      setIsCreatingPane(true)
      setStatusMessage(
        selectedPane.hidden
          ? `Showing ${getPaneDisplayName(selectedPane)}...`
          : `Hiding ${getPaneDisplayName(selectedPane)}...`
      )

      if (selectedPane.hidden) {
        const targetPaneId = await getPaneShowTarget(selectedPane.paneId)
        if (!targetPaneId) {
          throw new Error("No target pane is available to show this pane")
        }
        await tmuxService.joinPaneToTarget(selectedPane.paneId, targetPaneId)
      } else {
        await tmuxService.breakPaneToWindow(
          selectedPane.paneId,
          `qmux-hidden-${selectedPane.id}`
        )
      }

      const updatedPanes = panes.map((pane) =>
        pane.id === selectedPane.id
          ? { ...pane, hidden: !selectedPane.hidden }
          : pane
      )

      await savePanes(updatedPanes)
      await syncWelcomePaneForPanes(
        updatedPanes,
        getPaneProjectRoot(selectedPane, projectRoot)
      )
      await refreshPaneLayout()
      await loadPanes()

      setStatusMessage(
        selectedPane.hidden
          ? `Showing ${getPaneDisplayName(selectedPane)}`
          : `Hid ${getPaneDisplayName(selectedPane)}`
      )
      setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_SHORT)
    } catch (error: any) {
      setStatusMessage(`Failed to toggle pane visibility: ${error?.message || String(error)}`)
      setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_LONG)
    } finally {
      setIsCreatingPane(false)
    }
  }

  const toggleOtherPanesVisibility = async (selectedPane: QmuxPane) => {
    const action = getBulkVisibilityAction(panes, selectedPane)
    if (!action) {
      setStatusMessage("No other panes to toggle")
      setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_SHORT)
      return
    }

    const targetPanes = panes.filter((pane) =>
      pane.id !== selectedPane.id
        && (action === "hide-others" ? !pane.hidden : pane.hidden)
    )

    if (targetPanes.length === 0) {
      setStatusMessage("No other panes to toggle")
      setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_SHORT)
      return
    }

    const tmuxService = TmuxService.getInstance()
    const hidden = action === "hide-others"

    try {
      setIsCreatingPane(true)
      setStatusMessage(hidden ? "Hiding other panes..." : "Showing other panes...")

      for (const pane of targetPanes) {
        if (hidden) {
          await tmuxService.breakPaneToWindow(
            pane.paneId,
            `qmux-hidden-${pane.id}`
          )
          continue
        }

        const targetPaneId = await getPaneShowTarget(pane.paneId)
        if (!targetPaneId) {
          throw new Error("No target pane is available to show hidden panes")
        }
        await tmuxService.joinPaneToTarget(pane.paneId, targetPaneId)
      }

      const targetPaneIds = new Set(targetPanes.map((pane) => pane.id))
      const updatedPanes = panes.map((pane) =>
        targetPaneIds.has(pane.id) ? { ...pane, hidden } : pane
      )

      await savePanes(updatedPanes)
      await syncWelcomePaneForPanes(
        updatedPanes,
        getPaneProjectRoot(selectedPane, projectRoot)
      )
      await refreshPaneLayout()
      await loadPanes()

      setStatusMessage(
        hidden
          ? `Hid ${targetPanes.length} other pane${targetPanes.length === 1 ? "" : "s"}`
          : `Showed ${targetPanes.length} other pane${targetPanes.length === 1 ? "" : "s"}`
      )
      setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_SHORT)
    } catch (error: any) {
      setStatusMessage(`Failed to toggle other panes: ${error?.message || String(error)}`)
      setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_LONG)
    } finally {
      setIsCreatingPane(false)
    }
  }

  const toggleProjectPanesVisibility = async (
    targetProjectRoot: string = getActiveProjectRoot()
  ) => {
    const action = getProjectVisibilityAction(panes, targetProjectRoot, projectRoot)

    if (!action) {
      setStatusMessage("No project panes to toggle")
      setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_SHORT)
      return
    }

    const { projectPanes, otherPanes } = partitionPanesByProject(
      panes,
      targetProjectRoot,
      projectRoot
    )

    if (projectPanes.length === 0) {
      setStatusMessage("No project panes to toggle")
      setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_SHORT)
      return
    }

    const projectName = getPaneProjectName(
      projectPanes[0],
      projectRoot
    )
    const panesToShow = action === "focus-project"
      ? projectPanes.filter((pane) => pane.hidden)
      : panes.filter((pane) => pane.hidden)
    const panesToHide = action === "focus-project"
      ? otherPanes.filter((pane) => !pane.hidden)
      : []

    try {
      setIsCreatingPane(true)
      setStatusMessage(
        action === "focus-project"
          ? `Showing ${projectName} panes...`
          : "Showing all panes..."
      )

      // Show target project panes before hiding others so we always have
      // an attached pane available for tmux join targets.
      for (const pane of panesToShow) {
        const targetPaneId = await getPaneShowTarget(pane.paneId)
        if (!targetPaneId) {
          throw new Error("No target pane is available to show hidden panes")
        }
        await TmuxService.getInstance().joinPaneToTarget(pane.paneId, targetPaneId)
      }

      for (const pane of panesToHide) {
        await TmuxService.getInstance().breakPaneToWindow(
          pane.paneId,
          `qmux-hidden-${pane.id}`
        )
      }

      const shownPaneIds = new Set(panesToShow.map((pane) => pane.id))
      const hiddenPaneIds = new Set(panesToHide.map((pane) => pane.id))

      const updatedPanes = panes.map((pane) => {
        if (shownPaneIds.has(pane.id)) {
          return { ...pane, hidden: false }
        }
        if (hiddenPaneIds.has(pane.id)) {
          return { ...pane, hidden: true }
        }
        return pane
      })

      await savePanes(updatedPanes)
      await syncWelcomePaneForPanes(updatedPanes, targetProjectRoot)
      await refreshPaneLayout()
      await loadPanes()

      setStatusMessage(
        action === "focus-project"
          ? panesToHide.length > 0
            ? `Showing only ${projectName} panes`
            : `Showed ${projectName} panes`
          : "Showed all panes"
      )
      setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_SHORT)
    } catch (error: any) {
      setStatusMessage(`Failed to toggle project panes: ${error?.message || String(error)}`)
      setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_LONG)
    } finally {
      setIsCreatingPane(false)
    }
  }

  const openPaneMenu = async (
    pane: QmuxPane,
    options: { anchorToPane?: boolean } = {}
  ) => {
    const actionId = await popupManager.launchKebabMenuPopup(
      pane,
      panes,
      options
    )
    if (!actionId) {
      return
    }

    if (actionId === TOGGLE_PANE_VISIBILITY_ACTION) {
      await togglePaneVisibility(pane)
      return
    }

    if (actionId === "hide-others" || actionId === "show-others") {
      await toggleOtherPanesVisibility(pane)
      return
    }

    if (actionId === "focus-project" || actionId === "show-all") {
      await toggleProjectPanesVisibility(getPaneProjectRoot(pane, projectRoot))
      return
    }

    if (actionId === PaneAction.SET_SOURCE) {
      await setDevSourceFromPane(pane)
      return
    }

    if (actionId === PaneAction.ATTACH_AGENT) {
      await attachAgentsToPane(pane)
      return
    }

    if (actionId === PaneAction.CREATE_CHILD_WORKTREE) {
      await handleCreateChildWorktree(pane)
      return
    }

    if (actionId === PaneAction.OPEN_TERMINAL_IN_WORKTREE) {
      await openTerminalInWorktree(pane)
      return
    }

    if (actionId === PaneAction.OPEN_FILE_BROWSER) {
      await openFileBrowserInWorktree(pane)
      return
    }

    if (actionId === PaneAction.SET_PANE_COLOR) {
      await setPaneColor(pane)
      return
    }

    if (actionId === PaneAction.SET_AGENT) {
      await changePaneAgent(pane)
      return
    }

    if (actionId === PaneAction.MOVE_PANE_UP) {
      await movePane(pane, -1)
      return
    }

    if (actionId === PaneAction.MOVE_PANE_DOWN) {
      await movePane(pane, 1)
      return
    }

    if (!isPaneAction(actionId)) {
      setStatusMessage(`Unknown menu action: ${actionId}`)
      setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_LONG)
      return
    }

    await actionSystem.executeAction(actionId, pane, {
      mainBranch: getMainBranch(),
    })
  }

  const attachAgentsToPane = async (selectedPane: QmuxPane) => {
    if (!selectedPane.worktreePath) {
      setStatusMessage("Cannot attach agent: this pane has no worktree")
      setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_SHORT)
      return
    }

    const targetProjectRoot = getPaneProjectRoot(selectedPane, projectRoot)

    // Warn if agent is actively working
    if (selectedPane.agentStatus === "working") {
      const confirmed = await popupManager.launchConfirmPopup(
        "Agent Active",
        `Agent in "${getPaneDisplayName(selectedPane)}" is currently working. Attach another agent anyway?`,
        "Attach",
        "Cancel",
        targetProjectRoot
      )
      if (!confirmed) return
    }

    const targetAvailableAgents = getAvailableAgentsForProject(targetProjectRoot)
    if (targetAvailableAgents.length === 0) {
      setStatusMessage("No agents available")
      setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_SHORT)
      return
    }
    const selectedAgents = await popupManager.launchAgentChoicePopup(targetProjectRoot)
    if (selectedAgents === null) {
      return
    }
    if (selectedAgents.length === 0) {
      setStatusMessage("Select at least one agent")
      setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_SHORT)
      return
    }

    // Prompt input
    const promptInput = await popupManager.launchNewPanePopup(
      targetProjectRoot,
      { allowGitOptions: false }
    )
    if (!promptInput) return

    try {
      setIsCreatingPane(true)
      setStatusMessage(
        selectedAgents.length > 1
          ? `Attaching ${selectedAgents.length} agents...`
          : "Attaching agent..."
      )

      const { attachAgentToWorktree } = await import("../utils/attachAgent.js")
      const createdPanes: QmuxPane[] = []
      const failedAgents: AgentName[] = []

      for (const agent of selectedAgents) {
        try {
            const result = await attachAgentToWorktree({
              targetPane: selectedPane,
              prompt: promptInput.prompt,
              agent,
              goalMode: promptInput.goalMode,
              existingPanes: [...panes, ...createdPanes],
              sessionProjectRoot: projectRoot,
            sessionConfigPath: panesFile,
          })
          createdPanes.push(result.pane)
        } catch {
          failedAgents.push(agent)
        }
      }

      if (createdPanes.length > 0) {
        const updatedPanes = [...panes, ...createdPanes]
        await savePanes(updatedPanes)
        await loadPanes()
      }

      if (failedAgents.length === 0) {
        setStatusMessage(
          `Attached ${createdPanes.length} agent${createdPanes.length === 1 ? "" : "s"} to ${getPaneDisplayName(selectedPane)}`
        )
        setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_SHORT)
      } else if (createdPanes.length === 0) {
        setStatusMessage(
          `Failed to attach agents: ${failedAgents.join(", ")}`
        )
        setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_LONG)
      } else {
        setStatusMessage(
          `Attached ${createdPanes.length}/${selectedAgents.length} agents to ${getPaneDisplayName(selectedPane)} (${failedAgents.length} failed)`
        )
        setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_LONG)
      }
    } catch (error: any) {
      setStatusMessage(`Failed to attach agent: ${error.message}`)
      setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_LONG)
    } finally {
      setIsCreatingPane(false)
    }
  }

  const isInteractionBlocked = () =>
    ignoreInput
    || isCreatingPane
    || runningCommand
    || isLoading
    || showFileCopyPrompt
    || showCommandPrompt !== null

  const reopenClosedWorktreesInProject = async (targetProjectRoot: string) => {
    const activeSlugs = panes
      .filter((pane) => sameSidebarProjectRoot(getPaneProjectRoot(pane, projectRoot), targetProjectRoot))
      .map((pane) => pane.slug)
    const popupState = {
      includeWorktrees: true,
      includeLocalBranches: true,
      includeRemoteBranches: true,
      remoteLoaded: false,
      filterQuery: "",
    }
    const resumableBranches = await trackProjectActivity(
      async () => getResumableBranches(targetProjectRoot, activeSlugs, {
        includeRemoteBranches: false,
      }),
      targetProjectRoot
    )

    const result = await popupManager.launchReopenWorktreePopup(
      resumableBranches,
      targetProjectRoot,
      popupState,
      activeSlugs
    )
    if (!result) {
      return
    }

    await handleReopenWorktree({
      branchName: result.candidate.branchName,
      slug: result.candidate.slug,
      path: result.candidate.path,
      lastModified: result.candidate.lastModified
        ? new Date(result.candidate.lastModified)
        : undefined,
      hasUncommittedChanges: result.candidate.hasUncommittedChanges,
      hasWorktree: result.candidate.hasWorktree,
      hasLocalBranch: result.candidate.hasLocalBranch,
      hasRemoteBranch: result.candidate.hasRemoteBranch,
      isRemote: result.candidate.isRemote,
    }, targetProjectRoot)
  }

  const executePaneShortcut = async (
    shortcut: RemotePaneActionShortcut,
    selectedPane: QmuxPane,
    options: { anchorMenuToPane?: boolean } = {}
  ) => {
    switch (shortcut) {
      case "a":
        await attachAgentsToPane(selectedPane)
        return
      case "b":
        await handleCreateChildWorktree(selectedPane)
        return
      case "f":
        await openFileBrowserInWorktree(selectedPane)
        return
      case "A":
        await openTerminalInWorktree(selectedPane)
        return
      case "m":
        await openPaneMenu(selectedPane, {
          anchorToPane: options.anchorMenuToPane,
        })
        return
      case "h":
        await togglePaneVisibility(selectedPane)
        return
      case "H":
        await toggleOtherPanesVisibility(selectedPane)
        return
      case "P":
        await toggleProjectPanesVisibility(getPaneProjectRoot(selectedPane, projectRoot))
        return
      case "r":
        await reopenClosedWorktreesInProject(getPaneProjectRoot(selectedPane, projectRoot))
        return
      case "S":
        if (!isDevMode) {
          setStatusMessage("Source switching is only available in DEV mode")
          setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_SHORT)
          return
        }
        await setDevSourceFromPane(selectedPane)
        return
      case "j":
        StateManager.getInstance().setDebugMessage(
          `Jumping to pane: ${getPaneDisplayName(selectedPane)}`
        )
        setTimeout(() => StateManager.getInstance().setDebugMessage(""), STATUS_MESSAGE_DURATION_SHORT)
        await actionSystem.executeAction(PaneAction.VIEW, selectedPane)
        return
      case "x":
        StateManager.getInstance().setDebugMessage(
          `Closing pane: ${getPaneDisplayName(selectedPane)}`
        )
        setTimeout(() => StateManager.getInstance().setDebugMessage(""), STATUS_MESSAGE_DURATION_SHORT)
        await actionSystem.executeAction(PaneAction.CLOSE, selectedPane)
        return
    }
  }

  const remoteDrainRef = useRef<Promise<void>>(Promise.resolve())

  useEffect(() => {
    const drainQueuedRemoteActions = async () => {
      const sessionName = getCurrentTmuxSessionName()
      if (!sessionName) {
        return
      }

      const queuedActions = await drainRemotePaneActions(sessionName)
      if (queuedActions.length === 0) {
        return
      }

      for (const action of queuedActions) {
        if (isInteractionBlocked()) {
          setStatusMessage(`qmux is busy; ignored remote pane action ${action.shortcut}`)
          setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_LONG)
          continue
        }

        const paneIndex = panes.findIndex((pane) => pane.paneId === action.targetPaneId)
        if (paneIndex === -1) {
          setStatusMessage(`Focused pane is not managed by qmux: ${action.targetPaneId}`)
          setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_LONG)
          continue
        }

        setSelectedIndex(paneIndex)
        await executePaneShortcut(action.shortcut, panes[paneIndex], {
          anchorMenuToPane: true,
        })
      }
    }

    const queueDrain = () => {
      remoteDrainRef.current = remoteDrainRef.current
        .then(drainQueuedRemoteActions)
        .catch((error: any) => {
          setStatusMessage(`Failed to process remote pane action: ${error?.message || String(error)}`)
          setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_LONG)
        })
      return remoteDrainRef.current
    }

    const handleRemoteSignal = () => {
      void queueDrain()
    }

    void queueDrain()
    process.on("qmux-external-command-signal" as any, handleRemoteSignal)

    return () => {
      process.off("qmux-external-command-signal" as any, handleRemoteSignal)
    }
  }, [
    actionSystem,
    handleCreateChildWorktree,
    handleReopenWorktree,
    ignoreInput,
    isCreatingPane,
    isDevMode,
    isLoading,
    panes,
    popupManager,
    projectRoot,
    runCommandInternal,
    runningCommand,
    setDevSourceFromPane,
    setSelectedIndex,
    setStatusMessage,
    showCommandPrompt,
    showFileCopyPrompt,
  ])

  useInput(async (input: string, key: any) => {
    // Ignore input temporarily after popup operations (prevents buffered keys from being processed)
    if (ignoreInput) {
      return
    }

    // Handle Ctrl+C for quit confirmation (must be first, before any other checks)
    if (key.ctrl && input === "c") {
      if (quitConfirmMode) {
        // Second Ctrl+C - tear down the whole session (closes every pane).
        // This is the hard quit; `q` remains the soft quit that leaves the
        // session alive for `qmux -c` to resume.
        killSessionExit()
      } else {
        // First Ctrl+C - show confirmation
        setQuitConfirmMode(true)
        // Reset after 3 seconds if user doesn't press Ctrl+C again
        setTimeout(() => {
          setQuitConfirmMode(false)
        }, 3000)
      }
      return
    }

    if (isCreatingPane || runningCommand || isLoading) {
      // Disable input while performing operations or loading
      return
    }

    // Handle quit confirm mode - ESC cancels it
    if (quitConfirmMode) {
      if (key.escape) {
        setQuitConfirmMode(false)
        return
      }
      // Allow other inputs to continue (don't return early)
    }

    if (showFileCopyPrompt) {
      if (input === "y" || input === "Y") {
        setShowFileCopyPrompt(false)
        const selectedPane = panes[selectedIndex]
        if (selectedPane && selectedPane.worktreePath && currentCommandType) {
          const paneProjectRoot = getPaneProjectRoot(selectedPane, projectRoot)
          await copyNonGitFiles(selectedPane.worktreePath, paneProjectRoot)

          // Mark as not first run and continue with command
          const newSettings = {
            ...projectSettings,
            [currentCommandType === "test" ? "firstTestRun" : "firstDevRun"]:
              true,
          }
          await saveSettings(newSettings)

          // Now run the actual command
          await runCommandInternal(currentCommandType, selectedPane)
        }
        setCurrentCommandType(null)
      } else if (input === "n" || input === "N" || key.escape) {
        setShowFileCopyPrompt(false)
        const selectedPane = panes[selectedIndex]
        if (selectedPane && currentCommandType) {
          // Mark as not first run and continue without copying
          const newSettings = {
            ...projectSettings,
            [currentCommandType === "test" ? "firstTestRun" : "firstDevRun"]:
              true,
          }
          await saveSettings(newSettings)

          // Now run the actual command
          await runCommandInternal(currentCommandType, selectedPane)
        }
        setCurrentCommandType(null)
      }
      return
    }

    if (showCommandPrompt) {
      if (key.escape) {
        setShowCommandPrompt(null)
        setCommandInput("")
      } else if (key.return) {
        if (commandInput.trim() === "") {
          // If empty, suggest a default command based on package manager
          const suggested = await suggestCommand(showCommandPrompt)
          if (suggested) {
            setCommandInput(suggested)
          }
        } else {
          // User provided manual command
          const newSettings = {
            ...projectSettings,
            [showCommandPrompt === "test" ? "testCommand" : "devCommand"]:
              commandInput.trim(),
          }
          await saveSettings(newSettings)
          const selectedPane = panes[selectedIndex]
          if (selectedPane) {
            // Check if first run
            const isFirstRun =
              showCommandPrompt === "test"
                ? !projectSettings.firstTestRun
                : !projectSettings.firstDevRun
            if (isFirstRun) {
              setCurrentCommandType(showCommandPrompt)
              setShowCommandPrompt(null)
              setShowFileCopyPrompt(true)
            } else {
              await runCommandInternal(showCommandPrompt, selectedPane)
              setShowCommandPrompt(null)
              setCommandInput("")
            }
          } else {
            setShowCommandPrompt(null)
            setCommandInput("")
          }
        }
      }
      return
    }

    // Shift+Up/Down: reorder the selected pane in the list + tmux layout.
    if (key.shift && (key.upArrow || key.downArrow) && selectedIndex < panes.length) {
      await movePane(panes[selectedIndex], key.upArrow ? -1 : 1)
      return
    }

    // Ctrl+Arrows: resize the selected pane (best-effort; auto-layout may re-tile on refresh).
    if (key.ctrl && (key.upArrow || key.downArrow || key.leftArrow || key.rightArrow) && selectedIndex < panes.length) {
      const pane = panes[selectedIndex]
      const direction = key.upArrow ? "U" : key.downArrow ? "D" : key.leftArrow ? "L" : "R"
      try {
        await TmuxService.getInstance().resizePaneBy(pane.paneId, direction, 3)
      } catch (error: any) {
        setStatusMessage(`Resize failed: ${error?.message || String(error)}`)
        setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_SHORT)
      }
      return
    }

    // Handle directional navigation with spatial awareness based on card grid layout
    if (key.upArrow || key.downArrow || key.leftArrow || key.rightArrow) {
      let targetIndex: number | null = null

      if (key.upArrow) {
        targetIndex = findCardInDirection(selectedIndex, "up")
      } else if (key.downArrow) {
        targetIndex = findCardInDirection(selectedIndex, "down")
      } else if (key.leftArrow) {
        targetIndex = findCardInDirection(selectedIndex, "left")
      } else if (key.rightArrow) {
        targetIndex = findCardInDirection(selectedIndex, "right")
      }

      if (targetIndex !== null) {
        setSelectedIndex(targetIndex)
      }
      return
    }

    if (
      selectedIndex < panes.length
      && ["a", "b", "f", "A", "m"].includes(input)
    ) {
      await executePaneShortcut(input as RemotePaneActionShortcut, panes[selectedIndex])
      return
    } else if (input === "s") {
      // Open settings popup
      const result = await popupManager.launchSettingsPopup(async () => {
        // Launch hooks popup
        await popupManager.launchHooksPopup(async () => {
          await launchHooksAuthoringSession()
        }, getActiveProjectRoot())
      }, getActiveProjectRoot(), sidebarProjects)
      if (result) {
        try {
          const activeProjectRoot = getActiveProjectRoot()
          const projectSettingsManager = new SettingsManager(activeProjectRoot)
          const updates = Array.isArray((result as any).updates)
            ? (result as any).updates
            : [result]

          let savedCount = 0
          let layoutBoundsUpdated = false
          let lastScope: "global" | "project" | "session" | null = null
          let themeSettingsChanged = false
          let effectiveSidebarProjects = sidebarProjects
          const resolveSavedProjectTheme = (targetProjectRoot: string) =>
            new SettingsManager(targetProjectRoot).getSettings().colorTheme

          for (const update of updates) {
            if (
              !update
              || typeof update.key !== "string"
            ) {
              continue
            }

            if (update.scope === "session") {
              if (update.key !== SIDEBAR_PROJECT_COLOR_THEME_SETTING_KEY) {
                continue
              }

              const updatedProjects = setSidebarProjectColorThemeSettingValue(
                effectiveSidebarProjects,
                activeProjectRoot,
                update.value,
                resolveSavedProjectTheme
              )
              await saveSidebarProjects(updatedProjects)
              effectiveSidebarProjects = updatedProjects
              refreshQmuxSettings(activeProjectRoot)
              savedCount += 1
              lastScope = update.scope
              themeSettingsChanged = true
              continue
            }

            if (update.scope !== "global" && update.scope !== "project") {
              continue
            }

            const resolvedUpdateKey = update.key === DEFAULT_COLOR_THEME_SETTING_KEY
              ? "colorTheme"
              : update.key
            projectSettingsManager.updateSetting(
              resolvedUpdateKey as keyof import("../types.js").QmuxSettings,
              update.value,
              update.scope
            )
            refreshQmuxSettings(activeProjectRoot)
            savedCount += 1
            lastScope = update.scope
            if (resolvedUpdateKey === "colorTheme") {
              themeSettingsChanged = true
            }

            if (resolvedUpdateKey === "minPaneWidth" || resolvedUpdateKey === "maxPaneWidth") {
              layoutBoundsUpdated = true
            }
          }

          if (themeSettingsChanged) {
            const syncedPanes = syncPaneColorThemes(
              panes,
              effectiveSidebarProjects,
              projectRoot
            )
            if (syncedPanes !== panes) {
              await savePanes(syncedPanes)
            }
          }

          if (layoutBoundsUpdated) {
            queueLayoutRefresh()
          }

          if (savedCount > 0) {
            const statusMessage =
              savedCount === 1
                ? `Setting saved (${lastScope})`
                : `${savedCount} settings saved`
            setStatusMessage(statusMessage)
            setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_SHORT)
          }
        } catch (error: any) {
          setStatusMessage(`Failed to save setting: ${error?.message || String(error)}`)
          setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_LONG)
        }
      }
    } else if (input === "[") {
      // Toggle sidebar collapse/expand
      await handleToggleSidebar()
      return
    } else if (input === "g") {
      // Change virtual grid column count
      await handleGridColumnsChange()
      return
    } else if (input === "G") {
      // Rearrange 2-3 content panes into a preset arrangement (Shift+G)
      await handleRearrangeChange()
      return
    } else if (input === "l") {
      // Open logs popup
      await popupManager.launchLogsPopup(getActiveProjectRoot())
    } else if (input === "h") {
      if (selectedIndex < panes.length) {
        await executePaneShortcut("h", panes[selectedIndex])
      } else {
        setStatusMessage("Select a pane to toggle visibility")
        setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_SHORT)
      }
    } else if (input === "H") {
      if (selectedIndex < panes.length) {
        await executePaneShortcut("H", panes[selectedIndex])
      } else {
        setStatusMessage("Select a pane to toggle the others")
        setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_SHORT)
      }
    } else if (input === "P") {
      if (selectedIndex < panes.length) {
        await executePaneShortcut("P", panes[selectedIndex])
      } else {
        await toggleProjectPanesVisibility()
      }
    } else if (input === "?") {
      // Open keyboard shortcuts popup
      const shortcutsAction = await popupManager.launchShortcutsPopup(
        !!controlPaneId,
        getActiveProjectRoot()
      )
      if (shortcutsAction === "hooks") {
        await launchHooksAuthoringSession()
      }
    } else if (input === "L" && controlPaneId) {
      // Reset layout to sidebar configuration (Shift+L)
      try {
        await enforceControlPaneSize(controlPaneId, SIDEBAR_WIDTH, { forceLayout: true })
        setStatusMessage("Layout reset")
        setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_SHORT)
      } catch (error: any) {
        setStatusMessage(`Failed to reset layout: ${error?.message || String(error)}`)
        setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_LONG)
      }
    } else if (input === "T") {
      // Demo toasts (Shift+T) - cycles through different types
      const stateManager = StateManager.getInstance()
      const demos = [
        { msg: "Pane created successfully", severity: "success" as const },
        { msg: "Failed to merge: conflicts detected", severity: "error" as const },
        { msg: "Warning: API key not configured", severity: "warning" as const },
        { msg: "This is a longer informational message that will wrap to multiple lines if needed to demonstrate how toasts handle longer content", severity: "info" as const },
      ]
      // Queue all demo toasts
      demos.forEach(demo => stateManager.showToast(demo.msg, demo.severity))
    } else if (input === "q") {
      cleanExit()
    } else if (isDevMode && input === "S" && selectedIndex < panes.length) {
      await executePaneShortcut("S", panes[selectedIndex])
      return
    } else if (input === "r") {
      await reopenClosedWorktreesInProject(getActiveProjectRoot())
      return
    } else if (
      !isLoading &&
      (
        input === "p"
      )
    ) {
      // Quick-open project from ~/git (sorted by most recently modified)
      await handleProjectQuickOpen()
      return
    } else if (
      !isLoading &&
      (
        input === "P"
      )
    ) {
      // Add a project to the sidebar (Shift+P)
      await handleAddProjectToSidebar()
      return
    } else if (!isLoading && input === "R") {
      await handleRemoveProjectFromSidebar(getActiveProjectRoot())
      return
    } else if (!isLoading && input === "n") {
      await handleCreateAgentPane(getActiveProjectRoot())
      return
    } else if (!isLoading && input === "t") {
      await handleCreateTerminalPane(getActiveProjectRoot())
      return
    } else if (
      !isLoading &&
      key.return &&
      !!getProjectActionByIndex(projectActionItems, selectedIndex)
    ) {
      const selectedAction = getProjectActionByIndex(projectActionItems, selectedIndex)!
      if (selectedAction.kind === "new-agent") {
        await handleCreateAgentPane(selectedAction.projectRoot)
      } else if (selectedAction.kind === "terminal") {
        await handleCreateTerminalPane(selectedAction.projectRoot)
      } else if (selectedAction.kind === "project") {
        await handleProjectQuickOpen()
      } else if (selectedAction.kind === "remove-project") {
        await handleRemoveProjectFromSidebar(selectedAction.projectRoot)
      }
      return
    } else if (
      selectedIndex < panes.length
      && (input === "j" || input === "x")
    ) {
      await executePaneShortcut(input as RemotePaneActionShortcut, panes[selectedIndex])
      return
    } else if (key.return && selectedIndex < panes.length) {
      // Open pane menu for selected pane
      await openPaneMenu(panes[selectedIndex])
      return
    }
  })
}
