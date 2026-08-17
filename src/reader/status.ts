/**
 * What the reader is currently doing. Kept outside React because it changes
 * mid-render-loop; the HUD and the desktop probe read it.
 */
export type ReaderStatus = {
  bookId: string | null
  pages: number
  spread: number
  /** True once a page has actually been rasterised onto the mesh. */
  rendered: boolean
  /**
   * The page numbers whose textures are on the static sheets. It must always
   * agree with `spread`: a turn that commits before its destination has
   * rasterised is exactly the flash where the old spread reappears mid-turn.
   */
  showing: [number, number] | null
  /**
   * Whether the turning leaf is on screen. It is what hides the swap, so it may
   * only come down once `showing` has already moved to the destination spread —
   * dropping it first is what exposed the old spread mid-turn.
   */
  turning: boolean
  /** How far through the turn the leaf is, 0 to 1. Drives the drag tests. */
  progress: number
  /** True while the pen is picked up and a drag draws instead of turning. */
  pen: boolean
  /**
   * True from a jump being asked for until the sheets show its target. Owned
   * here rather than inferred by the HUD, because the two values it would
   * infer from are written on different schedules and disagree mid-turn.
   */
  seeking: boolean
  failure: string | null
}

export const readerStatus: ReaderStatus = {
  bookId: null,
  pages: 0,
  spread: 0,
  rendered: false,
  showing: null,
  turning: false,
  progress: 0,
  pen: false,
  seeking: false,
  failure: null,
}

/**
 * Test access to the open book's rasterised page canvases; the Reader installs
 * it while a book is open. Outside React for the same reason the status is.
 */
export const readerHandles: {
  pageCanvas: ((page: number) => HTMLCanvasElement | null) | null
} = { pageCanvas: null }

export function resetReaderStatus(bookId: string | null) {
  readerStatus.bookId = bookId
  readerStatus.pages = 0
  readerStatus.spread = 0
  readerStatus.rendered = false
  readerStatus.showing = null
  readerStatus.turning = false
  readerStatus.progress = 0
  readerStatus.pen = false
  readerStatus.seeking = false
  readerStatus.failure = null
}
