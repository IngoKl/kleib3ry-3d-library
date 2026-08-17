/**
 * One list, because the tray under the board, the marker in your hand and a
 * saved stroke's ink all have to agree. A stroke stores an index rather than a
 * colour, so changing a pen here changes every line already drawn in it.
 */
export const MARKER_INKS = ['#2b3a55', '#7d3b32', '#3f5a4a'] as const

export const inkAt = (index: number): string => MARKER_INKS[index % MARKER_INKS.length]!
