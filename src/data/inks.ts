/**
 * The pens in the whiteboard's tray.
 *
 * One list, because three places have to agree about it: the tray drawn under
 * the board, the barrel of the marker in your hand, and the ink a saved stroke
 * is painted in. A stroke stores an *index* rather than a colour, so changing a
 * pen here changes every line already drawn in it.
 */
export const MARKER_INKS = ['#2b3a55', '#7d3b32', '#3f5a4a'] as const

export const inkAt = (index: number): string => MARKER_INKS[index % MARKER_INKS.length]!
