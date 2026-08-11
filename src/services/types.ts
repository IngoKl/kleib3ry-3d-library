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
  /** Book id -> the spread you had open when you last closed it. */
  progress?: Record<string, number>
  /** Books put down somewhere that is not a shelf or a box. */
  loose?: Record<string, LoosePlacement>
  /** Where you have shoved the moving boxes, by furniture id. */
  furniture?: Record<string, { at: [number, number]; facing: number }>
  /** Shelf id -> what you have written on its label. */
  labels?: Record<string, string>
}

/**
 * A book lying somewhere in the room: on a table, or on the floor where you
 * dropped it.
 *
 * World coordinates rather than something-relative, because a book is put down
 * *there* — the table it happens to be over is not what you were thinking
 * about, and if the table goes away the book should stay on the floor under
 * where it was rather than teleport.
 */
export type LoosePlacement = {
  x: number
  y: number
  z: number
  /** Radians about Y. */
  yaw: number
  /** True if it was set down open, in which case `spread` is the page shown. */
  open: boolean
  spread: number
}

/** Where this library is saved. Both files live in the library folder. */
export type SavePaths = { world: string; layout: string }

/** A track in the library's `music/` folder, as the indexer found it. */
export type IndexedTrack = {
  id: string
  path: string
  title: string
  artist: string | null
  album: string | null
  /** `mp3`, `wav`, `flac`, `ogg`, `m4a`. */
  format: string
  sizeBytes: number
}

/** A picture in the library's `artwork/` folder. */
export type IndexedArtwork = {
  id: string
  path: string
  title: string
}

/**
 * Which lamps are on. Kept in its own small file rather than in the book
 * layout: it is about the room rather than about the books, and a file you can
 * delete to get all the lights back on is a good thing to have.
 */
export type LightState = {
  schemaVersion: number
  /** Furniture id -> whether it is lit. Absent means "as the document says". */
  on: Record<string, boolean>
}

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

  /**
   * The rest of the library folder: records for the player, pictures for the
   * walls. Both resolve to an empty list on a host that cannot read files, so
   * the scene simply has no records rather than failing to build.
   */
  listTracks(): Promise<IndexedTrack[]>
  listArtwork(): Promise<IndexedArtwork[]>

  /** Which lamps are on, from `.library/lights.json`. Null if never written. */
  loadLights(): Promise<LightState | null>
  saveLights(state: LightState): Promise<void>

  /** Turn an absolute file path into a URL the WebView can actually load. */
  assetUrl(path: string): string
}

export class UnsupportedOperation extends Error {
  constructor(operation: string, kind: string) {
    super(`${operation} is not available in the ${kind} driver`)
    this.name = 'UnsupportedOperation'
  }
}
