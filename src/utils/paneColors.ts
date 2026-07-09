import path from 'path';
import type { QmuxPane, QmuxThemeName, SidebarProject } from '../types.js';
import { isQmuxThemeName, normalizeQmuxTheme } from '../theme/themePalette.js';
import { getPaneProjectRoot } from './paneProject.js';
import { getSidebarProjectColorTheme } from './sidebarProjects.js';
import { SettingsManager } from './settingsManager.js';

type ProjectThemeCache = Map<string, QmuxThemeName>;

function getCacheKey(projectRoot: string): string {
  return path.resolve(projectRoot);
}

export function resolveProjectColorTheme(
  projectRoot: string,
  sidebarProjects: SidebarProject[],
  cache: ProjectThemeCache = new Map()
): QmuxThemeName {
  const cacheKey = getCacheKey(projectRoot);
  const cachedTheme = cache.get(cacheKey);
  if (cachedTheme) {
    return cachedTheme;
  }

  const resolvedTheme = getSidebarProjectColorTheme(sidebarProjects, projectRoot)
    || normalizeQmuxTheme(new SettingsManager(projectRoot).getSettings().colorTheme);

  cache.set(cacheKey, resolvedTheme);
  return resolvedTheme;
}

export function getPaneColorTheme(
  pane: QmuxPane,
  sidebarProjects: SidebarProject[],
  fallbackProjectRoot: string,
  cache: ProjectThemeCache = new Map()
): QmuxThemeName {
  if (isQmuxThemeName(pane.colorTheme)) {
    return pane.colorTheme;
  }

  return resolveProjectColorTheme(
    getPaneProjectRoot(pane, fallbackProjectRoot),
    sidebarProjects,
    cache
  );
}

export function syncPaneColorThemes(
  panes: QmuxPane[],
  sidebarProjects: SidebarProject[],
  fallbackProjectRoot: string
): QmuxPane[] {
  const projectThemeCache: ProjectThemeCache = new Map();
  let changed = false;

  const updatedPanes = panes.map((pane) => {
    // Respect an explicit per-pane color; never overwrite a manual override.
    if (pane.colorThemeSource === 'manual') {
      return pane;
    }

    const colorTheme = resolveProjectColorTheme(
      getPaneProjectRoot(pane, fallbackProjectRoot),
      sidebarProjects,
      projectThemeCache
    );

    if (pane.colorTheme === colorTheme) {
      return pane;
    }

    changed = true;
    return {
      ...pane,
      colorTheme,
    };
  });

  return changed ? updatedPanes : panes;
}
