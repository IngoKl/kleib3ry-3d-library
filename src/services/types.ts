/**
 * The one seam between the app and the machine's files.
 *
 * Everything the UI knows about the filesystem goes through this interface, so
 * the eventual Linux-hosted web build is a driver swap (HTTP against a
 * server-side library folder) rather than a rewrite. Nothing above this layer
 * may import `@tauri-apps/*` directly.
 */

export type BookFormat = 'pdf' | 'epub'

/** A book as the index knows it. `cover` is an absolute path or null. */
export type IndexedBook = {
  id: string
  path: string
  format: BookFormat
  title: string
  author: string | null
  cover: string | null
  pageCount: number | null
  sizeBytes: number
  indexedAt: number
}

export type ScanProgress = { done: number; total: number; current: string }

export type ScanSummary = {
  found: number
  added: number
  unchanged: number
  removed: number
  failed: number
}

/**
 * Which book sits on which shelf: `shelfId:row` -> ordered book ids. Opaque and
 * versioned; the front end owns its schema. Written by the app, not by hand.
 */
export type LayoutDocument = {
  schemaVersion: number
  rows: Record<string, string[]>
  /** Box furniture id -> the books in that moving box, bottom of the pile first. */
  boxes?: Record<string, string[]>
  /** Book id -> the spreads you have put a bookmark in, ascending. */
  bookmarks?: Record<string, number[]>
}

/** Where this library is saved. Both files live in the library folder. */
export type SavePaths = { world: string; layout: string }

export interface LibraryService {
  /** Which driver is live. Surfaced in the HUD so misconfiguration is visible. */
  readonly kind: 'tauri' | 'browser'

  /** False when the host cannot present a native directory picker. */
  readonly canPickFolder: boolean

  /** False when the host cannot index real files (the browser driver). */
  readonly canIndex: boolean

  getRoot(): Promise<string | null>
  setRoot(path: string): Promise<void>
  /** Prompt for a folder. Resolves to null if the user cancels or cannot pick. */
  pickRoot(): Promise<string | null>

  /** Walk the library folder and reconcile the index with it. */
  scan(): Promise<ScanSummary>
  onScanProgress(listener: (progress: ScanProgress) => void): () => void
  listBooks(): Promise<IndexedBook[]>

  /** Raw bytes of a book file, for the reader. */
  readBook(id: string): Promise<Uint8Array>
  /** Cache a cover the front end rendered. Returns its absolute path. */
  saveRenderedCover(id: string, dataUrl: string): Promise<string>

  /**
   * The hand-edited world document, as text — comments and formatting intact,
   * because the person who wrote them has to read them again.
   */
  loadWorld(): Promise<string | null>
  /** Write the starter document. Resolves false if one is already there. */
  writeDefaultWorld(text: string): Promise<boolean>
  /**
   * A cheap value that changes when the world file does, so the app can notice
   * you saving an edit in your editor and reload the room.
   */
  worldStamp(): Promise<string | null>
  /** The files this library is saved into, for the panel to show. */
  savePaths(): Promise<SavePaths>

  loadLayout(): Promise<LayoutDocument | null>
  saveLayout(layout: LayoutDocument): Promise<void>

  /** Turn an absolute file path into a URL the WebView can actually load. */
  assetUrl(path: string): string
}

export class UnsupportedOperation extends Error {
  constructor(operation: string, kind: string) {
    super(`${operation} is not available in the ${kind} driver`)
    this.name = 'UnsupportedOperation'
  }
}
