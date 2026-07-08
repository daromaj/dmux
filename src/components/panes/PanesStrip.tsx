import React, { memo, useMemo } from "react"
import { Box, Text } from "ink"
import type {
  DmuxPane,
  DmuxThemeName,
  SidebarProject,
} from "../../types.js"
import type { AgentStatusMap } from "../../hooks/useAgentStatus.js"
import PaneCard from "./PaneCard.js"
import { COLORS } from "../../theme/colors.js"
import { getDmuxThemeAccent } from "../../theme/colors.js"
import {
  buildProjectActionLayout,
  type ProjectActionItem,
} from "../../utils/projectActions.js"
import { isActiveDevSourcePath } from "../../utils/devSource.js"

interface PanesStripProps {
  panes: DmuxPane[]
  selectedIndex: number
  columns: number
  isLoading: boolean
  themeName: string
  projectThemeByRoot: Map<string, DmuxThemeName>
  agentStatuses?: AgentStatusMap
  activeDevSourcePath?: string
  sidebarProjects: SidebarProject[]
  fallbackProjectRoot: string
  fallbackProjectName: string
  footerTip?: string
}

const CARD_WIDTH = 40

/**
 * Horizontal "control strip" layout used when the control pane is anchored to
 * the bottom. In the 4-row bottom strip the layout is intentionally tight:
 *   row 1 = selectable action cards (new agent / terminal / project) that double
 *           as the shortcut hints, with the remaining key hints appended inline
 *   row 2 = the pane list (cards chunked into rows of `columns`)
 *   row 3 = rotating Tip line, rendered directly under the pane list (no gap)
 * Pane order + chunking match `buildHorizontalNavigationRows`, so keyboard
 * navigation stays consistent.
 */
const PanesStrip: React.FC<PanesStripProps> = memo(({
  panes,
  selectedIndex,
  columns,
  isLoading,
  themeName,
  projectThemeByRoot,
  agentStatuses,
  activeDevSourcePath,
  sidebarProjects,
  fallbackProjectRoot,
  fallbackProjectName,
  footerTip,
}) => {
  const actionLayout = useMemo(
    () => buildProjectActionLayout(
      panes,
      sidebarProjects,
      fallbackProjectRoot,
      fallbackProjectName
    ),
    [panes, sidebarProjects, fallbackProjectRoot, fallbackProjectName]
  )

  const cols = Math.max(1, Math.floor(columns) || 1)

  // Flatten panes in visual order (matches buildHorizontalNavigationRows).
  const flatPanes = useMemo(() => {
    const out: { pane: DmuxPane; index: number; projectRoot: string }[] = []
    for (const group of actionLayout.groups) {
      for (const entry of group.panes) {
        out.push({ pane: entry.pane, index: entry.index, projectRoot: group.projectRoot })
      }
    }
    return out
  }, [actionLayout.groups])

  const getProjectThemeName = (projectRoot: string): DmuxThemeName =>
    projectThemeByRoot.get(projectRoot) || (themeName as DmuxThemeName)

  // Chunk into rows of `cols`.
  const rows = useMemo(() => {
    const chunked: typeof flatPanes[] = []
    for (let i = 0; i < flatPanes.length; i += cols) {
      chunked.push(flatPanes.slice(i, i + cols))
    }
    return chunked
  }, [flatPanes, cols])

  const actionItems = actionLayout.actionItems.filter(
    (action) =>
      action.kind === "new-agent" ||
      action.kind === "terminal" ||
      action.kind === "project"
  )

  const renderActionLabel = (action: ProjectActionItem) => {
    const isSelected = selectedIndex === action.index
    const accent = getDmuxThemeAccent(getProjectThemeName(action.projectRoot))
    const color = isSelected ? accent : COLORS.border
    if (action.kind === "new-agent") {
      return (
        <Text color={color} bold={isSelected}>
          <Text color="cyan">[n]</Text>ew agent
        </Text>
      )
    }
    if (action.kind === "project") {
      return (
        <Text color={color} bold={isSelected}>
          <Text color="cyan">[p]</Text>roject
        </Text>
      )
    }
    return (
      <Text color={color} bold={isSelected}>
        <Text color="cyan">[t]</Text>erminal
      </Text>
    )
  }

  return (
    <Box flexDirection="column">
      {/* Row 1: selectable action cards that double as the shortcut hints, with
          the remaining key hints appended inline. Single line — no duplicate
          static shortcuts row (that used to repeat new agent/terminal/project). */}
      {!isLoading && actionItems.length > 0 && (
        <Box>
          <Text>
            {actionItems.map((action, index) => (
              <React.Fragment key={`${action.projectRoot}-${action.kind}`}>
                {index > 0 && <Text color={COLORS.border}>{"   "}</Text>}
                {renderActionLabel(action)}
              </React.Fragment>
            ))}
            <Text color={COLORS.border}>{"     "}</Text>
            <Text color="cyan" bold>m</Text>
            <Text color={COLORS.border}> menu   </Text>
            <Text color="cyan" bold>[</Text>
            <Text color={COLORS.border}> collapse   </Text>
            <Text color="cyan" bold>?</Text>
            <Text color={COLORS.border}> all keys</Text>
          </Text>
        </Box>
      )}

      {/* Row 2+: the pane list. */}
      {flatPanes.length === 0 ? (
        <Box>
          <Text color={COLORS.border}>
            No panes yet — press <Text color="cyan" bold>n</Text> to launch an agent or{" "}
            <Text color="cyan" bold>t</Text> for a terminal.
          </Text>
        </Box>
      ) : (
        rows.map((row, rowIndex) => (
          <Box key={`strip-row-${rowIndex}`} flexDirection="row">
            {row.map((entry) => {
              const paneWithStatus = {
                ...entry.pane,
                agentStatus: agentStatuses?.get(entry.pane.id) || entry.pane.agentStatus,
              }
              const isSelected = selectedIndex === entry.index
              const isDevSource = isActiveDevSourcePath(
                entry.pane.worktreePath,
                activeDevSourcePath
              )
              return (
                <Box key={entry.pane.id} width={CARD_WIDTH}>
                  <PaneCard
                    pane={paneWithStatus}
                    isDevSource={isDevSource}
                    selected={isSelected}
                    themeName={themeName}
                    projectThemeName={getProjectThemeName(entry.projectRoot)}
                  />
                </Box>
              )
            })}
          </Box>
        ))
      )}

      {/* Row 3: rotating tip, hugging the pane list directly (no gap). */}
      {footerTip && (
        <Box>
          <Text dimColor wrap="truncate-end">
            <Text color="green">Tip:</Text> {footerTip}
          </Text>
        </Box>
      )}
    </Box>
  )
})

export default PanesStrip
