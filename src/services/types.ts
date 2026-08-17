/**
 * The only seam between the app and the filesystem. Nothing above
 * `src/services/` may import `@tauri-apps/*`: swapping the driver is what lets
 * hosted mode exist without changes above this layer.
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
}

export type ScanProgress = { done: number; total: number; current: string }

export type ScanSummary = {
  found: number
  added: number
  unchanged: number
  removed: number
  failed: number
}

/** Which book sits where. Stored verbatim by Rust; the front end owns this schema. */
export type LayoutDocument = {
  rows: Record<string, string[]>
  /** Box furniture id -> the books in that moving box, bottom of the pile first. */
  boxes?: Record<string, string[]>
  /** Book id -> the spread you had open when you last closed it. */
  progress?: Record<string, number>
  /** Books put down somewhere that is not a shelf or a box. */
  loose?: Record<string, LoosePlacement>
  /** Where you have shoved the moving boxes, by furniture id. */
  furniture?: Record<string, { at: [number, number]; facing: number; elevation?: number }>
  /** Boxes made off the kitchen stack, with the room whose frame `at` is in. */
  spawnedBoxes?: Record<
    string,
    { room: string; at: [number, number]; facing: number; elevation?: number }
  >
  /** Document boxes that have been broken down, by furniture id. */
  removedBoxes?: string[]
  /** Shelf id -> what you have written on its label. */
  labels?: Record<string, string>
  /** Pages torn out of books and notes written by hand, pinned up round the house. */
  pins?: PinnedSheet[]
  /** Whiteboard furniture id -> what has been drawn on it, oldest stroke first. */
  drawings?: Record<string, BoardStroke[]>
  /** Records you have filed or put down by hand. Everything else is dealt. */
  records?: RecordLayout
  /** The small things — the cup, the cans, the takeaway boxes — and where each one stands. */
  props?: Record<string, PlacedProp>
}

/**
 * A small carryable thing; `full` is its only state. There is one `cup` and one
 * `headlamp` — the latter stored only while off your head — while cans and
 * takeaway boxes are minted on arrival and destroyed by the bin.
 */
export type PropKind = 'cup' | 'can' | 'takeaway' | 'headlamp'

export type PlacedProp = {
  kind: PropKind
  full: boolean
  x: number
  y: number
  z: number
  /** Radians about Y. */
  yaw: number
}

/** Points in board space — `u` across, `v` up, 0 to 1 — so a resize keeps the drawing. */
export type BoardStroke = {
  /** Which pen, as an index into the marker inks. */
  ink: number
  /** Flattened u, v pairs. */
  points: number[]
}

/** Only records that have been moved; the rest are dealt from `music/` folder order. */
export type RecordLayout = {
  /** Track id -> the crate you filed it in, when that is not where it was dealt. */
  filed?: Record<string, string>
  /** Track id -> where you set it down, for a record that is out of the crates. */
  loose?: Record<string, RecordPlacement>
}

/** A record left leaning somewhere: a point and the way it faces. */
export type RecordPlacement = { x: number; y: number; z: number; yaw: number }

/**
 * A page copied out of a book, or a note. World coordinates rather than a wall
 * id, so deleting a wall leaves the sheet where it was instead of teleporting it
 * to whichever wall inherited the id.
 */
export type PinnedSheet = {
  /** Unique within a library. Generated when the sheet is made. */
  id: string
  kind: 'page' | 'note'
  /** For a page: which book, and which page of it. The book is not modified. */
  bookId?: string
  page?: number
  /** For a note: what is written on it. */
  text?: string
  x: number
  y: number
  z: number
  /** Radians about Y. The direction the face of the sheet points. */
  yaw: number
  /** Radians of tilt about the sheet's own normal. Nothing pinned up is straight. */
  tilt: number
  /** Which pad a note came off, as an index into the renderer's colours. */
  colour?: number
}

/**
 * World coordinates rather than relative to whatever it sits on, so removing a
 * table drops the book to the floor instead of moving it.
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

/** Where this library is saved. All the files live in the library folder. */
export type SavePaths = { world: string; layout: string; annotations: string }

/** One note written on a page of a book. Pages are 1-based, as printed. */
export type BookNote = {
  /** Unique within a library. Generated when the note is written. */
  id: string
  page: number
  text: string
  /** ISO 8601, so the file is legible without the app. */
  created: string
}

/**
 * Bookmarks and notes, readable outside the app: 1-based page numbers, and each
 * book carries its title and author so an entry outlives the index.
 */
export type AnnotationsDocument = {
  books: Record<
    string,
    {
      title: string
      author: string | null
      /** 1-based page numbers, ascending. */
      bookmarks?: number[]
      /** Page order, then creation order. */
      notes?: BookNote[]
      /** Keyed by page number. Whiteboard-shaped strokes in page space, so one painter serves both. */
      drawings?: Record<string, BoardStroke[]>
    }
  >
}

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

/** No duration or thumbnail: both would mean demuxing, and `video/` is not indexed. */
export type IndexedTape = {
  id: string
  path: string
  title: string
  /** The folder it sits in — a season, a year, a director. */
  series: string | null
  /** `mp4`, `webm`, `m4v`, `mov`, `mkv`, `ogv`. */
  format: string
  sizeBytes: number
}

/** Not probed: a CHIP-8 image has no header, so the filename is the only label. */
export type IndexedRom = {
  id: string
  path: string
  title: string
  /** The folder it sits in — `ch8`, a collection, a year. */
  series: string | null
  /** `ch8`. */
  format: string
  sizeBytes: number
}

/**
 * The lamps, the hour and the weather. Its own file because it describes the
 * room rather than the books, and deleting it is the documented reset.
 */
export type AmbienceState = {
  /** Furniture id -> whether it is lit. Absent means "as the document says". */
  on: Record<string, boolean>
  /** Whether it is night outside. Absent means day. */
  night?: boolean
  /** Whether it is raining. A room fact like `night`, not a machine setting. */
  rain?: boolean
}

/**
 * `tauri` is the desktop app over IPC, `http` a browser against
 * `kleib3ry-server`, `browser` a plain tab with a stand-in library. Shown in the
 * HUD, because an empty-looking library is usually the wrong one of these.
 */
export type DriverKind = 'tauri' | 'http' | 'browser'

export interface LibraryService {
  /** Which driver is live. Surfaced in the HUD so misconfiguration is visible. */
  readonly kind: DriverKind

  /** False when the host cannot present a native directory picker. */
  readonly canPickFolder: boolean

  /** False when the host cannot index real files (the browser driver). */
  readonly canIndex: boolean

  /** Separate from `canIndex` so an offline build can disable it and keep indexing. */
  readonly canFetchPapers: boolean

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
   * Download an arXiv paper into the library, index it, and return the book it
   * became. In `core/src/paper.rs` because arxiv.org refuses cross-origin
   * requests and the result is a file nothing above here may write. `id` is
   * whatever was typed; the core decides whether it is an id at all.
   */
  fetchPaper(id: string): Promise<IndexedBook>

  /** The hand-edited world document, as text — comments and formatting intact. */
  loadWorld(): Promise<string | null>
  /** Write the starter document. Resolves false if one is already there. */
  writeDefaultWorld(text: string): Promise<boolean>
  /** A cheap value that changes when the world file does, for live reload. */
  worldStamp(): Promise<string | null>
  /** The files this library is saved into, for the panel to show. */
  savePaths(): Promise<SavePaths>

  loadLayout(): Promise<LayoutDocument | null>
  saveLayout(layout: LayoutDocument): Promise<void>

  /** All four give an empty list with no filesystem, so the scene builds regardless. */
  listTracks(): Promise<IndexedTrack[]>
  listArtwork(): Promise<IndexedArtwork[]>
  listTapes(): Promise<IndexedTape[]>
  listRoms(): Promise<IndexedRom[]>

  /** Raw bytes of one ROM, for the emulator. Read whole — never streamed. */
  readRom(id: string): Promise<Uint8Array>

  /** Null if never written, which means "as `library.json` says". */
  loadAmbience(): Promise<AmbienceState | null>
  saveAmbience(state: AmbienceState): Promise<void>

  /** Its own file, page-numbered and readable without the app. Null if never written. */
  loadAnnotations(): Promise<AnnotationsDocument | null>
  saveAnnotations(doc: AnnotationsDocument): Promise<void>
  /** Resolves to the written path, or null with no filesystem — then offer a download. */
  exportAnnotationsMarkdown(markdown: string): Promise<string | null>

  /** Turn an absolute file path into a URL the WebView can actually load. */
  assetUrl(path: string): string
}

export class UnsupportedOperation extends Error {
  constructor(operation: string, kind: string) {
    super(`${operation} is not available in the ${kind} driver`)
    this.name = 'UnsupportedOperation'
  }
}
