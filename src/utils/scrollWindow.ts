/**
 * Compute a scrolling window over a list so the selected item stays visible.
 *
 * Returns the [start, end) slice bounds. The window keeps the selection in
 * view, centering it once the list is longer than `maxVisible`. Used by
 * long list popups (e.g. the project chooser) to avoid rendering more rows
 * than the popup can display, which would push the selection off-screen and
 * make arrow navigation appear broken.
 */
export function computeScrollWindow(
  selectedIndex: number,
  total: number,
  maxVisible: number
): { start: number; end: number } {
  const visible = Math.max(1, Math.floor(maxVisible) || 1);

  if (total <= visible) {
    return { start: 0, end: total };
  }

  const clampedSelected = Math.min(Math.max(0, selectedIndex), total - 1);

  // Center the selection within the window when possible.
  let start = clampedSelected - Math.floor(visible / 2);
  start = Math.max(0, Math.min(start, total - visible));
  const end = start + visible;

  return { start, end };
}
