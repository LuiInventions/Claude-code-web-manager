/**
 * Columns and rows for a CLI pane of `width`×`height` pixels.
 * Returns null while the pane has no layout yet (hidden, or not painted).
 * A laid-out pane always gets its own grid — never the 80×24 terminal
 * default, which is taller than a short window and shifts the first paint.
 */
export function cliGridForBox(
  width: number,
  height: number,
  cellWidth = 8.4,
  cellHeight = 17,
): { cols: number; rows: number } | null {
  if (!(width >= 16) || !(height >= 16)) return null;
  if (!(cellWidth > 0) || !(cellHeight > 0)) return null;
  return {
    cols: Math.max(2, Math.floor(width / cellWidth)),
    rows: Math.max(2, Math.floor(height / cellHeight)),
  };
}
