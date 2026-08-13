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
  /**
   * Legacy (schema <= 7): bookmarks now live in `annotations.json`, and this
   * field is read exactly once, to migrate them out. Never written back.
   */
  bookmarks?: Record<string, number[]>
  /** Book id -> the spread you had open when you last closed it. */
  progress?: Record<string, number>
  /** Books put down somewhere that is not a shelf or a box. */
  loose?: Record<string, LoosePlacement>
  /** Where you have shoved the moving boxes, by furniture id. */
  furniture?: Record<string, { at: [number, number]; facing: number; elevation?: number }>
  /**
   * Boxes made up off the stack in the kitchen: id -> which room's frame the
   * position is written in, and where. The app's boxes, so they live here and
   * never in `library.json`.
   */
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
 * A small carryable thing: the coffee cup, a can from the fridge, a takeaway
 * box the delivery left. `full` is the one bit of state any of them has — a
 * drunk can and a cold one are the same cylinder.
 *
 * A real position, like a loose book, because "there, where I put it" is the
 * whole point of being able to put one down. There is exactly one cup (its id
 * is `cup`) and one headlamp (`headlamp` — worn rather than carried, and a
 * placed prop only while it is off your head); cans and boxes are minted as
 * they arrive and destroyed by the bin.
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

/**
 * One line drawn on a whiteboard.
 *
 * The points are in board space — `u` across from the left edge, `v` up from the
 * bottom, both 0 to 1 — rather than in metres, so a board resized in
 * `library.json` keeps its drawing instead of scattering it.
 */
export type BoardStroke = {
  /** Which pen, as an index into the marker inks. */
  ink: number
  /** Flattened u, v pairs. */
  points: number[]
}

/**
 * Where the records are, for the ones you have had an opinion about.
 *
 * Deliberately sparse. A record nobody has touched is dealt into a crate from
 * the `music/` folder's own order — see `Records.tsx` — so the common case is an
 * empty object, and only a record you carried somewhere is written down.
 */
export type RecordLayout = {
  /** Track id -> the crate you filed it in, when that is not where it was dealt. */
  filed?: Record<string, string>
  /** Track id -> where you set it down, for a record that is out of the crates. */
  loose?: Record<string, RecordPlacement>
}

/** A record left leaning somewhere: a point and the way it faces. */
export type RecordPlacement = { x: number; y: number; z: number; yaw: number }

/**
 * A sheet of paper stuck to a wall: a page copied out of a book, or a note.
 *
 * "Torn out" is a lie the interface tells and this type keeps honest — a page
 * records which book and which *page number* it came from, and the book keeps
 * its page. Nothing is removed from anything; the sheet is a second view of a
 * page that is still where it was, which is also why a pin survives being taken
 * down and put up somewhere else.
 *
 * World coordinates and a yaw rather than a wall id, for the same reason a book
 * put down on a table stores a point: you stuck it *there*. A wall that goes
 * away should leave the sheet hanging in the air over where it was rather than
 * teleporting it to whichever wall inherited the id.
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
 * Bookmarks and notes, in `.library/annotations.json` — a file meant to be
 * readable outside the app: 1-based page numbers, and each book carries its
 * title and author so an entry outlives the index.
 */
export type AnnotationsDocument = {
  schemaVersion: number
  books: Record<
    string,
    {
      title: string
      author: string | null
      /** 1-based page numbers, ascending. */
      bookmarks?: number[]
      /** Page order, then creation order. */
      notes?: BookNote[]
      /**
       * Ink drawn on pages, keyed by page number (a string, as JSON keys are).
       * Strokes are in page space — `u` across, `v` up, 0 to 1 — the same
       * shape a whiteboard stores, so one painter serves both.
       */
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

/**
 * A tape in the library's `video/` folder.
 *
 * No duration and no thumbnail: reading either means demuxing a container, and
 * the whole reason `video/` is walked on demand rather than indexed is that a
 * tape needs no more describing than its filename gives it.
 */
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

/**
 * A game in the library's `roms/` folder, for the arcade machine.
 *
 * Not probed at all: a CHIP-8 image is a bare byte array with no header, so
 * the filename is all the label there is.
 */
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
 * How the room is right now: the lamps, the hour and the weather.
 *
 * Kept in its own small file rather than in the book layout, because it is
 * about the room rather than about the books — and a file you can delete to get
 * every light back on and a dry afternoon is a good thing to have.
 */
export type AmbienceState = {
  schemaVersion: number
  /** Furniture id -> whether it is lit. Absent means "as the document says". */
  on: Record<string, boolean>
  /** Whether it is night outside. Absent means day. */
  night?: boolean
  /**
   * Whether it is raining. Here rather than in the app's own settings for the
   * same reason `night` is: it is a fact about the room right now, and one
   * deletion should bring back the daylight *and* the dry weather.
   */
  rain?: boolean
}

/**
 * Which driver is live.
 *
 * `tauri` is the desktop app talking to the Rust core over IPC; `http` is a
 * browser talking to `kleib3ry-server` over the same seam; `browser` is a plain
 * tab with no filesystem at all and a generated stand-in library. The HUD shows
 * it, because a library that looks empty is nearly always the wrong one of these.
 */
export type DriverKind = 'tauri' | 'http' | 'browser'

export interface LibraryService {
  /** Which driver is live. Surfaced in the HUD so misconfiguration is visible. */
  readonly kind: DriverKind

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
   * walls, tapes for the television, ROMs for the arcade machine. All four
   * resolve to an empty list on a host that cannot read files, so the scene
   * simply has no records rather than failing to build.
   */
  listTracks(): Promise<IndexedTrack[]>
  listArtwork(): Promise<IndexedArtwork[]>
  listTapes(): Promise<IndexedTape[]>
  listRoms(): Promise<IndexedRom[]>

  /** Raw bytes of one ROM, for the emulator. Read whole — never streamed. */
  readRom(id: string): Promise<Uint8Array>

  /**
   * The lamps and the weather, from `.library/ambience.json`. Null if never
   * written, which means "as `library.json` says".
   */
  loadAmbience(): Promise<AmbienceState | null>
  saveAmbience(state: AmbienceState): Promise<void>

  /**
   * Bookmarks and notes, from `.library/annotations.json` — its own file,
   * page-numbered and readable without the app. Null if never written.
   */
  loadAnnotations(): Promise<AnnotationsDocument | null>
  saveAnnotations(doc: AnnotationsDocument): Promise<void>
  /**
   * Land a Markdown digest of the annotations where this mode can. Resolves to
   * the written path (desktop: `.library/annotations.md`), or null meaning
   * "no filesystem here — offer it as a download instead".
   */
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
